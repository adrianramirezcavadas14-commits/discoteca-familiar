/* =====================================================================
   Estado de la despensa, caché local y sincronización con Supabase
   ---------------------------------------------------------------------
   · Todo cambio se aplica primero en local (respuesta inmediata) y se
     guarda en IndexedDB para no perder nada si se cierra la pestaña.
   · El borrador de la lista se envía al salir de la sección, al pulsar
     «Guardar» o al cerrar la lista (nunca con cada pulsación).
   · Lo que no se puede enviar (sin cobertura) espera en una cola con
     identificadores idempotentes.
   ===================================================================== */
import { idb } from './idb.js';
import { api, explainError, isNetworkError } from './api.js';
import { indexRules, resolveZone, computeSectionZones, byRoute } from '../core/zones.js';
import { enqueue, isPermanentError, mergeResults, normalizeResult, shouldReplaceResult } from '../core/queue.js';
import { haystack } from '../core/catalog-view.js';
import { uuid, debounce } from '../core/text.js';
import { STORAGE_KEYS, SHOPPERS, RESULTS_FLUSH_MS } from '../config.js';

export const PRODUCT_COLUMNS = 'id,external_id,name,brand,packaging,format_label,category_id,category_name,subcategory_id,subcategory_name,subsubcategory_id,subsubcategory_name,price,unit_price,unit_of_measure,previous_price,price_decreased,price_before_change,price_change_kind,price_changed_at,thumbnail_url,image_url,availability,active,visible_in_app,is_new_arrival,new_until,first_seen_at,updated_at';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }
};

export const S = {
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  serverOk: false,
  remoteLoaded: false,
  deviceId: null,
  me: null,
  household: null,
  store: null,
  profiles: [],
  zones: [],
  rules: [],
  rulesIndex: new Map(),
  overrides: new Map(),       // productId → zoneId
  overrideMeta: new Map(),    // productId → { updated_by, updated_at }
  settings: {},
  products: new Map(),
  productsSince: null,
  zoneOf: new Map(),          // productId → { zoneId, source }
  sectionZones: new Map(),
  freq: new Map(),            // productId → nº de listas completadas
  draft: { list: null, items: new Map(), dirty: new Set() },
  pending: { list: null, items: [] },
  session: null,              // { session, results: Map(list_item_id → result) }
  queue: [],
  sync: { last: null, active: null, stale: false, intervalHours: 12, lastFailed: null, checkedAt: null },
  lastSummary: null
};

/* ---------- Avisos de cambio a la interfaz ---------- */
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } }); }

/* =================================================================
   IDENTIDAD DEL DISPOSITIVO
   ================================================================= */
export function initDevice() {
  let id = ls.get(STORAGE_KEYS.device);
  if (!id) { id = uuid(); ls.set(STORAGE_KEYS.device, id); }
  S.deviceId = id;
  S.me = ls.get(STORAGE_KEYS.me) || null;
  return id;
}
export function setMe(code) { S.me = code || null; ls.set(STORAGE_KEYS.me, S.me); emit('me'); }
export const familyKey = () => ls.get(STORAGE_KEYS.key) || '';
export const setFamilyKey = (k) => ls.set(STORAGE_KEYS.key, k ? String(k).trim() : null);
export const profileByCode = (code) => S.profiles.find((p) => p.code === code) || SHOPPERS.find((p) => p.code === code) || null;
export const profileById = (id) => S.profiles.find((p) => p.id === id) || null;
export const profileName = (id) => profileById(id)?.display_name || '—';

/* =================================================================
   CACHÉ LOCAL
   ================================================================= */
async function saveMeta() {
  await idb.set('kv', 'meta', {
    household: S.household, store: S.store, profiles: S.profiles, zones: S.zones, rules: S.rules,
    overrides: [...S.overrides], overrideMeta: [...S.overrideMeta], settings: S.settings, freq: [...S.freq],
    productsSince: S.productsSince, sync: S.sync, savedAt: new Date().toISOString()
  });
}
const saveDraftNow = () => idb.set('kv', 'draft', { list: S.draft.list, items: [...S.draft.items], dirty: [...S.draft.dirty] });
export const saveDraftLocal = debounce(() => saveDraftNow().catch(console.warn), 60);
const savePending = () => idb.set('kv', 'pending', S.pending).catch(console.warn);
const saveSession = () => idb.set('kv', 'session', S.session ? { session: S.session.session, results: [...S.session.results.values()], finishing: S.session.finishing || null } : null).catch(console.warn);
const saveQueue = () => idb.set('kv', 'queue', S.queue).catch(console.warn);

export async function loadLocal() {
  const [meta, draft, pending, session, queue, products] = await Promise.all([
    idb.get('kv', 'meta'), idb.get('kv', 'draft'), idb.get('kv', 'pending'), idb.get('kv', 'session'), idb.get('kv', 'queue'), idb.all('products')
  ]);
  if (meta) {
    Object.assign(S, {
      household: meta.household, store: meta.store, profiles: meta.profiles || [], zones: meta.zones || [], rules: meta.rules || [],
      settings: meta.settings || {}, productsSince: meta.productsSince || null, sync: { ...S.sync, ...(meta.sync || {}) }
    });
    S.overrides = new Map(meta.overrides || []);
    S.overrideMeta = new Map(meta.overrideMeta || []);
    S.freq = new Map(meta.freq || []);
    S.rulesIndex = indexRules(S.rules);
  }
  if (products?.length) setProducts(products, true);
  if (draft) {
    S.draft = { list: draft.list || null, items: new Map(draft.items || []), dirty: new Set(draft.dirty || []) };
  }
  if (pending) S.pending = pending;
  if (session?.session) S.session = { session: session.session, results: new Map((session.results || []).map((r) => [r.list_item_id, r])), finishing: session.finishing || null };
  S.queue = Array.isArray(queue) ? queue.map((o) => ({ ...o, sending: false })) : [];
  restoreDraftBackup();
  recomputeZones();
  return !!(meta && products?.length);
}

export async function clearLocal() {
  await Promise.all(['kv', 'products', 'thumbs', 'ops'].map((s) => idb.clear(s)));
}

/* =================================================================
   CATÁLOGO Y ZONAS
   ================================================================= */
function prep(p) {
  Object.defineProperty(p, '_hay', { value: haystack(p), enumerable: false, configurable: true, writable: true });
  return p;
}
function setProducts(rows, replace = false) {
  if (replace) S.products = new Map();
  for (const r of rows) S.products.set(r.id, prep(r));
}

export function recomputeZones() {
  const ctx = { overrides: S.overrides, rulesIndex: S.rulesIndex };
  S.zoneOf = new Map();
  for (const p of S.products.values()) S.zoneOf.set(p.id, resolveZone(p, ctx));
  S.sectionZones = computeSectionZones([...S.products.values()], ctx);
}

export const zonesByRoute = () => byRoute(S.zones);
export const zoneById = (id) => S.zones.find((z) => z.id === id) || null;
export const zoneIdOf = (pid) => S.zoneOf.get(pid)?.zoneId || null;
export const productById = (id) => S.products.get(id) || null;

/** Productos que se pueden elegir en la aplicación (sin Bebé ni Mascotas, y presentes en el catálogo). */
export const selectable = (p) => p && p.visible_in_app && p.active !== false && p.availability !== 'removed';

export function productsInZone(zoneId, { includeInactive = false } = {}) {
  const out = [];
  for (const p of S.products.values()) {
    if (!p.visible_in_app) continue;
    if (!includeInactive && !selectable(p)) continue;
    if ((S.zoneOf.get(p.id)?.zoneId || null) === zoneId) out.push(p);
  }
  return out;
}
export function unclassifiedProducts() {
  return [...S.products.values()].filter((p) => selectable(p) && !S.zoneOf.get(p.id)?.zoneId);
}

/* =================================================================
   CARGA DESDE SUPABASE
   ================================================================= */
export async function whoami() {
  return api.rpc('whoami', {});
}

export async function loadRemote(progress = () => {}) {
  progress('Comprobando la clave familiar…', 10);
  const who = await whoami();
  if (!who?.ok) { const e = new Error(who?.reason || 'invalid_key'); e.who = who; throw e; }
  S.household = who.household;
  S.store = who.store;
  S.serverOk = true;

  progress('Abriendo el mapa del súper…', 25);
  const [profiles, zones, rules, settings] = await Promise.all([
    api.select('family_profiles', (q) => q.eq('active', true).order('sort_order')),
    api.select('store_zones', (q) => q.eq('store_id', S.store.id).order('route_order')),
    api.selectAll('category_zone_rules', (q) => q.eq('store_id', S.store.id).order('level')),
    api.select('app_settings', (q) => q)
  ]);
  S.profiles = profiles;
  S.zones = zones;
  S.rules = rules;
  S.rulesIndex = indexRules(rules);
  S.settings = Object.fromEntries(settings.map((s) => [s.key, s.value]));

  progress('Repasando los productos de siempre…', 40);
  await Promise.all([refreshOverrides(false), refreshFrequency(false)]);

  progress('Actualizando precios y productos…', 55);
  await refreshProducts((pct) => progress('Actualizando precios y productos…', 55 + Math.round(pct * 0.25)));

  progress('Buscando la lista de la semana…', 85);
  await refreshLists(false);
  recomputeZones();
  await saveMeta();
  S.remoteLoaded = true;
  progress('Listo', 100);
  emit('all');
}

export async function refreshOverrides(doEmit = true) {
  const rows = await api.selectAll('product_zone_overrides', (q) => q.eq('store_id', S.store.id), { columns: 'product_id,zone_id,updated_by,updated_at' });
  S.overrides = new Map(rows.map((r) => [r.product_id, r.zone_id]));
  S.overrideMeta = new Map(rows.map((r) => [r.product_id, { updated_by: r.updated_by, updated_at: r.updated_at }]));
  if (doEmit) { recomputeZones(); await saveMeta(); emit('zones'); }
}

export async function refreshFrequency(doEmit = true) {
  const rows = await api.selectAll('v_product_frequency', (q) => q, { columns: 'product_id,list_count' });
  S.freq = new Map(rows.map((r) => [r.product_id, Number(r.list_count)]));
  if (doEmit) { await saveMeta(); emit('freq'); }
}

/** Solo descarga lo que ha cambiado desde la última vez (updated_at). */
export async function refreshProducts(onPct = () => {}) {
  const since = S.productsSince;
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const batch = await api.select('products', (q) => {
      let x = q.is('deleted_at', null).order('updated_at', { ascending: true }).order('id', { ascending: true });
      if (since) x = x.gt('updated_at', since);
      return x.range(from, from + page - 1);
    }, PRODUCT_COLUMNS);
    rows.push(...batch);
    onPct(Math.min(1, rows.length / Math.max(rows.length + (batch.length === page ? page : 0), 1)));
    if (batch.length < page) break;
  }
  if (rows.length) {
    setProducts(rows);
    await idb.putMany('products', rows);
    S.productsSince = rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), since || '');
  }
  return rows.length;
}

/** Productos de una lista que no están en la caché (por ejemplo, ocultos). */
async function ensureProducts(ids) {
  const missing = [...new Set(ids)].filter((id) => !S.products.has(id));
  if (!missing.length) return;
  for (let i = 0; i < missing.length; i += 200) {
    const rows = await api.select('products', (q) => q.in('id', missing.slice(i, i + 200)), PRODUCT_COLUMNS);
    setProducts(rows);
    await idb.putMany('products', rows);
  }
}

export async function refreshLists(doEmit = true) {
  const lists = await api.select('shopping_lists', (q) => q.in('status', ['draft', 'ready_to_shop', 'shopping']).is('deleted_at', null));
  const ids = lists.map((l) => l.id);
  const items = ids.length ? await api.selectAll('shopping_list_items', (q) => q.in('list_id', ids)) : [];
  await ensureProducts(items.map((i) => i.product_id));
  const draft = lists.find((l) => l.status === 'draft') || null;
  const pend = lists.find((l) => l.status !== 'draft') || null;
  mergeDraftFromServer(draft, items.filter((i) => i.list_id === draft?.id));
  S.pending = { list: pend, items: pend ? items.filter((i) => i.list_id === pend.id) : [] };
  await savePending();
  if (pend?.status === 'shopping') {
    const ses = await api.select('shopping_sessions', (q) => q.eq('list_id', pend.id).eq('status', 'active'));
    if (ses[0]) {
      const results = await api.selectAll('shopping_item_results', (q) => q.eq('session_id', ses[0].id));
      applySessionPayload({ session: ses[0], results });
    } else if (S.session && S.session.session?.list_id === pend.id && !S.session.finishing) {
      S.session = null; await saveSession();
    }
  } else if (S.session && !S.session.finishing && !S.queue.some((o) => o.kind === 'finish')) {
    S.session = null; await saveSession();
  }
  if (doEmit) emit('lists');
}

/** El borrador del servidor se mezcla con el local: lo cambiado aquí y no enviado tiene prioridad. */
function mergeDraftFromServer(list, serverItems) {
  const pendingIds = new Set(S.draft.dirty);
  for (const op of S.queue) if (op.kind === 'draft') op.payload.changes.forEach((c) => pendingIds.add(c.product_id));
  if (!list) {
    // Sin borrador en el servidor: si el local tenía id, se cerró/borró en otro dispositivo.
    if (S.draft.list?.id && !pendingIds.size) S.draft = { list: null, items: new Map(), dirty: new Set() };
    else if (S.draft.list?.id) S.draft.list = null;
    saveDraftLocal();
    return;
  }
  const items = new Map();
  for (const it of serverItems) items.set(it.product_id, { quantity: it.quantity, notes: it.notes, unit_price_snapshot: it.unit_price_snapshot, id: it.id, unavailable_ack_at: it.unavailable_ack_at });
  for (const pid of pendingIds) {
    const local = S.draft.items.get(pid);
    if (local && local.quantity > 0) items.set(pid, local); else items.delete(pid);
  }
  S.draft.list = list;
  S.draft.items = items;
  saveDraftLocal();
}

export async function refreshSyncStatus() {
  const r = await api.sync('status');
  S.sync = { ...S.sync, ...pickSync(r), checkedAt: new Date().toISOString() };
  emit('sync');
  return r;
}
export function pickSync(r) {
  return { last: r.last ?? S.sync.last, active: r.active ?? null, stale: !!r.stale, intervalHours: r.intervalHours || 12, lastFailed: r.lastFailed ?? null };
}
export function setSyncState(patch) { S.sync = { ...S.sync, ...patch }; saveMeta().catch(() => {}); emit('sync'); }

/* =================================================================
   BORRADOR DE LA LISTA
   ================================================================= */
export const draftQty = (pid) => S.draft.items.get(pid)?.quantity || 0;

/* Copia de seguridad SÍNCRONA (localStorage) de lo no enviado: sobrevive a cerrar la pestaña
   aunque IndexedDB no haya terminado de escribir. Las cantidades son absolutas: reaplicarlas es seguro. */
const BACKUP_KEY = 'despensaBorradorSinEnviar';
function pendingDraftIds() {
  const ids = new Set(S.draft.dirty);
  for (const op of S.queue) if (op.kind === 'draft') op.payload.changes.forEach((c) => ids.add(c.product_id));
  return ids;
}
function backupDraft() {
  const ids = pendingDraftIds();
  if (!ids.size) { ls.set(BACKUP_KEY, null); return; }
  ls.set(BACKUP_KEY, JSON.stringify({ at: Date.now(), changes: Object.fromEntries([...ids].map((pid) => [pid, draftQty(pid)])) }));
}
function restoreDraftBackup() {
  let b = null;
  try { b = JSON.parse(ls.get(BACKUP_KEY) || 'null'); } catch { b = null; }
  if (!b?.changes) return;
  for (const [pid, q] of Object.entries(b.changes)) {
    if (q > 0) S.draft.items.set(pid, { ...(S.draft.items.get(pid) || {}), quantity: q }); else S.draft.items.delete(pid);
    S.draft.dirty.add(pid);
  }
}

export function setDraftQty(pid, qty) {
  const q = Math.max(0, Math.min(99, Math.round(Number(qty) || 0)));
  const cur = S.draft.items.get(pid);
  if ((cur?.quantity || 0) === q) return;
  if (q === 0) S.draft.items.delete(pid);
  else S.draft.items.set(pid, { ...(cur || {}), quantity: q });
  S.draft.dirty.add(pid);
  backupDraft();
  saveDraftLocal();
  emit('draft');
}

export const hasUnsavedDraft = () => S.draft.dirty.size > 0 || S.queue.some((o) => o.kind === 'draft');

/** Pasa los cambios pendientes a la cola y los envía. */
export async function flushDraft() {
  if (S.draft.dirty.size) {
    const changes = [...S.draft.dirty].map((pid) => ({ product_id: pid, quantity: S.draft.items.get(pid)?.quantity || 0 }));
    S.queue = enqueue(S.queue, { id: uuid(), kind: 'draft', target: 'draft', payload: { listId: S.draft.list?.id || null, changes } });
    S.draft.dirty = new Set();
    await Promise.all([saveQueue(), saveDraftNow()]);
  }
  return processQueue();
}

/** Último intento al cerrar la pestaña (keepalive). Lo local ya está guardado en IndexedDB. */
export function flushOnExit() {
  if (S.draft.dirty.size) {
    const changes = [...S.draft.dirty].map((pid) => ({ product_id: pid, quantity: S.draft.items.get(pid)?.quantity || 0 }));
    S.queue = enqueue(S.queue, { id: uuid(), kind: 'draft', target: 'draft', payload: { listId: S.draft.list?.id || null, changes } });
    S.draft.dirty = new Set();
    saveQueue(); saveDraftNow();
  }
  const op = S.queue.find((o) => !o.failed && !o.sending);
  if (op?.kind === 'draft') {
    api.keepaliveRpc('save_list_draft', { p_changes: op.payload.changes, p_actor: S.me, p_op_id: op.id, p_list_id: op.payload.listId });
  } else if (op?.kind === 'results') {
    api.keepaliveRpc('record_item_results', { p_session_id: op.payload.sessionId, p_results: op.payload.results, p_device_id: S.deviceId, p_op_id: op.id });
  }
}

/* =================================================================
   COLA DE OPERACIONES
   ================================================================= */
let processing = null;
export function processQueue() {
  if (processing) return processing;
  // Ojo: el reinicio de «processing» va en .finally() para que ocurra DESPUÉS de asignarlo
  // (si la cola está vacía, el cuerpo termina sin ningún await).
  processing = (async () => {
    {
      while (api.ready && navigator.onLine) {
        const op = S.queue.find((o) => !o.failed);
        if (!op) break;
        op.sending = true;
        op.tries = (op.tries || 0) + 1;
        await saveQueue();
        try {
          const res = await runOp(op);
          S.queue = S.queue.filter((o) => o !== op);
          await saveQueue();
          await applyOpResult(op, res);
        } catch (e) {
          op.sending = false;
          op.lastError = explainError(e);
          if (!isNetworkError(e) && isPermanentError(e)) {
            op.failed = true;
            emit({ type: 'op-failed', op, message: op.lastError });
          }
          await saveQueue();
          if (!op.failed) break;   // sin red: se reintenta más tarde
        }
      }
    }
  })().finally(() => {
    processing = null;
    emit('queue');
  });
  return processing;
}

function runOp(op) {
  const p = op.payload;
  switch (op.kind) {
    case 'draft': return api.rpc('save_list_draft', { p_changes: p.changes, p_actor: S.me, p_op_id: op.id, p_list_id: S.draft.list?.id || p.listId || null });
    case 'results': return api.rpc('record_item_results', { p_session_id: p.sessionId, p_results: p.results, p_device_id: S.deviceId, p_op_id: op.id });
    case 'finish': return api.rpc('finish_shopping', { p_session_id: p.sessionId, p_ended_at: p.endedAt, p_op_id: op.id, p_force: !!p.force });
    default: return Promise.reject(new Error(`Operación desconocida: ${op.kind}`));
  }
}

async function applyOpResult(op, res) {
  if (op.kind === 'draft' && res?.list) {
    mergeDraftFromServer(res.list, res.items || []);
    backupDraft();
    emit('draft');
  } else if (op.kind === 'results' && res?.session) {
    applySessionPayload(res);
  } else if (op.kind === 'finish') {
    S.lastSummary = { ...res, synced: true };
    S.session = null;
    S.pending = { list: null, items: [] };
    await Promise.all([saveSession(), savePending()]);
    emit({ type: 'finished', summary: S.lastSummary });
    refreshFrequency().catch(() => {});
  }
}

export const queueInfo = () => ({
  pending: S.queue.filter((o) => !o.failed).length,
  failed: S.queue.filter((o) => o.failed),
  items: S.queue
});
export async function discardFailedOps() {
  S.queue = S.queue.filter((o) => !o.failed);
  await saveQueue();
  emit('queue');
}

/* =================================================================
   CERRAR, REABRIR Y AJUSTAR LISTAS (necesitan conexión)
   ================================================================= */
export async function closeDraft() {
  await flushDraft();
  if (S.queue.some((o) => o.kind === 'draft' && !o.failed)) {
    const e = new Error('offline'); e.userMessage = 'Hay cambios de la lista sin enviar. Necesitas conexión para cerrarla.'; throw e;
  }
  if (!S.draft.list?.id) { const e = new Error('lista_vacia'); e.userMessage = 'La lista está vacía.'; throw e; }
  const res = await api.rpc('close_list', { p_list_id: S.draft.list.id, p_actor: S.me, p_op_id: uuid() });
  S.pending = { list: res.list, items: res.items || [] };
  S.draft = { list: null, items: new Map(), dirty: new Set() };
  await Promise.all([savePending(), saveDraftNow()]);
  emit('lists');
  prefetchThumbs();
  return res.summary;
}

export async function reopenPending() {
  const res = await api.rpc('reopen_list', { p_list_id: S.pending.list.id, p_actor: S.me });
  S.pending = { list: null, items: [] };
  mergeDraftFromServer(res.list, res.items || []);
  await savePending();
  emit('lists');
}

export async function adjustPendingItem(productId, action, replacement = null) {
  const list = S.pending.list?.id ? S.pending.list : S.draft.list;
  const res = await api.rpc('adjust_closed_list_item', { p_list_id: list.id, p_product_id: productId, p_action: action, p_replacement: replacement, p_actor: S.me });
  await ensureProducts((res.items || []).map((i) => i.product_id));
  if (res.list.status === 'draft') mergeDraftFromServer(res.list, res.items || []);
  else { S.pending = { list: res.list, items: res.items || [] }; await savePending(); }
  emit('lists');
}

/* =================================================================
   LA COMPRA EN TIENDA
   ================================================================= */
export function applySessionPayload(p) {
  if (!p?.session) return;
  const local = S.session && S.session.session?.id === p.session.id ? [...S.session.results.values()] : [];
  const pendingLocal = [];
  for (const op of S.queue) if (op.kind === 'results' && op.payload.sessionId === p.session.id) pendingLocal.push(...op.payload.results);
  const merged = mergeResults(p.results || [], [...pendingLocal, ...local.filter((r) => r._local)]);
  S.session = { session: p.session, results: new Map(merged.map((r) => [r.list_item_id, r])), finishing: S.session?.finishing || null };
  if (S.pending.list && S.pending.list.id === p.session.list_id) S.pending.list = { ...S.pending.list, status: 'shopping' };
  saveSession(); savePending();
  emit('session');
}

/** Necesita conexión: así es imposible que dos dispositivos empiecen la misma compra. */
export async function startShopping(shopperCode) {
  const res = await api.rpc('start_shopping', { p_list_id: S.pending.list.id, p_shopper: shopperCode, p_device_id: S.deviceId, p_started_at: new Date().toISOString(), p_op_id: uuid() });
  S.pending.list = { ...S.pending.list, status: 'shopping' };
  applySessionPayload(res);
  prefetchThumbs();
  return res;
}

const scheduleResultsFlush = debounce(() => processQueue(), RESULTS_FLUSH_MS);

export function setResult(listItemId, status, collectedQty = 0) {
  if (!S.session) return;
  const cur = S.session.results.get(listItemId);
  if (!cur) return;
  const next = normalizeResult({ ...cur, status, collected_qty: collectedQty, resolved_at: new Date().toISOString(), _local: true }, cur.requested_qty);
  if (!shouldReplaceResult(cur, next)) return;
  S.session.results.set(listItemId, next);
  S.queue = enqueue(S.queue, { id: uuid(), kind: 'results', target: S.session.session.id, payload: { sessionId: S.session.session.id, results: [{ list_item_id: listItemId, status: next.status, collected_qty: next.collected_qty, resolved_at: next.resolved_at }] } });
  saveQueue(); saveSession();
  emit('session');
  scheduleResultsFlush();
}

export const flushResults = () => { scheduleResultsFlush.cancel(); return processQueue(); };

/** Termina la compra. Sin conexión queda en la cola y se calcula en cuanto vuelva la red. */
export async function finishShopping({ force = false } = {}) {
  const sessionId = S.session.session.id;
  const endedAt = new Date().toISOString();
  S.queue = enqueue(S.queue, { id: uuid(), kind: 'finish', target: sessionId, payload: { sessionId, endedAt, force } });
  S.session.finishing = endedAt;
  await Promise.all([saveQueue(), saveSession()]);
  await processQueue();
  const stillQueued = S.queue.find((o) => o.kind === 'finish' && o.payload.sessionId === sessionId);
  if (stillQueued?.failed) { const e = new Error(stillQueued.lastError); e.userMessage = stillQueued.lastError; throw e; }
  if (stillQueued) return { offline: true, ...localSummary(endedAt) };
  return S.lastSummary;
}

export function localSummary(endedAt = new Date().toISOString()) {
  const s = S.session?.session;
  if (!s) return null;
  const results = [...S.session.results.values()];
  const itemById = new Map(S.pending.items.map((i) => [i.id, i]));
  const price = (r) => Number(itemById.get(r.list_item_id)?.unit_price_snapshot ?? productById(r.product_id)?.price ?? 0);
  return {
    shopper: profileName(s.shopper_profile_id),
    duration_seconds: Math.max(0, Math.round((new Date(endedAt) - new Date(s.started_at)) / 1000)),
    planned_items: results.length,
    collected_items: results.filter((r) => r.status === 'collected').length,
    partial_items: results.filter((r) => r.status === 'partial').length,
    missing_items: results.filter((r) => r.status === 'out_of_stock').length,
    initial_estimated_total: Number(S.pending.list?.estimated_total || 0),
    final_estimated_total: Math.round(results.reduce((t, r) => t + (r.collected_qty || 0) * price(r), 0) * 100) / 100,
    deviation_pct: null,
    synced: false
  };
}

export async function cancelShopping() {
  const res = await api.rpc('cancel_shopping', { p_session_id: S.session.session.id, p_actor: S.me });
  S.queue = S.queue.filter((o) => !(o.kind === 'results' && o.payload.sessionId === S.session.session.id));
  S.session = null;
  S.pending = { list: res.list, items: res.items || [] };
  await Promise.all([saveQueue(), saveSession(), savePending()]);
  emit('lists');
}

/* =================================================================
   ZONAS
   ================================================================= */
/** Mueve productos (zoneId null = zona automática). Devuelve el estado anterior para deshacer. */
export async function setZones(assignments, reason = null) {
  const res = await api.rpc('set_product_zone_overrides', { p_assignments: assignments, p_actor: S.me, p_reason: reason, p_op_id: uuid() });
  const by = S.profiles.find((p) => p.code === S.me)?.id || null;
  for (const a of assignments) {
    if (a.zone_id) { S.overrides.set(a.product_id, a.zone_id); S.overrideMeta.set(a.product_id, { updated_by: by, updated_at: new Date().toISOString() }); }
    else { S.overrides.delete(a.product_id); S.overrideMeta.delete(a.product_id); }
  }
  recomputeZones();
  await saveMeta();
  emit('zones');
  return res.previous || [];
}

export async function updateZone(zone, patch) {
  const row = await api.rpc('update_zone', { p_zone_id: zone.id, p_name: patch.name ?? zone.name, p_summary: patch.summary ?? zone.summary, p_active: patch.active ?? zone.active, p_notes: patch.notes ?? zone.notes, p_actor: S.me });
  S.zones = S.zones.map((z) => (z.id === row.id ? row : z));
  await saveMeta();
  emit('zones');
}

export async function setCategoryRule(level, categoryId, categoryName, zoneId, confirmManually) {
  await api.rpc('set_category_rule', { p_level: level, p_category_id: categoryId, p_category_name: categoryName, p_zone_id: zoneId, p_confirm_manually: confirmManually, p_actor: S.me });
  S.rules = await api.selectAll('category_zone_rules', (q) => q.eq('store_id', S.store.id).order('level'));
  S.rulesIndex = indexRules(S.rules);
  recomputeZones();
  await saveMeta();
  emit('zones');
}

export async function setSetting(key, value) {
  const r = await api.rpc('set_setting', { p_key: key, p_value: value, p_actor: S.me });
  S.settings[key] = r.value;
  if (r.products_changed) { await refreshProducts(); recomputeZones(); }
  await saveMeta();
  emit('settings');
  return r;
}

/* =================================================================
   MINIATURAS SIN CONEXIÓN (solo la lista pendiente)
   ================================================================= */
const objectUrls = new Map();
export async function prefetchThumbs() {
  const items = S.pending.items || [];
  const urls = [...new Set(items.map((i) => productById(i.product_id)?.thumbnail_url).filter(Boolean))];
  const have = new Set(await idb.keys('thumbs').catch(() => []));
  for (const url of urls) {
    if (have.has(url) || !navigator.onLine) continue;
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) await idb.set('thumbs', url, await res.blob());
    } catch { /* sin CORS o sin red: se usará la imagen normal */ }
  }
  // Limpieza: solo se guardan las miniaturas de la lista pendiente
  const keep = new Set(urls);
  for (const k of have) if (!keep.has(k)) idb.del('thumbs', k).catch(() => {});
}
/** Carga en memoria las miniaturas guardadas de la lista pendiente. Devuelve cuántas hay. */
export async function loadCachedThumbs() {
  const urls = [...new Set((S.pending.items || []).map((i) => productById(i.product_id)?.thumbnail_url).filter(Boolean))];
  let n = 0;
  for (const u of urls) if (await cachedThumb(u)) n++;
  return n;
}
export const thumbFor = (url) => objectUrls.get(url) || null;
export async function cachedThumb(url) {
  if (!url) return null;
  if (objectUrls.has(url)) return objectUrls.get(url);
  try {
    const blob = await idb.get('thumbs', url);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    objectUrls.set(url, u);
    return u;
  } catch { return null; }
}

export { emit as notify, saveMeta };
