/* =====================================================================
   Datos de la versión 1.2 (todo en Supabase, sincronizado entre dispositivos):
   · «Pendientes de revisar» (compra.product_review_flags)
   · «Pendientes no urgentes» (compra.backlog_items) y mover entre listas
   · «Menú semanal» (compra.recipes + compra.menu_entries) e imágenes
   La copia en IndexedDB solo sirve para VER sin conexión: los cambios
   necesitan conexión y se confirman en el servidor antes de mostrarse.
   ===================================================================== */
import { S, notify, flushDraft, refreshLists, queueInfo } from './store.js';
import { api, ApiError, isNetworkError, explainError } from './api.js';
import { idb } from './idb.js';
import { uuid } from '../core/text.js';

const emit = (what) => notify(what);

/* ---------- Copia local (solo lectura sin conexión) ---------- */
async function savePlans() {
  try {
    await idb.set('kv', 'plans', {
      flags: [...S.flags], backlog: [...S.backlog], recipes: [...S.recipes], menu: [...S.menu], menuWeeks: [...S.menuWeeks], savedAt: new Date().toISOString()
    });
  } catch (e) { console.warn('[Despensa] No se pudo guardar la copia local del menú y los pendientes', e); }
}
export async function loadPlansLocal() {
  try {
    const p = await idb.get('kv', 'plans');
    if (!p) return false;
    S.flags = new Map(p.flags || []);
    S.backlog = new Map(p.backlog || []);
    S.recipes = new Map(p.recipes || []);
    S.menu = new Map(p.menu || []);
    S.menuWeeks = new Set(); // lo descargado sin conexión no cuenta como confirmado: se vuelve a pedir
    return true;
  } catch { return false; }
}

/** Las escrituras de estas secciones necesitan conexión confirmada con Supabase. */
function requireOnline(what) {
  if (!api.ready || !navigator.onLine || !S.serverOk) {
    throw new ApiError('offline', { code: 'NETWORK', offline: true, userMessage: `Sin conexión: ${what} necesita conexión para que lo vea toda la familia. No se ha cambiado nada.` });
  }
}

/** Reintenta una vez si se pierde la respuesta: el mismo op_id hace que el servidor no lo repita. */
async function rpcOnce(name, args) {
  try { return await api.rpc(name, args); } catch (e) {
    if (!isNetworkError(e) || !navigator.onLine) throw e;
    await new Promise((r) => setTimeout(r, 1200));
    return api.rpc(name, args);
  }
}

function missingTables(e) {
  const msg = String(e?.message || '');
  return e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === 'PGRST202' || /does not exist|Could not find the (table|function)/i.test(msg);
}
function remember(e) {
  S.plansError = missingTables(e)
    ? 'Falta la actualización de la base de datos de la versión 1.2 (migración 20261101100000_compra_menu_y_pendientes.sql).'
    : explainError(e);
  console.error('[Despensa] Menú y pendientes:', e?.message || e);
}

/* =================================================================
   PENDIENTES DE REVISAR
   ================================================================= */
export async function refreshFlags(doEmit = true) {
  try {
    const rows = await api.selectAll('product_review_flags', (q) => q.order('flagged_at', { ascending: false }), { columns: 'product_id,note,flagged_by,flagged_at' });
    S.flags = new Map(rows.map((r) => [r.product_id, r]));
    S.plansError = '';
    await savePlans();
    if (doEmit) emit('flags');
  } catch (e) { remember(e); if (doEmit) emit('flags'); }
}
export const isFlagged = (pid) => S.flags.has(pid);

export async function setReviewFlag(pid, flagged) {
  requireOnline(flagged ? 'marcar para revisar' : 'quitar la marca');
  const res = await rpcOnce('set_review_flag', { p_product_id: pid, p_flagged: !!flagged, p_note: null, p_actor: S.me });
  if (res.flagged) S.flags.set(pid, res.flag); else S.flags.delete(pid);
  await savePlans();
  emit('flags');
  return res.flagged;
}

/* =================================================================
   PENDIENTES NO URGENTES
   ================================================================= */
function applyBacklog(rows) {
  S.backlog = new Map((rows || []).map((r) => [r.product_id, { id: r.id, quantity: r.quantity, notes: r.notes, updated_at: r.updated_at, added_by: r.added_by }]));
}
export async function refreshBacklog(doEmit = true) {
  try {
    const rows = await api.selectAll('backlog_items', (q) => q.order('created_at', { ascending: true }), { columns: 'id,product_id,quantity,notes,added_by,updated_at,created_at' });
    applyBacklog(rows);
    S.plansError = '';
    await savePlans();
    if (doEmit) emit('backlog');
  } catch (e) { remember(e); if (doEmit) emit('backlog'); }
}
export const backlogQty = (pid) => S.backlog.get(pid)?.quantity || 0;

/** Cantidad absoluta (0 = quitar). */
export async function setBacklogQty(pid, qty) {
  requireOnline('cambiar «Pendientes no urgentes»');
  const q = Math.max(0, Math.min(99, Math.round(Number(qty) || 0)));
  const res = await rpcOnce('save_backlog', { p_changes: [{ product_id: pid, quantity: q }], p_actor: S.me, p_op_id: uuid() });
  applyBacklog(res.backlog);
  await savePlans();
  emit('backlog');
}

/**
 * Mueve un producto entre la lista principal y «Pendientes no urgentes» (to: 'backlog' | 'main').
 * Primero se envían los cambios pendientes de la lista; después el servidor mueve el producto en
 * una sola transacción (se suma en el destino si ya estaba; nunca se marca como comprado).
 */
export async function moveBetweenLists(pid, to) {
  requireOnline('mover productos entre listas');
  await flushDraft();
  if (queueInfo().items.some((o) => o.kind === 'draft' && !o.failed)) {
    throw new ApiError('pendiente', { userMessage: 'Todavía hay cambios de la lista sin enviar. Inténtalo en un momento, cuando se hayan guardado.' });
  }
  const opId = uuid();
  const res = await rpcOnce('move_between_lists', { p_product_id: pid, p_to: to, p_actor: S.me, p_op_id: opId });
  applyBacklog(res.backlog);
  await savePlans();
  await refreshLists();          // la lista principal se vuelve a leer del servidor (ya no hay cambios sin enviar)
  emit('backlog');
  return res;
}

/* =================================================================
   MENÚ SEMANAL
   ================================================================= */
export async function refreshRecipes(doEmit = true) {
  try {
    const rows = await api.selectAll('recipes', (q) => q.order('name', { ascending: true }));
    S.recipes = new Map(rows.map((r) => [r.id, r]));
    S.plansError = '';
    await savePlans();
    if (doEmit) emit('menu');
  } catch (e) { remember(e); if (doEmit) emit('menu'); }
}

/** Descarga las entradas de una semana (lunes AAAA-MM-DD). */
export async function loadMenuWeek(weekStart, { force = false } = {}) {
  if (!force && S.menuWeeks.has(weekStart)) return;
  try {
    const rows = await api.selectAll('menu_entries', (q) => q.eq('week_start', weekStart).order('menu_date').order('slot').order('position'));
    for (const [id, e] of S.menu) if (e.week_start === weekStart) S.menu.delete(id);
    for (const r of rows) S.menu.set(r.id, r);
    const missing = rows.filter((r) => !S.recipes.has(r.recipe_id));
    if (missing.length) await refreshRecipes(false);
    S.menuWeeks.add(weekStart);
    S.plansError = '';
    await savePlans();
    emit('menu');
  } catch (e) { remember(e); emit('menu'); throw e; }
}
/** Tras un aviso de otro dispositivo: se vuelven a pedir las semanas que se estaban viendo. */
export async function refreshMenu() {
  const weeks = [...S.menuWeeks];
  S.menuWeeks = new Set();
  await refreshRecipes(false);
  for (const w of weeks) await loadMenuWeek(w, { force: true }).catch(() => {});
  emit('menu');
}

export const menuFor = (iso, slot) => [...S.menu.values()].filter((e) => e.menu_date === iso && e.slot === slot).sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));

/**
 * Añade una receta a un día. Con recipeId reutiliza la receta (y su imagen).
 * Con name: si ya existe una receta con ese nombre (sin tildes ni mayúsculas) se reutiliza;
 * si es nueva, image es obligatoria: { url, source, page, credit }.
 */
export async function addMenuEntry({ date, slot, recipeId = null, name = null, image = null }) {
  requireOnline('cambiar el menú');
  const res = await rpcOnce('menu_add', {
    p_date: date, p_slot: slot, p_recipe_id: recipeId, p_name: name,
    p_image_url: image?.url || null, p_image_source: image?.source || null, p_image_page_url: image?.page || null, p_image_credit: image?.credit || null,
    p_actor: S.me, p_op_id: uuid()
  });
  S.recipes.set(res.recipe.id, res.recipe);
  S.menu.set(res.entry.id, res.entry);
  await savePlans();
  emit('menu');
  return res;
}
export async function removeMenuEntry(entryId) {
  requireOnline('cambiar el menú');
  await rpcOnce('menu_remove', { p_entry_id: entryId, p_actor: S.me });
  S.menu.delete(entryId);
  await savePlans();
  emit('menu');
}
export async function setRecipeImage(recipeId, image) {
  requireOnline('cambiar la imagen');
  const row = await rpcOnce('recipe_set_image', { p_recipe_id: recipeId, p_image_url: image.url, p_image_source: image.source || null, p_image_page_url: image.page || null, p_image_credit: image.credit || null, p_actor: S.me });
  S.recipes.set(row.id, row);
  await savePlans();
  emit('menu');
  return row;
}

/** Recetas usadas antes en esa categoría (comida o cena), sin mezclar. */
export function recipesFor(slot) {
  const k = slot === 'cena' ? 'for_dinner' : 'for_lunch';
  return [...S.recipes.values()].filter((r) => r[k]);
}

/** Búsqueda de imágenes en el servidor (función compra-recetas). */
const imageCache = new Map();
export async function searchRecipeImages(q, page = 0) {
  const key = `${String(q).trim().toLowerCase()}|${page}`;
  if (imageCache.has(key)) return imageCache.get(key);
  requireOnline('buscar imágenes');
  const res = await api.recipes({ action: 'buscar', q, page });
  imageCache.set(key, res);
  return res;
}
export async function uploadRecipeImage(file) {
  requireOnline('subir la foto');
  const form = new FormData();
  form.append('action', 'subir');
  form.append('file', file, file.name || 'receta.jpg');
  return api.recipes(form);
}

/** Todo lo de la versión 1.2 al arrancar o tras volver la conexión. */
export async function refreshPlans() {
  await Promise.all([refreshFlags(false), refreshBacklog(false)]);
  emit('backlog');
  emit('flags');
}
