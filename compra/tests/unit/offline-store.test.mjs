// Persistencia local (IndexedDB) y cola sin conexión del estado de la aplicación, con fake-indexeddb.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

// Entorno mínimo de navegador para el módulo de estado
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });

let store, idb;
before(async () => {
  ({ idb } = await import('../../js/data/idb.js'));
  await idb.init(globalThis.indexedDB);
  store = await import('../../js/data/store.js');
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('el borrador se guarda en el dispositivo y sobrevive a «recargar»', async () => {
  const { S, setDraftQty, initDevice } = store;
  initDevice();
  S.products.set('p1', { id: 'p1', name: 'Leche', price: 1, visible_in_app: true, active: true });
  setDraftQty('p1', 2);
  setDraftQty('p1', 3);
  await wait(150);
  const saved = await idb.get('kv', 'draft');
  assert.deepEqual(saved.items, [['p1', { quantity: 3 }]]);
  assert.deepEqual(saved.dirty, ['p1']);
  // Copia síncrona por si se cierra la pestaña antes de que IndexedDB termine
  assert.deepEqual(JSON.parse(localStorage.getItem('despensaBorradorSinEnviar')).changes, { p1: 3 });
  // «Recarga»: se borra el estado en memoria y se lee de nuevo
  S.draft = { list: null, items: new Map(), dirty: new Set() };
  await store.loadLocal();
  assert.equal(S.draft.items.get('p1').quantity, 3);
  assert.ok(S.draft.dirty.has('p1'), 'sigue pendiente de enviar');
});

test('sin conexión las operaciones esperan en la cola, agrupadas y con identificador estable', async () => {
  const { S, flushDraft, setDraftQty, queueInfo } = store;
  await flushDraft();                       // sin red: no se envía
  assert.equal(queueInfo().pending, 1);
  const id = S.queue[0].id;
  setDraftQty('p2', 1);
  await flushDraft();
  assert.equal(S.queue.length, 1, 'se agrupa con la operación aún no intentada');
  assert.equal(S.queue[0].id, id);
  assert.deepEqual(S.queue[0].payload.changes.map((c) => [c.product_id, c.quantity]).sort(), [['p1', 3], ['p2', 1]]);
  const persisted = await idb.get('kv', 'queue');
  assert.equal(persisted.length, 1);
  // Una operación ya intentada no recibe cambios nuevos (su op_id podría estar aplicado)
  S.queue[0].tries = 1;
  setDraftQty('p2', 4);
  await flushDraft();
  assert.equal(S.queue.length, 2);
});

test('resultados de la compra: un estado final no vuelve a pendiente', async () => {
  const { S, setResult } = store;
  S.session = { session: { id: 's1', list_id: 'L', started_at: new Date().toISOString() }, results: new Map([['i1', { list_item_id: 'i1', product_id: 'p1', status: 'pending', requested_qty: 3, collected_qty: 0 }]]) };
  setResult('i1', 'partial', 2);
  assert.equal(S.session.results.get('i1').status, 'partial');
  setResult('i1', 'pending', 0);
  assert.equal(S.session.results.get('i1').status, 'partial');
  setResult('i1', 'partial', 5);
  assert.equal(S.session.results.get('i1').status, 'collected', 'más unidades de las pedidas = completo');
  const op = S.queue.find((o) => o.kind === 'results');
  assert.equal(op.payload.results.length, 1);
  assert.equal(op.payload.results[0].status, 'collected');
});
