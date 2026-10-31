// Seguridad (RLS, permisos) y reglas de negocio de las funciones RPC, como el rol anónimo de Supabase.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pgAvailable, freshDatabase, createPgDb, asAnon, rpc, FAMILY_KEY, HOUSEHOLD } from './helpers.mjs';
import { runSyncStep } from '../../supabase/functions/_shared/sync-engine.js';
import { baseCatalog, fakeProvider } from '../fixtures/catalog-fixtures.mjs';

const available = await pgAvailable();
const skip = !available && 'PostgreSQL no disponible';
let pool;
const pid = {};
const K = FAMILY_KEY;

before(async () => {
  if (!available) return;
  pool = await freshDatabase('compra_rpc_test');
  const cat = baseCatalog();
  const res = await runSyncStep({ db: createPgDb(pool), providers: [fakeProvider('mercadona-api', cat)], householdId: HOUSEHOLD,
    options: { delayMs: 0, detailsPerRun: 0, budgetMs: 60000 }, sleepImpl: async () => {} });
  assert.equal(res.state, 'completed');
  for (const r of (await pool.query('select id, external_id from compra.products')).rows) pid[r.external_id] = r.id;
});
after(async () => { await pool?.end(); });

const fails = async (p, code) => {
  await assert.rejects(p, (e) => { assert.match(String(e.message), new RegExp(code)); return true; });
};

test('sin clave o con clave errónea no se ve nada', { skip }, async () => {
  for (const key of [null, 'clave-equivocada-000']) {
    await asAnon(pool, key, async (c) => {
      assert.equal((await c.query('select count(*)::int n from compra.products')).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from compra.store_zones')).rows[0].n, 0);
      assert.equal((await c.query('select count(*)::int n from compra.shopping_lists')).rows[0].n, 0);
      const who = await rpc(c, 'whoami');
      assert.equal(who.ok, false);
      assert.equal(who.reason, key ? 'invalid_key' : 'missing_key');
      await fails(rpc(c, 'save_list_draft', { p_changes: [] }), 'clave_familiar_no_valida');
    });
  }
});

test('con la clave se lee, pero nunca se escribe directamente en las tablas', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    assert.equal((await c.query('select count(*)::int n from compra.store_zones')).rows[0].n, 15);
    assert.ok((await c.query('select count(*)::int n from compra.products')).rows[0].n > 0);
    assert.equal((await rpc(c, 'whoami')).ok, true);
  });
  const attempts = [
    `insert into compra.shopping_lists (household_id, store_id) values ('${HOUSEHOLD}', '00000000-0000-4000-8000-000000000101')`,
    `update compra.products set price = 0`,
    `delete from compra.store_zones`,
    `select * from compra.households`,
    `select * from compra.catalog_sync_staging`,
    `select compra.apply_catalog_sync(gen_random_uuid(), gen_random_uuid())`,
    `select compra.set_household_key('otra-clave-larga-123')`,
    `select compra.sync_begin('${HOUSEHOLD}', 'manual', 'x')`
  ];
  for (const sql of attempts) {
    await assert.rejects(asAnon(pool, K, (c) => c.query(sql)), /permission denied/, sql);
  }
});

test('la lista: precio del servidor, una sola abierta y una sola cerrada pendiente', { skip }, async () => {
  let listId;
  await asAnon(pool, K, async (c) => {
    const r = await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 2, price: 0.01 }, { product_id: pid['6001'], quantity: 3 }], p_actor: 'mama', p_op_id: '11111111-1111-4111-8111-111111111111' });
    listId = r.list.id;
    assert.equal(r.list.status, 'draft');
    assert.equal(Number(r.list.estimated_total), 2 * 17.25 + 3 * 1.5, 'se ignora el precio enviado por el cliente');
    // Misma operación repetida (cola sin conexión): no duplica nada
    const again = await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 9 }], p_actor: 'mama', p_op_id: '11111111-1111-4111-8111-111111111111' });
    assert.equal(again.items.find((i) => i.product_id === pid['4241']).quantity, 2);
    await fails(rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['21601'], quantity: 1 }] }), 'producto_oculto');
    await fails(rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 120 }] }), 'cantidad_no_valida');
    const r2 = await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['6001'], quantity: 0 }, { product_id: pid['5901'], quantity: 1 }], p_list_id: listId });
    assert.equal(r2.list.id, listId, 'reutiliza la única lista abierta');
    assert.deepEqual(r2.items.map((i) => i.product_id).sort(), [pid['4241'], pid['5901']].sort());
  });
  await assert.rejects(pool.query(`insert into compra.shopping_lists (household_id, store_id) values ($1, '00000000-0000-4000-8000-000000000101')`, [HOUSEHOLD]), /lists_one_draft/);

  await asAnon(pool, K, async (c) => {
    const closed = await rpc(c, 'close_list', { p_list_id: listId, p_actor: 'mama' });
    assert.equal(closed.list.status, 'ready_to_shop');
    assert.equal(closed.summary.units, 3);
    assert.equal(closed.summary.zones, 2);
    // Nueva lista abierta permitida, pero no se puede cerrar otra mientras haya una pendiente
    const d2 = await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['5001'], quantity: 1 }], p_actor: 'adrian' });
    assert.notEqual(d2.list.id, listId);
    await fails(rpc(c, 'close_list', { p_list_id: d2.list.id }), 'ya_hay_compra_pendiente');
    await fails(rpc(c, 'reopen_list', { p_list_id: listId }), 'ya_hay_lista_abierta');
    await fails(rpc(c, 'save_list_draft', { p_changes: [], p_list_id: listId }), 'lista_no_editable');
  });
  pid.list1 = listId;
});

test('compra: un solo inicio, estados finales que no vuelven atrás y finalización', { skip }, async () => {
  let session;
  await asAnon(pool, K, async (c) => {
    await fails(rpc(c, 'start_shopping', { p_list_id: pid.list1, p_shopper: 'maria', p_device_id: 'movil-a' }), 'comprador_no_valido');
    session = await rpc(c, 'start_shopping', { p_list_id: pid.list1, p_shopper: 'papa', p_device_id: 'movil-a' });
    assert.equal(session.session.shopper_code, 'papa');
    assert.equal(session.results.length, 2);
    const resumed = await rpc(c, 'start_shopping', { p_list_id: pid.list1, p_shopper: 'papa', p_device_id: 'movil-a' });
    assert.equal(resumed.session.id, session.session.id, 'el mismo dispositivo retoma');
    await fails(rpc(c, 'start_shopping', { p_list_id: pid.list1, p_shopper: 'mama', p_device_id: 'movil-b' }), 'compra_ya_iniciada');
  });
  const oil = session.results.find((r) => r.product_id === pid['4241']);
  const bread = session.results.find((r) => r.product_id === pid['5901']);
  await asAnon(pool, K, async (c) => {
    const t1 = new Date(Date.now() - 60000).toISOString();
    let r = await rpc(c, 'record_item_results', { p_session_id: session.session.id, p_results: [{ list_item_id: oil.list_item_id, status: 'partial', collected_qty: 1, resolved_at: t1 }] });
    assert.equal(r.applied, 1);
    // Llega tarde un «pendiente» de otro dispositivo: se ignora
    r = await rpc(c, 'record_item_results', { p_session_id: session.session.id, p_results: [{ list_item_id: oil.list_item_id, status: 'pending' }] });
    assert.equal(r.skipped, 1);
    // Un estado final más antiguo tampoco pisa al más reciente
    r = await rpc(c, 'record_item_results', { p_session_id: session.session.id, p_results: [{ list_item_id: oil.list_item_id, status: 'collected', resolved_at: new Date(Date.now() - 120000).toISOString() }] });
    assert.equal(r.skipped, 1);
    const cur = r.results.find((x) => x.list_item_id === oil.list_item_id);
    assert.equal(cur.status, 'partial');
    assert.equal(cur.collected_qty, 1);
    await fails(rpc(c, 'finish_shopping', { p_session_id: session.session.id }), 'quedan_pendientes');
    await rpc(c, 'record_item_results', { p_session_id: session.session.id, p_results: [{ list_item_id: bread.list_item_id, status: 'out_of_stock' }] });
  });
  await pool.query(`update compra.shopping_sessions set started_at = now() - interval '30 minutes' where id = $1`, [session.session.id]);
  await asAnon(pool, K, async (c) => {
    const s = await rpc(c, 'finish_shopping', { p_session_id: session.session.id, p_op_id: '22222222-2222-4222-8222-222222222222' });
    assert.ok(s.duration_seconds >= 1795 && s.duration_seconds <= 1805);
    assert.equal(s.deviation_pct, null, 'primera compra: sin media anterior');
    assert.equal(s.partial_items, 1);
    assert.equal(s.missing_items, 1);
    assert.equal(Number(s.final_estimated_total), 17.25, 'parcial: solo las unidades recogidas; sin existencias: excluido');
    assert.equal(Number(s.initial_estimated_total), 2 * 17.25 + 0.45);
    const again = await rpc(c, 'finish_shopping', { p_session_id: session.session.id, p_op_id: '22222222-2222-4222-8222-222222222222' });
    assert.equal(again.session_id, s.session_id, 'idempotente');
    const list = (await c.query('select status from compra.shopping_lists where id = $1', [pid.list1])).rows[0];
    assert.equal(list.status, 'completed');
  });
});

test('desviación respecto a la media personal anterior (sin incluir la compra actual)', { skip }, async () => {
  // Segunda compra de Papá de 45 minutos; la anterior duró 30 → +50 %
  await asAnon(pool, K, async (c) => {
    const d = (await c.query(`select id from compra.shopping_lists where status = 'draft'`)).rows[0].id;
    await rpc(c, 'save_list_draft', { p_changes: [{ product_id: pid['4241'], quantity: 1 }], p_list_id: d });
    await rpc(c, 'close_list', { p_list_id: d });
    const s = await rpc(c, 'start_shopping', { p_list_id: d, p_shopper: 'papa', p_device_id: 'movil-a' });
    await rpc(c, 'record_item_results', { p_session_id: s.session.id, p_results: s.results.map((r) => ({ list_item_id: r.list_item_id, status: 'collected' })) });
    pid.s2 = s.session.id;
  });
  await pool.query(`update compra.shopping_sessions set started_at = now() - interval '45 minutes' where id = $1`, [pid.s2]);
  await asAnon(pool, K, async (c) => {
    const s = await rpc(c, 'finish_shopping', { p_session_id: pid.s2 });
    assert.ok(Math.abs(Number(s.deviation_pct) - 50) < 0.2, `desviación ${s.deviation_pct}`);
    assert.ok(Math.abs(Number(s.previous_avg_seconds) - 1800) < 6);
    const st = (await c.query(`select * from compra.v_shopper_stats`)).rows[0];
    assert.equal(Number(st.total_purchases), 2);
    // Frecuencia = listas distintas, no unidades (el aceite: 2 listas aunque se pidieron 3 unidades)
    const f = (await c.query(`select list_count from compra.v_product_frequency where product_id = $1`, [pid['4241']])).rows[0];
    assert.equal(Number(f.list_count), 2);
  });
});

test('zonas: mover, deshacer y quién lo hizo', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    const z5 = (await c.query(`select id from compra.store_zones where code = 'z05'`)).rows[0].id;
    const r = await rpc(c, 'set_product_zone_overrides', { p_assignments: [{ product_id: pid['24401'], zone_id: z5 }, { product_id: pid['5001'], zone_id: z5 }], p_actor: 'adrian' });
    assert.equal(r.applied, 2);
    assert.equal(r.by, 'Adrián');
    assert.deepEqual(r.previous.map((p) => p.zone_id), [null, null]);
    const undo = await rpc(c, 'set_product_zone_overrides', { p_assignments: r.previous, p_actor: 'adrian', p_reason: 'deshacer' });
    assert.equal(undo.applied, 2);
    assert.equal((await c.query('select count(*)::int n from compra.product_zone_overrides')).rows[0].n, 0);
    const log = (await c.query(`select actor_label from compra.audit_log where action = 'set_product_zones' order by id desc limit 1`)).rows[0];
    assert.equal(log.actor_label, 'Adrián');
  });
});

test('ajustes validados y categorías ocultas', { skip }, async () => {
  await asAnon(pool, K, async (c) => {
    await fails(rpc(c, 'set_setting', { p_key: 'sync_interval_hours', p_value: 2 }), 'ajuste_no_valido');
    await fails(rpc(c, 'set_setting', { p_key: 'postal_code', p_value: '28A00' }), 'ajuste_no_valido');
    await fails(rpc(c, 'set_setting', { p_key: 'service_role', p_value: 'x' }), 'ajuste_desconocido');
    await rpc(c, 'set_setting', { p_key: 'postal_code', p_value: '28300' });
    const r = await rpc(c, 'set_setting', { p_key: 'hidden_category_ids', p_value: [24, 25, 26] });
    assert.ok(r.products_changed >= 1);
    assert.equal((await c.query(`select visible_in_app from compra.products where external_id = '24401'`)).rows[0].visible_in_app, false);
    await rpc(c, 'set_setting', { p_key: 'hidden_category_ids', p_value: [24, 25] });
  });
});

test('tickets: pagado con registro de quién y cuándo; borrado lógico', { skip }, async () => {
  const id = (await pool.query(`insert into compra.purchase_receipts (household_id, storage_path, mime_type, size_bytes, amount)
    values ($1::uuid, $2::text || '/2026/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1000, 23.4) returning id`, [HOUSEHOLD, HOUSEHOLD])).rows[0].id;
  await asAnon(pool, K, async (c) => {
    await fails(rpc(c, 'mark_receipt_paid', { p_receipt_id: id, p_actor: null }), 'persona_no_valida');
    const r = await rpc(c, 'mark_receipt_paid', { p_receipt_id: id, p_actor: 'mama' });
    assert.equal(r.status, 'paid');
    assert.ok(r.marked_paid_at);
    await rpc(c, 'delete_receipt', { p_receipt_id: id, p_actor: 'mama' });
    assert.equal((await c.query('select count(*)::int n from compra.purchase_receipts')).rows[0].n, 0, 'oculto para la app');
  });
  assert.equal((await pool.query('select count(*)::int n from compra.purchase_receipts where id = $1', [id])).rows[0].n, 1, 'el registro sigue existiendo');
});
