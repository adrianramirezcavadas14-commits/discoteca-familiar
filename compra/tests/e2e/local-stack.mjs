// =====================================================================
// Entorno local que imita Supabase para las pruebas de extremo a extremo:
//   · PostgreSQL 16 real con las migraciones de compra/supabase/migrations
//   · PostgREST (el mismo motor de la API REST de Supabase)
//   · Puerta de entrada que, como Supabase, convierte la clave pública en el
//     rol «anon», sirve las funciones Edge (mismo código, en Node) y un
//     almacenamiento privado de archivos en disco.
//   · Servidor estático del repositorio (como GitHub Pages) en otro puerto.
// El catálogo se sirve con proveedores FALSOS (datos de prueba), porque desde
// este entorno no se puede llegar a la API de Mercadona.
// Variables: POSTGREST_BIN (ruta del binario), COMPRA_TEST_PG_* (ver tests/sql/helpers.mjs)
// =====================================================================
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { freshDatabase, FAMILY_KEY } from '../sql/helpers.mjs';
import { createSyncHandler } from '../../supabase/functions/_shared/sync-handler.js';
import { createTicketsHandler } from '../../supabase/functions/_shared/tickets-handler.js';
import { baseCatalog, fakeProvider } from '../fixtures/catalog-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO = join(here, '..', '..', '..');
const JWT_SECRET = 'secreto-local-de-pruebas-de-la-despensa-32+';
const PUBLISHABLE = 'sb_publishable_local_pruebas';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.pdf': 'application/pdf' };

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function jwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = b64u(createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

async function toRequest(req, base) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(new URL(req.url, base), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, duplex: 'half' });
}
async function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}
function waitFor(url, ms = 15000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tryIt = () => fetch(url, { headers: { 'Accept-Profile': 'compra' } }).then((r) => { if (r.ok) resolve(); else throw new Error(String(r.status)); }).catch(() => (Date.now() > until ? reject(new Error(`Sin respuesta de ${url}`)) : setTimeout(tryIt, 250)));
    tryIt();
  });
}

export async function startStack({ apiPort = 8081, webPort = 8080, pgrstPort = 3001, dbName = 'compra_e2e', withKey = false } = {}) {
  const pool = await freshDatabase(dbName, { withKey });
  const pg = process.env.COMPRA_TEST_PG_HOST || '/tmp';
  const pgPort = process.env.COMPRA_TEST_PG_PORT || '54329';
  const bin = process.env.POSTGREST_BIN || '/home/claude/tools/postgrest';
  const pgrst = spawn(bin, [], {
    env: {
      ...process.env,
      PGRST_DB_URI: `postgresql://authenticator@/${dbName}?host=${encodeURIComponent(pg)}&port=${pgPort}`,
      PGRST_DB_SCHEMAS: 'compra', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: JWT_SECRET,
      PGRST_SERVER_PORT: String(pgrstPort), PGRST_LOG_LEVEL: process.env.PGRST_LOG_LEVEL || 'crit', PGRST_DB_POOL: '6'
    },
    stdio: ['ignore', 'inherit', 'inherit']
  });
  await waitFor(`http://localhost:${pgrstPort}/`);

  const serviceJwt = jwt({ role: 'service_role', iss: 'local', iat: Math.floor(Date.now() / 1000) });
  const apiBase = `http://localhost:${apiPort}`;
  const serviceClient = createClient(apiBase, serviceJwt, { db: { schema: 'compra' }, auth: { persistSession: false, autoRefreshToken: false } });

  // Catálogo de prueba modificable durante la prueba
  const catalog = { current: baseCatalog(), calls: 0 };
  const providersFor = async () => {
    catalog.calls++;
    return [fakeProvider('mercadona-api', catalog.current), fakeProvider('datania', catalog.current)];
  };
  const syncHandler = createSyncHandler({ client: serviceClient, providersFor, syncOptions: { delayMs: 30, budgetMs: 6000, concurrency: 2, detailsPerRun: 5 } });

  // Almacenamiento privado en disco con URL firmadas que caducan
  const storeDir = join(here, 'artifacts', 'storage');
  mkdirSync(storeDir, { recursive: true });
  const signed = new Map();
  const storage = {
    async upload(path, bytes) { const f = join(storeDir, path.replace(/\//g, '__')); writeFileSync(f, bytes); },
    async remove() {},
    async signedUrl(path, secs) { const t = randomUUID(); signed.set(t, { path, until: Date.now() + secs * 1000 }); return `${apiBase}/storage/v1/object/sign/${t}`; }
  };
  const ticketsHandler = createTicketsHandler({ client: serviceClient, storage });

  const api = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, apiBase);
      const cors = {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'Content-Range, X-Total-Count'
      };
      if (url.pathname.startsWith('/functions/v1/')) {
        const name = url.pathname.split('/')[3];
        const handler = name === 'compra-sync' ? syncHandler : name === 'compra-tickets' ? ticketsHandler : null;
        if (!handler) { res.writeHead(404, cors); res.end('{"error":"Function not found"}'); return; }
        await sendResponse(res, await handler(await toRequest(req, apiBase)));
        return;
      }
      if (url.pathname.startsWith('/storage/v1/object/sign/')) {
        const s = signed.get(url.pathname.split('/').pop());
        if (!s || s.until < Date.now()) { res.writeHead(403); res.end('URL caducada'); return; }
        res.writeHead(200, { 'Content-Type': MIME[extname(s.path)] || 'application/octet-stream' });
        res.end(readFileSync(join(storeDir, s.path.replace(/\//g, '__'))));
        return;
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = { ...req.headers };
        delete headers.host; delete headers.apikey; delete headers['content-length'];
        // Como Supabase: la clave pública se convierte en el rol anónimo; solo pasa el JWT de servicio.
        if (headers.authorization !== `Bearer ${serviceJwt}`) delete headers.authorization;
        const upstream = await fetch(`http://localhost:${pgrstPort}${url.pathname.replace('/rest/v1', '')}${url.search}`, {
          method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined
        });
        const out = {};
        upstream.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'connection'].includes(k) && !k.startsWith('access-control-')) out[k] = v; });
        res.writeHead(upstream.status, { ...out, ...cors });
        res.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      res.writeHead(404, cors); res.end('{}');
    } catch (e) {
      console.error('Error en la puerta local', e);
      res.writeHead(500); res.end(String(e?.message || e));
    }
  });
  await new Promise((r) => api.listen(apiPort, r));

  // Servidor estático: el repositorio tal cual (como GitHub Pages)
  const web = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${webPort}`);
    let p = normalize(join(REPO, decodeURIComponent(url.pathname)));
    if (!p.startsWith(REPO)) { res.writeHead(403); res.end(); return; }
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!existsSync(p)) { res.writeHead(404); res.end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(readFileSync(p));
  });
  await new Promise((r) => web.listen(webPort, r));

  return {
    pool, catalog, apiBase, webBase: `http://localhost:${webPort}`, publishable: PUBLISHABLE, familyKey: FAMILY_KEY, serviceJwt,
    async stop() {
      web.closeAllConnections?.(); api.closeAllConnections?.();
      await new Promise((r) => web.close(r));
      await new Promise((r) => api.close(r));
      pgrst.kill('SIGTERM');
      await pool.end();
    }
  };
}
