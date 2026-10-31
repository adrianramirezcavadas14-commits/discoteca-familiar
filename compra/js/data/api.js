/* =====================================================================
   Conexión con Supabase (PostgreSQL, funciones RPC, Edge Functions y
   Realtime). La clave familiar viaja en la cabecera «x-compra-key».
   Nunca se usa la clave service_role en el navegador.
   ===================================================================== */
import { SUPABASE_JS, DB_SCHEMA, NET_TIMEOUT, SYNC_FUNCTION, TICKETS_FUNCTION } from '../config.js';

export class ApiError extends Error {
  constructor(message, { code = '', userMessage = '', status = 0, detail = '', offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.userMessage = userMessage;
    this.status = status;
    this.detail = detail;
    this.offline = offline;
  }
}

const state = { cfg: null, key: '', client: null, libPromise: null };

export function withTimeout(promise, ms = NET_TIMEOUT) {
  let t;
  return Promise.race([
    promise,
    new Promise((_, reject) => { t = setTimeout(() => reject(new ApiError('Tiempo de espera agotado', { code: 'TIMEOUT' })), ms); })
  ]).finally(() => clearTimeout(t));
}

function loadScript(url, ms = 12000) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    const t = setTimeout(() => { el.remove(); reject(new Error(`Sin respuesta de ${url}`)); }, ms);
    el.src = url; el.async = true;
    el.onload = () => { clearTimeout(t); resolve(); };
    el.onerror = () => { clearTimeout(t); el.remove(); reject(new Error(`No se pudo cargar ${url}`)); };
    document.head.appendChild(el);
  });
}

/** Carga supabase-js probando dos CDN (versión fija). */
export function loadSupabaseLib() {
  if (window.supabase?.createClient) return Promise.resolve(true);
  if (!state.libPromise) {
    state.libPromise = (async () => {
      for (const url of SUPABASE_JS) {
        try { await loadScript(url); if (window.supabase?.createClient) return true; } catch (e) { console.warn(e.message); }
      }
      return false;
    })().then((ok) => { if (!ok) state.libPromise = null; return ok; });
  }
  return state.libPromise;
}

/** Problemas de configuración que impiden conectar (sin red de por medio). */
export function configProblem(cfg) {
  if (!cfg?.url) return 'Falta la Project URL en compra/supabase-config.js.';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(cfg.url) && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(cfg.url)) return 'La Project URL de compra/supabase-config.js no parece de Supabase.';
  const key = cfg.publishableKey || cfg.anonKey;
  if (!key) return 'Falta la clave pública (publishable key) en compra/supabase-config.js.';
  if (/^sb_secret_/i.test(key)) return 'La clave de compra/supabase-config.js es SECRETA. Usa la publishable key (sb_publishable_…).';
  if (key.split('.').length === 3) {
    try { if (/service_role/.test(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))) return 'La clave de compra/supabase-config.js es service_role. Usa solo la clave pública.'; } catch { /* no es JWT */ }
  }
  return '';
}

export const api = {
  get ready() { return !!state.client; },
  get key() { return state.key; },
  get cfg() { return state.cfg; },
  get client() { return state.client; },

  configure(cfg, familyKey) {
    state.cfg = cfg;
    state.key = String(familyKey || '').trim();
    const key = cfg.publishableKey || cfg.anonKey;
    state.client = window.supabase.createClient(cfg.url, key, {
      db: { schema: DB_SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: state.key ? { 'x-compra-key': state.key } : {} },
      realtime: { params: { eventsPerSecond: 5 } }
    });
    return state.client;
  },

  async rpc(name, args = {}, ms = NET_TIMEOUT) {
    assertClient();
    const { data, error } = await withTimeout(state.client.rpc(name, args), ms);
    if (error) throw toApiError(error);
    return data;
  },

  /** Select paginado (PostgREST devuelve como mucho 1000 filas por petición). */
  async selectAll(table, build = (q) => q, { columns = '*', page = 1000, ms = 25000 } = {}) {
    assertClient();
    const out = [];
    for (let from = 0; ; from += page) {
      const q = build(state.client.from(table).select(columns)).range(from, from + page - 1);
      const { data, error } = await withTimeout(q, ms);
      if (error) throw toApiError(error);
      out.push(...data);
      if (data.length < page) break;
    }
    return out;
  },

  async select(table, build = (q) => q, columns = '*') {
    assertClient();
    const { data, error } = await withTimeout(build(state.client.from(table).select(columns)));
    if (error) throw toApiError(error);
    return data;
  },

  /** Llamada a una función Edge con la clave familiar. */
  async edge(name, body, { ms = 60000, form = null } = {}) {
    if (!state.cfg) throw new ApiError('Sin configuración', { userMessage: 'La aplicación no está conectada.' });
    const key = state.cfg.publishableKey || state.cfg.anonKey;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(`${String(state.cfg.url).replace(/\/$/, '')}/functions/v1/${name}`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'x-compra-key': state.key, ...(form ? {} : { 'Content-Type': 'application/json' }) },
        body: form || JSON.stringify(body || {})
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        throw new ApiError(msg, {
          status: res.status, code: data?.code || (res.status === 404 ? 'FUNCTION_NOT_FOUND' : ''),
          userMessage: res.status === 404 ? `La función «${name}» no está desplegada en Supabase.` : (data?.error || ''),
          detail: data?.detail || ''
        });
      }
      return data;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(e?.name === 'AbortError' ? 'Tiempo de espera agotado' : String(e?.message || e), { code: e?.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', offline: !navigator.onLine });
    } finally { clearTimeout(t); }
  },

  sync(action, extra = {}) { return api.edge(SYNC_FUNCTION, { action, ...extra }, { ms: 70000 }); },
  tickets(bodyOrForm) {
    return bodyOrForm instanceof FormData ? api.edge(TICKETS_FUNCTION, null, { form: bodyOrForm, ms: 90000 }) : api.edge(TICKETS_FUNCTION, bodyOrForm);
  },

  /**
   * Envío de último momento (al cerrar la pestaña): fetch con keepalive directamente a PostgREST.
   * Usa el mismo op_id que la cola, así que si luego se reenvía no se duplica.
   */
  keepaliveRpc(name, args) {
    if (!state.cfg || !state.key) return false;
    const key = state.cfg.publishableKey || state.cfg.anonKey;
    try {
      fetch(`${String(state.cfg.url).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
        method: 'POST', keepalive: true,
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Profile': DB_SCHEMA, 'x-compra-key': state.key },
        body: JSON.stringify(args)
      }).catch(() => {});
      return true;
    } catch { return false; }
  },

  /** Canal de avisos entre dispositivos (sin datos: solo «algo ha cambiado»). */
  channel(name, onPing) {
    if (!state.client?.channel) return null;
    try {
      const ch = state.client.channel(name, { config: { broadcast: { self: false } } });
      ch.on('broadcast', { event: 'changed' }, ({ payload }) => onPing(payload || {}));
      ch.subscribe();
      return {
        ping(what) { try { ch.send({ type: 'broadcast', event: 'changed', payload: { what, at: Date.now() } }); } catch { /* sin tiempo real */ } },
        close() { try { state.client.removeChannel(ch); } catch { /* nada */ } }
      };
    } catch (e) {
      console.warn('Tiempo real no disponible', e);
      return null;
    }
  }
};

function assertClient() {
  if (!state.client) throw new ApiError('Sin cliente', { userMessage: 'La despensa todavía no está conectada con Supabase.' });
}

export function toApiError(error) {
  if (error instanceof ApiError) return error;
  const msg = String(error?.message || error || '');
  const code = String(error?.code || '');
  return new ApiError(msg, { code, userMessage: error?.hint && code === 'P0001' ? error.hint : '', detail: error?.details || '', status: error?.status || 0 });
}

/** Mensaje claro para la familia. */
export function explainError(e) {
  const msg = String(e?.message || e || '');
  const code = String(e?.code || '');
  if (e?.userMessage) return e.userMessage;
  if (code === 'TIMEOUT') return 'La operación está tardando demasiado. Comprueba la conexión y vuelve a intentarlo.';
  if (!navigator.onLine || code === 'NETWORK' || /Failed to fetch|NetworkError|Load failed|network ?error/i.test(msg)) return 'No hay conexión con Supabase. Comprueba la red o vuelve a intentarlo en un momento.';
  if (/clave_familiar_no_valida/.test(msg)) return 'La clave familiar no es válida. Revísala en Ajustes.';
  if (code === 'PGRST106' || /schema must be one of|Invalid schema/i.test(msg)) return 'Supabase no expone el esquema «compra». Añádelo en Project Settings → Data API → Exposed schemas (ver compra/docs/INSTALACION.md).';
  if (code === '42P01' || code === 'PGRST205' || /does not exist|Could not find the (table|function)/i.test(msg)) return 'Faltan tablas o funciones en Supabase. Ejecuta las migraciones de compra/supabase/migrations.';
  if (code === '42501' || /permission denied|row-level security/i.test(msg)) return 'Supabase ha rechazado el permiso. Revisa la clave familiar y las migraciones.';
  if (/Invalid API key|No API key/i.test(msg)) return 'La clave pública de compra/supabase-config.js no es válida.';
  if (e?.status === 540 || /paused|project is paused/i.test(msg)) return 'El proyecto de Supabase está en pausa por inactividad. Reactívalo desde el panel de Supabase y vuelve a intentarlo.';
  if (e?.status >= 500 || /5\d\d/.test(code)) return 'Supabase no responde ahora mismo (puede estar despertando tras una pausa). Vuelve a intentarlo en un minuto.';
  return msg || 'Ha ocurrido un error inesperado.';
}

export const isNetworkError = (e) => {
  const msg = String(e?.message || '');
  return e?.code === 'TIMEOUT' || e?.code === 'NETWORK' || e?.offline || !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network ?error/i.test(msg) || (e?.status >= 500 && e?.status < 600) || e?.status === 540;
};
