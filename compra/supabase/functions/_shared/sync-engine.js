// =====================================================================
// HOGAR · DESPENSA · Motor de sincronización incremental del catálogo
// ---------------------------------------------------------------------
// Cada llamada avanza un TRAMO con un presupuesto de tiempo:
//   1. sync_begin: crea la ejecución o devuelve la que ya está en marcha
//      (solo puede haber una a la vez; si se quedó sin latido, se retoma).
//   2. Plan: lista de categorías (una tarea por categoría).
//   3. Descarga categorías con concurrencia limitada, pausas y reintentos.
//      Si la API principal falla, prueba la copia de datania.
//   4. Cuando todas están descargadas: fichas detalladas (pocas por vez)
//      y apply_catalog_sync, que lo aplica TODO o NADA.
// El catálogo válido nunca se sustituye por una descarga incompleta.
// =====================================================================

import { extractProducts, detailFields } from './catalog-core.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SYNC_DEFAULTS = {
  budgetMs: 25000,        // tiempo de trabajo por llamada
  concurrency: 2,         // peticiones simultáneas a la fuente
  delayMs: 700,           // pausa entre peticiones de cada trabajador
  maxTaskAttempts: 3,     // intentos por categoría (en varias llamadas si hace falta)
  detailsPerRun: 40,      // fichas individuales por sincronización (EAN, marca, descripción)
  staleSeconds: 180,      // sin latido durante este tiempo = otra llamada puede retomarla
  minRatio: 0.8           // mínimo de productos frente al catálogo activo para aplicar
};

/**
 * @param {object} o
 * @param {object} o.db           adaptador de base de datos (ver db-supabase.js)
 * @param {object[]} o.providers  [principal, alternativo] (MercadonaCatalogProvider)
 * @param {string} o.householdId
 * @param {'auto'|'manual'} o.trigger
 * @param {string} o.requestedBy
 */
export async function runSyncStep({ db, providers, householdId, trigger = 'auto', requestedBy = 'familia', options = {}, now = () => Date.now(), sleepImpl = sleep }) {
  const opt = { ...SYNC_DEFAULTS, ...options };
  const t0 = now();
  const timeLeft = () => opt.budgetMs - (now() - t0);

  const begin = await db.rpc('sync_begin', { p_household: householdId, p_trigger: trigger, p_requested_by: requestedBy, p_stale_seconds: opt.staleSeconds });
  if (begin.state === 'busy') return { state: 'busy', run: publicRun(begin.run) };
  let run = begin.run;
  const token = run.lock_token;

  try {
    // ---------- Plan ----------
    if (begin.state === 'created') {
      let plan = null, used = null, planErrors = [];
      for (const p of providers) {
        try { plan = await p.listCategories(); used = p; break; } catch (e) { planErrors.push(`${p.name}: ${e.message}`); }
      }
      if (!plan) throw new Error(`No se pudo leer el árbol de categorías (${planErrors.join(' · ')})`);
      await db.insertTasks(run.id, plan.map((c) => ({ category_id: c.id, category_name: c.name, section_id: c.sectionId })));
      run = await db.updateRun(run.id, token, {
        provider: used.name,
        categories_total: plan.length,
        stats: { sections: [...new Set(plan.map((c) => c.sectionId))].length, planErrors }
      });
      await db.log(run.id, token, `Plan: ${plan.length} categorías desde ${used.name}`);
    }

    // ---------- Descarga ----------
    const sectionNames = new Map();
    const preferred = providers.find((p) => p.name === run.provider) || providers[0];
    const ordered = [preferred, ...providers.filter((p) => p !== preferred)];

    while (timeLeft() > 4000) {
      await db.rpc('sync_check', { p_run: run.id, p_token: token });   // latido + cerrojo
      const batch = await db.nextTasks(run.id, opt.concurrency * 3, opt.maxTaskAttempts);
      if (!batch.length) break;
      let i = 0;
      const worker = async () => {
        while (i < batch.length && timeLeft() > 3000) {
          const task = batch[i++];
          await processTask({ db, run, token, task, providers: ordered, sectionNames, opt });
          await sleepImpl(opt.delayMs);
        }
      };
      await Promise.all(Array.from({ length: opt.concurrency }, worker));
    }

    const progress = await db.taskProgress(run.id, opt.maxTaskAttempts);
    run = await db.updateRun(run.id, token, { categories_done: progress.done, categories_failed: progress.failed });

    if (progress.failed > 0) {
      const msg = `No se pudieron descargar ${progress.failed} categorías tras varios intentos. Se conserva el catálogo anterior.`;
      await db.rpc('sync_fail', { p_run: run.id, p_token: token, p_error: msg });
      return { state: 'failed', error: msg, run: publicRun({ ...run, status: 'failed' }) };
    }
    if (progress.pending > 0) {
      return { state: 'running', run: publicRun(run), progress };
    }

    // ---------- Fichas detalladas (pocas por sincronización) ----------
    if (opt.detailsPerRun > 0 && timeLeft() > 8000) {
      const ids = await db.rpc('sync_detail_candidates', { p_run: run.id, p_limit: opt.detailsPerRun });
      const list = (ids || []).map((r) => (typeof r === 'string' ? r : r.external_id));
      const fetched = [];
      for (const id of list) {
        if (timeLeft() < 6000) break;
        for (const p of ordered) {
          if (!p.fetchProduct) continue;
          try {
            const raw = await p.fetchProduct(id);
            const d = detailFields(raw);
            if (d) fetched.push({ external_id: id, detail: d });
            break;
          } catch { /* sin ficha: se intentará en otra sincronización */ }
        }
        await sleepImpl(opt.delayMs);
      }
      if (fetched.length) await db.mergeStagingDetails(run.id, token, fetched);
      if (list.length && fetched.length < list.length && timeLeft() < 6000) {
        return { state: 'running', run: publicRun(run), progress: { ...progress, details: fetched.length } };
      }
    }

    // ---------- Aplicar ----------
    await db.log(run.id, token, 'Aplicando el catálogo');
    const stats = await db.rpc('apply_catalog_sync', { p_run: run.id, p_token: token, p_min_ratio: opt.minRatio });
    return { state: 'completed', stats, run: publicRun({ ...run, status: 'completed', stats: { ...(run.stats || {}), ...stats } }) };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/sync_lock_lost/.test(msg)) return { state: 'busy', error: 'Otra llamada ha tomado el relevo de la sincronización.' };
    try { await db.rpc('sync_fail', { p_run: run.id, p_token: token, p_error: msg }); } catch { /* ya registrado o sin conexión */ }
    return { state: 'failed', error: msg, run: publicRun({ ...run, status: 'failed', error: msg }) };
  }
}

async function processTask({ db, run, token, task, providers, opt }) {
  let lastError = null;
  for (const p of providers) {
    try {
      const payload = await p.fetchCategory(task.category_id);
      const section = task.section_id != null ? { id: task.section_id, name: null } : null;
      const rows = extractProducts(payload, { section, source: p.name });
      await db.upsertStaging(run.id, rows);
      await db.markTask(run.id, task.category_id, { status: 'done', attempts: task.attempts + 1, provider_used: p.name, products: rows.length, error: null });
      return;
    } catch (e) {
      lastError = e;
    }
  }
  const attempts = task.attempts + 1;
  await db.markTask(run.id, task.category_id, {
    status: attempts >= opt.maxTaskAttempts ? 'failed' : 'pending',
    attempts,
    error: String(lastError?.message || lastError).slice(0, 400)
  });
}

/** Datos de la ejecución que se pueden mostrar en cualquier dispositivo. */
export function publicRun(run) {
  if (!run) return null;
  const { lock_token, log, ...rest } = run;
  return rest;
}

/** ¿Toca sincronizar? (comprobación en cada entrada; cada 12 h como mínimo por defecto) */
export function isStale(lastCompletedAt, intervalHours = 12, nowMs = Date.now()) {
  if (!lastCompletedAt) return true;
  const t = new Date(lastCompletedAt).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t >= Math.max(12, Number(intervalHours) || 12) * 3600 * 1000;
}
