/* =====================================================================
   Sincronización del catálogo desde la interfaz
   · En cada entrada se pregunta al servidor si toca actualizar (≥ 12 h).
   · El navegador nunca descarga el catálogo de Mercadona: solo pide a la
     función «compra-sync» que avance y muestra el progreso real.
   · Si tarda, se puede seguir usando la aplicación (aviso en la cabecera).
   ===================================================================== */
import { api, explainError } from '../data/api.js';
import { S, pickSync, setSyncState, refreshProducts, recomputeZones, refreshLists, saveMeta } from '../data/store.js';
import { Loader, $, toast, sleep } from './dom.js';
import { fmtDateTime, timeAgo } from '../core/text.js';
import { SYNC_POLL_MS } from '../config.js';
import { broadcast } from './nav.js';

let loop = null;
let functionMissing = false;

const pct = (run) => (run?.categories_total ? Math.round((run.categories_done / run.categories_total) * 100) : 0);

export function renderSyncPill() {
  const pill = $('#syncPill');
  if (!pill) return;
  const a = S.sync.active;
  if (loop && a) { pill.hidden = false; pill.textContent = `🔄 Catálogo ${pct(a)} %`; pill.title = 'Actualizando el catálogo del supermercado'; return; }
  if (loop) { pill.hidden = false; pill.textContent = '🔄 Catálogo…'; return; }
  pill.hidden = true;
}

/** Texto de estado para Inicio y Ajustes. */
export function syncStatusText() {
  const last = S.sync.last?.finished_at;
  if (S.sync.active) return `Actualizando el catálogo (${pct(S.sync.active)} %)…`;
  if (!last) return 'El catálogo todavía no se ha descargado.';
  return `Precios actualizados el ${fmtDateTime(last)} (${timeAgo(last)}).`;
}

/** Comprobación de cada entrada, con la pantalla de carga del coyote. */
export async function runEntrySync() {
  if (!navigator.onLine || functionMissing) return;
  Loader.setProgress(92, 'Comprobando si hay novedades en el súper…');
  let r;
  try {
    r = await api.sync('ensure', { actor: S.me });
  } catch (e) {
    handleSyncError(e, true);
    return;
  }
  apply(r);
  if (r.state === 'fresh') return;
  if (r.state === 'completed') { await afterCompleted(r); return; }
  if (r.state === 'failed') { warnFailed(r); return; }
  // En marcha (aquí o en otro dispositivo): se muestra el progreso real
  Loader.show({ asset: 'startup', title: 'Actualizando el catálogo del súper', text: progressText(r), progress: pct(r.run || S.sync.active) });
  Loader.offerContinue('Seguir usando la despensa mientras tanto', () => { Loader.hide(0); });
  await driveLoop({ withLoader: true });
}

/** Sincronización manual desde Ajustes. */
export async function manualSync() {
  if (loop) return loop;
  Loader.show({ asset: 'startup', title: 'Actualizando el catálogo del súper', text: 'Pidiendo la actualización al servidor…', progress: 0 });
  Loader.offerContinue('Seguir usando la despensa mientras tanto', () => { Loader.hide(0); });
  let r;
  try { r = await api.sync('manual', { actor: S.me }); } catch (e) {
    const retry = await Loader.fail(explainError(e), { title: 'No se ha podido actualizar' });
    if (retry) return manualSync();
    return;
  }
  apply(r);
  if (r.state === 'fresh') { await Loader.done('El catálogo ya está al día', r.note || syncStatusText(), 1400); return; }
  if (r.state === 'completed') { await afterCompleted(r); if (Loader.isOpen()) await Loader.done('Catálogo actualizado', summaryText(r.stats)); return; }
  if (r.state === 'failed') { await Loader.fail(`${r.error || 'La sincronización ha fallado.'} Se conserva el catálogo anterior.`, { canRetry: false }); return; }
  Loader.setProgress(pct(r.run), progressText(r));
  return driveLoop({ withLoader: true });
}

function driveLoop({ withLoader }) {
  if (loop) return loop;
  loop = (async () => {
    renderSyncPill();
    try {
      for (let i = 0; i < 400; i++) {
        await sleep(S.sync.active && S.sync.active.requested_by && i > 0 ? SYNC_POLL_MS * 2 : SYNC_POLL_MS);
        if (!navigator.onLine) { await sleep(5000); continue; }
        let r;
        try { r = await api.sync('continue', { actor: S.me }); } catch (e) {
          if (Loader.isOpen() && withLoader) Loader.setProgress(pct(S.sync.active), `Reintentando… (${explainError(e)})`);
          await sleep(4000);
          continue;
        }
        apply(r);
        if (Loader.isOpen() && withLoader) Loader.setProgress(pct(r.run || S.sync.active), progressText(r));
        if (r.state === 'completed') { await afterCompleted(r); if (Loader.isOpen() && withLoader) await Loader.done('Catálogo actualizado', summaryText(r.stats)); return; }
        if (r.state === 'failed') { warnFailed(r); if (Loader.isOpen() && withLoader) await Loader.fail(`${r.error || 'La sincronización ha fallado.'} Se conserva el último catálogo correcto.`, { canRetry: false }); return; }
        if (r.state === 'fresh') {
          // Terminó en otro dispositivo
          if (S.sync.last?.finished_at) await afterCompleted(r);
          if (Loader.isOpen() && withLoader) await Loader.hide();
          return;
        }
      }
    } catch (e) {
      console.warn('Sincronización interrumpida', e);
    }
  })().finally(() => {
    loop = null;
    setSyncState({ active: null });
    renderSyncPill();
  });
  return loop;
}

function apply(r) {
  if (!r) return;
  setSyncState(pickSync(r));
  renderSyncPill();
}

function progressText(r) {
  const run = r.run || S.sync.active;
  if (!run) return 'Preparando la actualización…';
  const who = r.state === 'busy' && run.requested_by ? ` (iniciada por ${run.requested_by})` : '';
  if (run.status === 'applying') return 'Guardando el catálogo: precios, novedades y retirados…';
  if (run.categories_total && run.categories_done >= run.categories_total) return `Todas las categorías descargadas (${run.categories_total}). Completando fichas y guardando el catálogo…`;
  return `${run.categories_done || 0} de ${run.categories_total || '?'} categorías descargadas${who}.`;
}

function summaryText(stats = {}) {
  const parts = [];
  if (stats.new) parts.push(`${stats.new} productos nuevos`);
  if (stats.changes) parts.push(`${stats.changes} cambios`);
  if (stats.missing_changes) parts.push(`${stats.missing_changes} productos que ya no aparecen`);
  return parts.length ? `${parts.join(' · ')}.` : 'Sin cambios importantes.';
}

async function afterCompleted() {
  try {
    await refreshProducts();
    recomputeZones();
    await refreshLists();
    await saveMeta();
    broadcast('catalog');
    const { refreshNewsBadge, runEntryReviews } = await import('./review.js');
    refreshNewsBadge();
    if (!Loader.isOpen()) runEntryReviews();
  } catch (e) { console.warn('Catálogo actualizado pero no se pudo recargar', e); }
}

function warnFailed(r) {
  const last = S.sync.last?.finished_at;
  toast(`No se pudo actualizar el catálogo${last ? `; se usa el del ${fmtDateTime(last)}` : ''}.`, 5000);
  console.warn('Sincronización fallida', r?.error);
}

function handleSyncError(e, entry) {
  if (e?.status === 404 || e?.code === 'FUNCTION_NOT_FOUND') {
    functionMissing = true;
    if (entry) toast('La función de sincronización del catálogo no está desplegada. Se usa el catálogo guardado.', 5000);
    return;
  }
  if (entry) toast(`No se pudo comprobar el catálogo: ${explainError(e)}`, 4500);
}

export const syncRunning = () => !!loop;
