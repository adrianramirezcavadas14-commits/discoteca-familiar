// =====================================================================
// HOGAR · hogar-push · envía los avisos (notificaciones push) de Hogar
// · GET  ?action=key  → clave pública VAPID (la crea y la guarda la primera vez).
// · POST {action:"send"} con la cabecera x-hogar-secret (la llama la base de datos con pg_net)
//   → envía los avisos pendientes de hogar_push_outbox a los dispositivos de cada persona.
// · Web Push estándar (RFC 8030/8291/8292) con WebCrypto: sin librerías ni claves de terceros.
//   Funciona con Chrome/Android (FCM), Safari/iPhone (Apple), Firefox y Edge.
// · Usa la clave de servicio que Supabase pone sola en las funciones; nunca va a la web.
// · Autocontenida (sin imports) para poder desplegarla desde el editor del panel o con --use-api.
// =====================================================================
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-hogar-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:avisos-hogar@example.com';
const te = new TextEncoder();

/* ---------- Base de datos (PostgREST con la clave de servicio) ---------- */
function serviceKey(): string {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (k) return k;
  try { const all = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}'); return all.default || Object.values(all)[0] as string || ''; } catch { return ''; }
}
async function rpc(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const url = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = serviceKey();
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o la clave de servicio en la función.');
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/* ---------- Utilidades base64url ---------- */
const b64u = (buf: ArrayBuffer | Uint8Array) => {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/* ---------- VAPID ---------- */
type Vapid = { publicKey: string; privateJwk: JsonWebKey; signKey: CryptoKey };
let vapidCache: Vapid | null = null;
let secretCache = '';

async function loadConfig(create: boolean): Promise<{ vapid: Vapid | null; secret: string }> {
  let cfg = await rpc('hogar_push_config');
  if ((!cfg?.vapid_public || !cfg?.vapid_private) && create) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    cfg = await rpc('hogar_push_set_vapid', { p_public: pub, p_private: JSON.stringify(jwk) });   // si otra llamada ganó, se queda la suya
  }
  secretCache = cfg?.secret || '';
  if (!cfg?.vapid_public || !cfg?.vapid_private) return { vapid: null, secret: secretCache };
  if (!vapidCache || vapidCache.publicKey !== cfg.vapid_public) {
    const jwk = JSON.parse(cfg.vapid_private);
    const signKey = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    vapidCache = { publicKey: cfg.vapid_public, privateJwk: jwk, signKey };
  }
  return { vapid: vapidCache, secret: secretCache };
}

const jwtCache = new Map<string, { token: string; exp: number }>();
async function vapidAuth(endpoint: string, v: Vapid): Promise<string> {
  const aud = new URL(endpoint).origin;
  const hit = jwtCache.get(aud);
  const now = Math.floor(Date.now() / 1000);
  if (hit && hit.exp - 600 > now) return `vapid t=${hit.token}, k=${v.publicKey}`;
  const exp = now + 12 * 3600;
  const header = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(te.encode(JSON.stringify({ aud, exp, sub: SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.signKey, te.encode(`${header}.${claims}`));
  const token = `${header}.${claims}.${b64u(sig)}`;
  jwtCache.set(aud, { token, exp });
  return `vapid t=${token}, k=${v.publicKey}`;
}

/* ---------- Cifrado aes128gcm (RFC 8291) ---------- */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Claves del dispositivo no válidas');
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendOne(sub: { endpoint: string; p256dh: string; auth: string }, payload: Uint8Array, v: Vapid, topic: string | null) {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    Authorization: await vapidAuth(sub.endpoint, v),
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(4 * 24 * 3600),
    Urgency: 'high'
  };
  if (topic) headers.Topic = topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'hogar';
  const res = await fetch(sub.endpoint, { method: 'POST', headers, body });
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200);
  return { status: res.status, text };
}

/* ---------- Bucle de envío ---------- */
async function sendPending(v: Vapid) {
  let sent = 0, failed = 0, gone = 0;
  for (let round = 0; round < 10; round++) {
    const batch: any[] = await rpc('hogar_push_claim', { p_limit: 50 });
    if (!batch?.length) break;
    const results: any[] = [];
    const goneList: string[] = [];
    const okList: string[] = [];
    for (const n of batch) {
      const payload = te.encode(JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag || undefined }));
      let anyOk = !n.subs?.length;          // sin dispositivos: no hay nada que enviar
      const errors: string[] = [];
      for (const s of n.subs || []) {
        try {
          const r = await sendOne(s, payload, v, null);
          if (r.status >= 200 && r.status < 300) { anyOk = true; okList.push(s.endpoint); sent++; }
          else if (r.status === 404 || r.status === 410) { goneList.push(s.endpoint); gone++; anyOk = anyOk || false; }
          else { errors.push(`${r.status} ${r.text}`); failed++; }
        } catch (e) { errors.push(String((e as Error).message || e)); failed++; }
      }
      // Si todos los dispositivos ya no existen, el aviso se da por terminado (no hay a quién mandarlo).
      if (!anyOk && !errors.length) anyOk = true;
      results.push({ id: n.id, ok: anyOk, error: errors.join(' · ') || null });
    }
    await rpc('hogar_push_done', { p_results: results, p_gone: goneList, p_ok: okList });
    if (batch.length < 50) break;
  }
  return { sent, failed, gone };
}

const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET' && url.searchParams.get('action') === 'key') {
      const { vapid } = await loadConfig(true);
      return json({ ok: true, publicKey: vapid?.publicKey || null });
    }
    if (req.method === 'POST') {
      const { vapid, secret } = await loadConfig(true);
      if (!safeEqual(req.headers.get('x-hogar-secret') || '', secret)) return json({ ok: false, message: 'No autorizado' }, 401);
      if (!vapid) return json({ ok: false, message: 'Sin claves VAPID' }, 500);
      const out = await sendPending(vapid);
      return json({ ok: true, ...out });
    }
    return json({ ok: false, message: 'Uso: GET ?action=key o POST {action:"send"}' }, 400);
  } catch (e) {
    console.error('[hogar-push]', e);
    return json({ ok: false, message: String((e as Error).message || e) }, 500);
  }
});
