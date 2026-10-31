// =====================================================================
// HOGAR · DESPENSA · Utilidades HTTP comunes a las funciones Edge
// =====================================================================

export function corsHeaders(req, allowed = '') {
  const origin = req.headers.get('origin') || '';
  const list = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allowOrigin = !list.length ? '*' : (list.includes(origin) ? origin : list[0]);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-compra-key, x-compra-cron',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

export function json(body, status = 200, cors = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

/** Familia de la petición (clave familiar opcional en x-compra-key) o tarea programada (x-compra-cron). */
export async function resolveCaller(req, db, { cronSecret = '' } = {}) {
  const cron = req.headers.get('x-compra-cron') || '';
  if (cronSecret && cron && timingSafeEqual(cron, cronSecret)) {
    const id = await db.rpc('first_household', {});
    return id ? { householdId: id, label: 'tarea programada', cron: true } : null;
  }
  // Clave familiar opcional: si la familia no tiene clave puesta, no hace falta enviarla.
  const key = (req.headers.get('x-compra-key') || '').trim().slice(0, 200);
  const id = await db.rpc('household_for_request', { p_key: key });
  return id ? { householdId: id, label: null, cron: false } : null;
}

export function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export const cleanText = (v, max = 200) => {
  const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
