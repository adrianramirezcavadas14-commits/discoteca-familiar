// Pruebas del motor de sincronización + apply_catalog_sync contra PostgreSQL real.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, freshDatabase, createPgDb, HOUSEHOLD, STORE } from './helpers.mjs';
import { runSyncStep } from '../../supabase/functions/_shared/sync-engine.js';
import { baseCatalog, fakeProvider, product, SECTIONS } from '../fixtures/catalog-fixtures.mjs';

const available = await pgAvailable();
let pool, db;
const fast = { budgetMs: 60000, delayMs: 0, concurrency: 2, detailsPerRun: 3 };
const noSleep = async () => {};

async function syncWith(catalog, opts = {}, providerOpts = {}) {
  const primary = fakeProvider('mercadona-api', catalog, providerOpts.primary);
  const backup = fakeProvider('datania', providerOpts.backupCatalog || catalog, providerOpts.backup);
  let res;
  for (let i = 0; i < 10; i++) {
    res = await runSyncStep({ db, providers: [primary, backup], householdId: HOUSEHOLD, trigger: 'manual', requestedBy: 'test', options: { ...fast, ...opts }, sleepImpl: noSleep });
    if (res.state !== 'running') break;
  }
  return { res, primary, backup };
}
const q = async (sql, args = []) => (await pool.query(sql, args)).rows;
const prod = async (ext) => (await q('select * from compra.products where external_id = $1', [ext]))[0];
const changes = async (type) => q(`select c.*, p.external_id from compra.catalog_changes c join compra.products p on p.id = c.product_id where change_type = $1 order by c.id`, [type]);

before(async () => { if (available) { pool = await freshDatabase('compra_sync_test'); db = createPgDb(pool); } });
after(async () => { await pool?.end(); });

test('primera sincronización = catálogo base, sin avisos de productos nuevos', { skip: !available && 'PostgreSQL no disponible' }, async () => {
  const { res } = await syncWith(baseCatalog());
  assert.equal(res.state, 'completed', res.error);
  assert.equal(res.stats.baseline, true);
  assert.equal((await q('select count(*)::int n from compra.products'))[0].n, 8);
  assert.equal((await changes('new_product')).length, 0);
  assert.equal((await q(`select count(*)::int n from compra.product_price_history where change_type = 'initial'`))[0].n, 8);
  const p = await prod('4241');
  assert.equal(Number(p.price), 17.25);
  assert.equal(Number(p.unit_price), 3.45);
  assert.equal(p.format_label, 'Garrafa 5 L');
  assert.equal(p.category_id, 12);
  assert.equal(p.subcategory_id, 112);
  assert.equal(p.subsubcategory_id, 420);
  // Bebé: se guarda pero no es visible en la aplicación
  assert.equal((await prod('21601')).visible_in_app, false);
  assert.equal((await prod('5901')).visible_in_app, true);
  // Fichas detalladas: como máximo detailsPerRun por sincronización
  assert.equal((await q('select count(*)::int n from compra.products where detail_fetched_at is not null'))[0].n, 3);
  assert.equal((await q('select count(*)::int n from compra.catalog_sync_staging'))[0].n, 0, 'staging limpio');
});

test('zona por prioridad: excepción > subcategoría > categoría > automática > sin clasificar', { skip: !available }, async () => {
  const zoneOf = async (ext) => (await q(`select z.route_order, f.source from compra.products p
     cross join lateral compra.zone_for_product($1, p.id) f left join compra.store_zones z on z.id = f.zone_id where p.external_id = $2`, [STORE, ext]))[0];
  assert.deepEqual(await zoneOf('4241'), { route_order: 9, source: 'subcategory' });   // Aceite (112) → zona 9
  assert.deepEqual(await zoneOf('5001'), { route_order: 1, source: 'subcategory' });   // Mayonesa (116) → zona 1
  assert.deepEqual(await zoneOf('6001'), { route_order: 4, source: 'subcategory' });   // Bollería envasada → 4, no 3
  assert.deepEqual(await zoneOf('5901'), { route_order: 3, source: 'category' });      // Panadería (sección 5) → 3
  assert.equal(await zoneOf('24401'), undefined);                                        // Utensilios de limpieza: sin clasificar
  const ov = (await q(`insert into compra.product_zone_overrides (household_id, store_id, product_id, zone_id)
      select $1, $2, p.id, z.id from compra.products p, compra.store_zones z where p.external_id = '4241' and z.code = 'z05' returning id`, [HOUSEHOLD, STORE]));
  assert.equal(ov.length, 1);
  assert.deepEqual(await zoneOf('4241'), { route_order: 5, source: 'manual' });
});

test('segunda sincronización detecta cambios y conserva la configuración propia', { skip: !available }, async () => {
  const cat = baseCatalog((c) => {
    const oil = c[112].subs[0].products;
    oil[0].price_instructions.unit_price = '15.95';                    // bajada declarada (promo)
    oil[0].price_instructions.previous_unit_price = '17.25';
    oil[0].price_instructions.price_decreased = true;
    oil[1].price_instructions.unit_price = '6.50';                     // subida
    oil[1].display_name = 'Aceite de oliva virgen extra (prueba)';     // cambio de nombre
    oil[1].thumbnail = 'https://prod-mercadona.imgix.net/images/nueva4242.jpg?fit=crop&h=300&w=300'; // foto nueva
    c[112].subs[1].products[0].packaging = 'Bote';                     // cambio de formato
    c[116].subs[0].products.push(product({ id: 5002, name: 'Ketchup (prueba)', section: SECTIONS.aceite, price: 1.05 })); // nuevo
    c[59].subs[0].products = [];                                        // la barra de pan desaparece
    c[66].subs[0].products[0].published = false;                       // temporalmente no disponible
  });
  const { res } = await syncWith(cat);
  assert.equal(res.state, 'completed', res.error);
  const n = await changes('new_product');
  assert.equal(n.length, 1);
  assert.equal(n[0].external_id, '5002');
  assert.equal(n[0].needs_review, true);
  assert.ok((await prod('5002')).new_until, 'marca de nuevo');

  const promo = await changes('promo_start');
  assert.deepEqual(promo.map((c) => c.external_id), ['4241']);
  const drop = await changes('price_decrease');
  assert.equal(drop[0].external_id, '4241');
  assert.equal(Number(drop[0].new_value.diff), -1.3);
  assert.equal(Number(drop[0].new_value.pct), -7.54);
  assert.equal((await changes('price_increase'))[0].external_id, '4242');
  assert.equal((await changes('name_change'))[0].external_id, '4242');
  assert.equal((await changes('format_change'))[0].external_id, '4300');
  assert.equal((await changes('photo_change'))[0].external_id, '4242');
  assert.equal((await changes('temporarily_unavailable'))[0].external_id, '6001');

  const p4241 = await prod('4241');
  assert.equal(p4241.price_decreased, true);
  assert.equal(Number(p4241.previous_price), 17.25);
  assert.equal(p4241.price_change_kind, 'decrease');
  assert.equal((await q(`select count(*)::int n from compra.product_promotions where ended_at is null`))[0].n, 1);
  const hist = await q(`select change_type, change_eur::float, change_pct::float from compra.product_price_history h join compra.products p on p.id = h.product_id where p.external_id = '4241' order by recorded_at`);
  assert.deepEqual(hist.map((h) => h.change_type), ['initial', 'decrease']);

  // La foto se actualiza sola y queda historial; la zona manual (zona 5) se conserva
  const p4242 = await prod('4242');
  assert.match(p4242.thumbnail_url, /nueva4242/);
  assert.equal((await q(`select count(*)::int n from compra.product_images i join compra.products p on p.id = i.product_id where p.external_id = '4242'`))[0].n, 2);
  assert.equal((await q(`select count(*)::int n from compra.product_zone_overrides o join compra.products p on p.id = o.product_id where p.external_id = '4241'`))[0].n, 1);

  // Producto desaparecido: no se borra, queda inactivo y «posiblemente retirado»
  const bread = await prod('5901');
  assert.equal(bread.active, false);
  assert.equal(bread.availability, 'possibly_removed');
  assert.equal(bread.missing_streak, 1);
  assert.ok(bread.first_missing_at);
  assert.equal((await changes('possibly_removed')).length, 1);
});

test('retirado definitivamente tras tres sincronizaciones sin aparecer; luego reaparece', { skip: !available }, async () => {
  const without = baseCatalog((c) => { c[59].subs[0].products = []; });
  await syncWith(without);
  assert.equal((await prod('5901')).availability, 'possibly_removed');
  await syncWith(without);
  const gone = await prod('5901');
  assert.equal(gone.availability, 'removed');
  assert.equal(gone.missing_streak, 3);
  assert.ok(gone.removed_at);
  assert.equal((await changes('removed')).length, 1);
  await syncWith(baseCatalog());
  const back = await prod('5901');
  assert.equal(back.availability, 'available');
  assert.equal(back.active, true);
  assert.equal(back.missing_streak, 0);
  assert.equal((await changes('reappeared')).length, 1);
  assert.equal((await changes('promo_end')).length, 1, 'la promoción del aceite termina');
});

test('si una categoría falla en las dos fuentes, se conserva el catálogo anterior', { skip: !available }, async () => {
  const before = await q('select external_id, price, updated_at from compra.products order by external_id');
  const cat = baseCatalog((c) => { c[112].subs[0].products[0].price_instructions.unit_price = '1.00'; });
  const { res } = await syncWith(cat, { maxTaskAttempts: 2 }, { primary: { failCategories: [116] }, backup: { failCategories: [116] } });
  assert.equal(res.state, 'failed');
  assert.match(res.error, /No se pudieron descargar/);
  const afterRows = await q('select external_id, price, updated_at from compra.products order by external_id');
  assert.deepEqual(afterRows, before);
  assert.equal((await q(`select count(*)::int n from compra.catalog_sync_staging`))[0].n, 0);
});

test('si la API principal falla se usa la copia de datania', { skip: !available }, async () => {
  const { res, backup } = await syncWith(baseCatalog(), {}, { primary: { failRoot: true, failCategories: [112, 116, 66, 59, 216, 244] } });
  assert.equal(res.state, 'completed', res.error);
  assert.ok(backup.calls.includes('root'));
  const run = (await q(`select provider from compra.catalog_sync_runs where status='completed' order by finished_at desc limit 1`))[0];
  assert.equal(run.provider, 'datania');
});

test('una descarga sospechosamente pequeña no sustituye al catálogo', { skip: !available }, async () => {
  const tiny = baseCatalog((c) => { for (const id of [112, 66, 59, 216, 244]) c[id].subs.forEach((s) => { s.products = []; }); });
  const { res } = await syncWith(tiny);
  assert.equal(res.state, 'failed');
  assert.match(res.error, /catalogo_incompleto/);
  assert.equal((await prod('4241')).active, true);
});

test('solo una sincronización a la vez; una sin latido se puede retomar', { skip: !available }, async () => {
  const a = await db.rpc('sync_begin', { p_household: HOUSEHOLD, p_trigger: 'auto', p_requested_by: 'a', p_stale_seconds: 180 });
  assert.equal(a.state, 'created');
  const b = await db.rpc('sync_begin', { p_household: HOUSEHOLD, p_trigger: 'auto', p_requested_by: 'b', p_stale_seconds: 180 });
  assert.equal(b.state, 'busy');
  assert.equal(b.run.lock_token, undefined, 'no se filtra el cerrojo');
  await pool.query(`update compra.catalog_sync_runs set heartbeat_at = now() - interval '10 minutes' where id = $1`, [a.run.id]);
  const c = await db.rpc('sync_begin', { p_household: HOUSEHOLD, p_trigger: 'auto', p_requested_by: 'c', p_stale_seconds: 180 });
  assert.equal(c.state, 'takeover');
  assert.notEqual(c.run.lock_token, a.run.lock_token);
  await assert.rejects(db.rpc('sync_check', { p_run: a.run.id, p_token: a.run.lock_token }), /sync_lock_lost/);
  await db.rpc('sync_fail', { p_run: c.run.id, p_token: c.run.lock_token, p_error: 'prueba' });
});
