// =====================================================================
// HOGAR · DESPENSA · Lógica HTTP de «compra-sync» (independiente de Deno)
// index.ts solo la conecta con Deno.serve y los secretos; las pruebas
// locales la usan tal cual con Node.
// =====================================================================
import { createMercadonaApiProvider, createDataniaProvider, resolveWarehouse } from './catalog-core.js';
import { runSyncStep, isStale, publicRun } from './sync-engine.js';
import { createSupabaseDb } from './db-supabase.js';
import { corsHeaders, json, resolveCaller, cleanText } from './http.js';

const MANUAL_MIN_MINUTES = 30;

/** Proveedores reales: API de Mercadona (con el almacén del código postal) y copia de datania. */
export function defaultProviders(client, fetchImpl = fetch) {
  return async (householdId) => {
    const { data: store } = await client.from('stores').select('id,postal_code,warehouse_code')
      .eq('household_id', householdId).eq('is_default', true).is('deleted_at', null).maybeSingle();
    let wh = store?.warehouse_code ?? null;
    if (store?.postal_code && !wh) {
      try {
        wh = await resolveWarehouse(fetchImpl, store.postal_code);
        if (wh) await client.from('stores').update({ warehouse_code: wh }).eq('id', store.id);
      } catch { /* sin almacén: surtido general */ }
    }
    // Tiempos acotados: si una fuente no responde, se pasa a la otra sin agotar la llamada.
    const retry = { retries: 2, timeoutMs: 10000 };
    return [createMercadonaApiProvider({ fetchImpl, warehouse: wh, retry }), createDataniaProvider({ fetchImpl, retry })];
  };
}

export function createSyncHandler({ client, providersFor, cronSecret = '', allowedOrigins = '', syncOptions = {} }) {
  const db = createSupabaseDb(client);

  async function lastRuns() {
    const { data: last } = await client.from('catalog_sync_runs')
      .select('id,status,provider,started_at,finished_at,products_seen,stats,trigger_kind,error')
      .eq('status', 'completed').order('finished_at', { ascending: false }).limit(1).maybeSingle();
    const { data: active } = await client.from('catalog_sync_runs')
      .select('id,status,provider,started_at,heartbeat_at,categories_total,categories_done,categories_failed,trigger_kind,requested_by')
      .in('status', ['running', 'applying']).maybeSingle();
    const { data: failed } = await client.from('catalog_sync_runs')
      .select('id,finished_at,error').eq('status', 'failed').order('finished_at', { ascending: false }).limit(1).maybeSingle();
    return { last, active, lastFailed: failed };
  }

  async function intervalHours(householdId) {
    const { data } = await client.from('app_settings').select('value').eq('household_id', householdId).eq('key', 'sync_interval_hours').maybeSingle();
    const n = Number(data?.value);
    return Number.isFinite(n) && n >= 12 ? n : 12;
  }

  return async function handle(req) {
    const cors = corsHeaders(req, allowedOrigins);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors);
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = String(body.action || 'status');
    const actor = cleanText(body.actor, 20) || 'familia';
    try {
      const caller = await resolveCaller(req, db, { cronSecret });
      if (!caller) return json({ error: 'Clave familiar no válida.', code: 'clave_familiar_no_valida' }, 401, cors);
      const hours = await intervalHours(caller.householdId);
      const runs = await lastRuns();
      const stale = isStale(runs.last?.finished_at, hours);
      const base = { intervalHours: hours, stale, last: runs.last, active: publicRun(runs.active), lastFailed: runs.lastFailed };

      if (action === 'status') return json({ state: runs.active ? 'running' : (stale ? 'stale' : 'fresh'), ...base }, 200, cors);
      if (!['ensure', 'continue', 'manual'].includes(action)) return json({ error: 'Acción desconocida' }, 400, cors);
      if (action === 'ensure' && !stale && !runs.active) return json({ state: 'fresh', ...base }, 200, cors);
      if (action === 'continue' && !runs.active && !stale) return json({ state: 'fresh', ...base }, 200, cors);
      if (action === 'manual' && !runs.active && runs.last?.finished_at &&
          Date.now() - new Date(runs.last.finished_at).getTime() < MANUAL_MIN_MINUTES * 60000) {
        return json({ state: 'fresh', ...base, note: `La última actualización tiene menos de ${MANUAL_MIN_MINUTES} minutos.` }, 200, cors);
      }
      const providers = await providersFor(caller.householdId);
      const result = await runSyncStep({
        db, providers, householdId: caller.householdId,
        trigger: action === 'manual' ? 'manual' : 'auto',
        requestedBy: caller.label || actor,
        options: syncOptions
      });
      const after = await lastRuns();
      return json({ ...result, intervalHours: hours, last: after.last, active: publicRun(after.active), lastFailed: after.lastFailed }, 200, cors);
    } catch (e) {
      console.error(e);
      return json({ state: 'error', error: String(e?.message || e) }, 500, cors);
    }
  };
}
