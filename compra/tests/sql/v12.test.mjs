// Versión 1.2 contra PostgreSQL real: pendientes de revisar, «Pendientes no urgentes», mover entre listas y menú semanal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, freshDatabase, createPgDb, asAnon, rpc, FAMILY_KEY, HOUSEHOLD } from './helpers.mjs';
import { runSyncStep } from '../../supabase/functions/_shared/sync-engine.js';
import { baseCatalog, fakeProvider } from '../fixtures/catalog-fixtures.mjs';
import { recipeKey } from '../../js/core/text.js';

const available = await pgAvailable();
const skip = !available && 'PostgreSQL no disponible';
let pool;
const pid = {};
const K = FAMILY_KEY;
const IMG = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Lentejas.jpg/640px-Lentejas.jpg';
const fails = async (p, code) => { await assert.rejects(p, (e) => { assert.match(String(e.message), new RegExp(code)); return true; }); };

before(async () => {
  if (!available) return;
  pool = await freshDatabase('compra_v12_test');
  const res = await runSyncStep({ db: createPgDb(pool), providers: [fakeProvider('mercadona-api', baseCatalog())], householdId: HOUSEHOLD,
    options: { delayMs: 0, detailsPerRun: 0, budgetMs: 60000 }, sleepImpl: async () => {} });
  assert.equal(res.state, 'completed');
  for (const r of (await pool.query('select id, external_id from compra.products')).rows) pid[r.external_id] = r.id;
});
after(async () => { await pool?.end(); });

test('pendientes de revisar: una sola marca por producto, se quita y nadie escribe directamente', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    const a = await rpc(c, 'set_review_flag', { p_product_id: pid['4241'], p_flagged: true, p_actor: 'adrian' });
    assert.equal(a.flagged, true);
    await rpc(c, 'set_review_flag', { p_product_id: pid['4241'], p_flagged: true, p_actor: 'mama' });
    assert.equal((await c.query('select count(*)::int n from compra.product_review_flags')).rows[0].n, 1, 'marcar dos veces no duplica');
    const by = (await c.query(`select p.code from compra.product_review_flags f join compra.family_profiles p on p.id = f.flagged_by`)).rows[0].code;
    assert.equal(by, 'adrian', 'se conserva quién lo marcó primero');
    assert.equal((await c.query('select count(*)::int n from compra.shopping_list_items')).rows[0].n, 0, 'marcar no añade a ninguna lista');
    const b = await rpc(c, 'set_review_flag', { p_product_id: pid['4241'], p_flagged: false });
    assert.equal(b.flagged, false);
    assert.equal((await c.query('select count(*)::int n from compra.product_review_flags')).rows[0].n, 0);
    await rpc(c, 'set_review_flag', { p_product_id: pid['5001'], p_flagged: true });
  });
  await asAnon(pool, K, async (c) => { await assert.rejects(c.query(`insert into compra.product_review_flags (household_id, product_id) values ($1, $2)`, [HOUSEHOLD, pid['5901']])); });
  await asAnon(pool, 'clave-equivocada-000', async (c) => {
    assert.equal((await c.query('select count(*)::int n from compra.product_review_flags')).rows[0].n, 0, 'con clave errónea no se ve nada');
    await fails(rpc(c, 'set_review_flag', { p_product_id: pid['5001'], p_flagged: false }), 'clave_familiar_no_valida');
  });
});

test('pendientes no urgentes y mover entre listas: se suman cantidades, sin duplicar y de forma idempotente', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 2, notes: 'la grande' }], p_actor: 'papa' });
    await rpc(c, 'save_backlog', { p_changes: [{ product_id: pid['4241'], quantity: 1 }, { product_id: pid['5001'], quantity: 3 }], p_actor: 'mama' });
    // lista principal → no urgentes: 2 + 1 = 3, conserva la nota
    const op = '11111111-1111-4111-8111-111111111111';
    const r1 = await rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'backlog', p_actor: 'papa', p_op_id: op });
    assert.equal(r1.quantity, 2);
    const again = await rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'backlog', p_actor: 'papa', p_op_id: op });
    assert.deepEqual(again, r1, 'repetir el mismo op_id no mueve dos veces');
    const back = (await c.query(`select quantity, notes from compra.backlog_items where product_id = $1`, [pid['4241']])).rows[0];
    assert.deepEqual(back, { quantity: 3, notes: 'la grande' });
    assert.equal((await c.query(`select count(*)::int n from compra.shopping_list_items where product_id = $1`, [pid['4241']])).rows[0].n, 0, 'se quita del origen');
    // no urgentes → lista principal, con producto que ya estaba en la lista: se suman
    await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['5001'], quantity: 1 }] });
    await rpc(c, 'move_between_lists', { p_product_id: pid['5001'], p_to: 'main', p_actor: 'mama', p_op_id: '22222222-2222-4222-8222-222222222222' });
    const item = (await c.query(`select i.quantity, i.unit_price_snapshot is not null as priced from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft' and i.product_id = $1`, [pid['5001']])).rows[0];
    assert.deepEqual(item, { quantity: 4, priced: true });
    assert.equal((await c.query(`select count(*)::int n from compra.backlog_items where product_id = $1`, [pid['5001']])).rows[0].n, 0);
    assert.equal((await c.query(`select count(*)::int n from compra.shopping_item_results`)).rows[0].n, 0, 'mover no marca nada como comprado');
    // Mover algo que ya no está: error y nada cambia
    await fails(rpc(c, 'move_between_lists', { p_product_id: pid['5001'], p_to: 'main' }), 'no_esta_en_pendientes');
    await fails(rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'main', p_op_id: null, p_actor: 'x' }).then(() => rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'main' })), 'no_esta_en_pendientes');
    await fails(rpc(c, 'save_backlog', { p_changes: [{ product_id: pid['5901'], quantity: 120 }] }), 'cantidad_no_valida');
    // Cantidad 0 = quitar
    await rpc(c, 'save_backlog', { p_changes: [{ product_id: pid['5901'], quantity: 2 }] });
    const gone = await rpc(c, 'save_backlog', { p_changes: [{ product_id: pid['5901'], quantity: 0 }] });
    assert.equal(gone.backlog.some((b) => b.product_id === pid['5901']), false);
  });
});

test('menú semanal: imagen obligatoria, sin duplicar recetas y comidas/cenas por separado', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    await fails(rpc(c, 'menu_add', { p_date: '2026-11-02', p_slot: 'comida', p_name: 'Lentejas con chorizo' }), 'imagen_obligatoria');
    const a = await rpc(c, 'menu_add', { p_date: '2026-11-02', p_slot: 'comida', p_name: '  Lentejas   con chorizo ', p_image_url: IMG, p_image_source: 'Wikimedia Commons', p_image_page_url: 'https://commons.wikimedia.org/wiki/File:Lentejas.jpg', p_actor: 'mama' });
    assert.equal(a.recipe.name, 'Lentejas con chorizo', 'se guarda el nombre visible limpio');
    assert.equal(a.recipe.name_key, 'lentejas con chorizo');
    assert.equal(a.recipe.category, 'comida');
    assert.equal(a.entry.weekday, 1);
    assert.equal(a.entry.week_start, '2026-11-02');
    // Mismo nombre con otras mayúsculas y tildes, en cena: se reutiliza (con su imagen) y pasa a «ambas»
    const b = await rpc(c, 'menu_add', { p_date: '2026-11-04', p_slot: 'cena', p_name: 'LENTEJAS CON CHORÍZO' });
    assert.equal(b.recipe.id, a.recipe.id);
    assert.equal(b.recipe.image_url, IMG);
    assert.equal(b.recipe.category, 'ambas');
    assert.equal((await c.query('select count(*)::int n from compra.recipes')).rows[0].n, 1);
    // Otra receta solo de cena
    const d = await rpc(c, 'menu_add', { p_date: '2026-11-04', p_slot: 'cena', p_name: 'Tortilla francesa', p_image_url: IMG });
    assert.equal(d.recipe.category, 'cena');
    // Repetir la misma receta el mismo día y momento no duplica
    await rpc(c, 'menu_add', { p_date: '2026-11-04', p_slot: 'cena', p_recipe_id: d.recipe.id });
    assert.equal((await c.query(`select count(*)::int n from compra.menu_entries where menu_date = '2026-11-04' and slot = 'cena'`)).rows[0].n, 2);
    // Cambio de año: el domingo 3/1/2027 pertenece a la semana que empieza el 28/12/2026
    const y = await rpc(c, 'menu_add', { p_date: '2027-01-03', p_slot: 'comida', p_recipe_id: d.recipe.id });
    assert.deepEqual([y.entry.week_start, y.entry.weekday], ['2026-12-28', 7]);
    assert.equal((await c.query(`select for_lunch, for_dinner from compra.recipes where id = $1`, [d.recipe.id])).rows[0].for_lunch, true, 'usada expresamente en comida');
    // Quitar del menú no borra la receta ni otras semanas
    const rm = await rpc(c, 'menu_remove', { p_entry_id: a.entry.id });
    assert.equal(rm.removed, true);
    assert.equal((await c.query('select count(*)::int n from compra.recipes')).rows[0].n, 2);
    await fails(rpc(c, 'menu_add', { p_date: '2026-11-05', p_slot: 'merienda', p_recipe_id: d.recipe.id }), 'menu_no_valido');
    await fails(rpc(c, 'menu_add', { p_date: '2026-11-05', p_slot: 'cena', p_name: 'Sopa', p_image_url: 'http://inseguro.example/x.jpg' }), 'imagen_obligatoria');
  });
  await asAnon(pool, K, async (c) => { await assert.rejects(c.query(`update compra.recipes set image_url = 'https://x.example/y.jpg'`)); });
});

test('el nombre normalizado de SQL coincide con el del navegador', { skip }, async () => {
  const samples = ['Lentejas con chorizo', '  CREMA de Calabacín ', 'Ñoquis al pesto', 'Pollo al curry (picante)', 'Crêpes Suzette', 'Arroz a la cubana', 'Pingüino'];
  const rows = (await pool.query(`select s, compra.norm_key(s) k from unnest($1::text[]) s`, [samples])).rows;
  for (const r of rows) assert.equal(r.k, recipeKey(r.s), r.s);
});
