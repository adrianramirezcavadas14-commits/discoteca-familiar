// Versión 1.3 contra PostgreSQL real: se guarda quién apuntó cada producto y se conserva al moverlo entre listas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, freshDatabase, createPgDb, asAnon, rpc, FAMILY_KEY, HOUSEHOLD } from './helpers.mjs';
import { runSyncStep } from '../../supabase/functions/_shared/sync-engine.js';
import { baseCatalog, fakeProvider } from '../fixtures/catalog-fixtures.mjs';

const available = await pgAvailable();
const skip = !available && 'PostgreSQL no disponible';
let pool;
const pid = {};

before(async () => {
  if (!available) return;
  pool = await freshDatabase('compra_v13_test');
  const res = await runSyncStep({ db: createPgDb(pool), providers: [fakeProvider('mercadona-api', baseCatalog())], householdId: HOUSEHOLD,
    options: { delayMs: 0, detailsPerRun: 0, budgetMs: 60000 }, sleepImpl: async () => {} });
  assert.equal(res.state, 'completed');
  for (const r of (await pool.query('select id, external_id from compra.products')).rows) pid[r.external_id] = r.id;
});
after(async () => { await pool?.end(); });

const whoMain = (c, p) => c.query(`select fp.code from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id and l.status = 'draft'
  left join compra.family_profiles fp on fp.id = i.added_by where i.product_id = $1`, [p]).then((r) => r.rows[0]?.code ?? null);
const whoLater = (c, p) => c.query(`select fp.code from compra.backlog_items b left join compra.family_profiles fp on fp.id = b.added_by where b.product_id = $1`, [p]).then((r) => r.rows[0]?.code ?? null);

test('quién apunta: se guarda al añadir, no cambia al sumar y se conserva al mover entre listas', { skip }, async () => {
  await asAnon(pool, FAMILY_KEY, async (c) => {
    const saved = await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 1 }], p_actor: 'mama' });
    assert.ok(saved.items.every((i) => 'added_by' in i), 'la respuesta incluye added_by para pintar la inicial');
    assert.equal(await whoMain(c, pid['4241']), 'mama');
    await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 3 }], p_actor: 'papa' });
    assert.equal(await whoMain(c, pid['4241']), 'mama', 'sumar unidades no cambia quién lo apuntó');
    // Lista principal → no urgentes (lo mueve Adrián): sigue siendo de Mamá
    await rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'backlog', p_actor: 'adrian' });
    assert.equal(await whoLater(c, pid['4241']), 'mama');
    // No urgentes → lista principal (lo mueve Papá): sigue siendo de Mamá
    await rpc(c, 'move_between_lists', { p_product_id: pid['4241'], p_to: 'main', p_actor: 'papa' });
    assert.equal(await whoMain(c, pid['4241']), 'mama');
    // Apuntado en «no urgentes» por Adrián
    await rpc(c, 'save_backlog', { p_changes: [{ product_id: pid['5001'], quantity: 2 }], p_actor: 'adrian' });
    assert.equal(await whoLater(c, pid['5001']), 'adrian');
    // Filas antiguas sin persona: al moverlas se queda quien las mueve
    await c.query(`select 1`);
  });
  await pool.query(`update compra.backlog_items set added_by = null where product_id = $1`, [pid['5001']]);
  await asAnon(pool, FAMILY_KEY, async (c) => {
    await rpc(c, 'move_between_lists', { p_product_id: pid['5001'], p_to: 'main', p_actor: 'papa' });
    assert.equal(await whoMain(c, pid['5001']), 'papa');
  });
});
