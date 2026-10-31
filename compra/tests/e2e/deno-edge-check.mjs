// Arranca las funciones Edge REALES (index.ts) con Deno contra el entorno local y comprueba
// que responden: estado, clave errónea, CORS y que, sin acceso a Mercadona ni a datania,
// la sincronización falla de forma controlada SIN tocar el catálogo.
// Uso: DENO=/ruta/a/deno node tests/e2e/deno-edge-check.mjs
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStack } from './local-stack.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const deno = process.env.DENO || 'deno';
const stack = await startStack({ apiPort: 8091, webPort: 8090, pgrstPort: 3011, dbName: 'compra_deno', withKey: true });
const procs = [];
const results = [];
try {
  const start = (fn) => {
    const p = spawn(deno, ['run', '--allow-net', '--allow-env', '--allow-read', join(here, 'deno-serve-port.ts')], {
      env: { ...process.env, SUPABASE_URL: stack.apiBase, SUPABASE_SERVICE_ROLE_KEY: stack.serviceJwt, TEST_PORT: '8601', TEST_FUNCTION: fn, DENO_NO_UPDATE_CHECK: '1', NO_PROXY: 'localhost,127.0.0.1', no_proxy: 'localhost,127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true   // grupo propio: así se cierra también el binario real si «deno» es un lanzador
    });
    p.stderr.on('data', (d) => process.stderr.write(`[${fn}] ${d}`));
    procs.push(p);
  };
  start('compra-sync');   // el index.ts real, servido en el puerto 8601
  for (let i = 0; i < 80; i++) { try { await fetch('http://127.0.0.1:8601', { method: 'OPTIONS' }); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  const call = (body, key = stack.familyKey) => fetch('http://127.0.0.1:8601', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-compra-key': key, Origin: 'https://familia.github.io' }, body: JSON.stringify(body) });

  const pre = await fetch('http://127.0.0.1:8601', { method: 'OPTIONS', headers: { Origin: 'https://familia.github.io', 'Access-Control-Request-Headers': 'x-compra-key' } });
  assert.match(pre.headers.get('access-control-allow-headers'), /x-compra-key/);
  results.push('CORS: permite la cabecera x-compra-key'); console.log('✔', results.at(-1));

  let r = await call({ action: 'status' }, 'clave-mala-123');
  assert.equal(r.status, 401);
  results.push('Clave errónea: 401'); console.log('✔', results.at(-1));

  r = await call({ action: 'status' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).state, 'stale');
  results.push('Estado: sin catálogo todavía (stale)'); console.log('✔', results.at(-1));

  r = await call({ action: 'ensure', actor: 'mama' });
  const j = await r.json();
  assert.equal(j.state, 'failed', JSON.stringify(j));
  assert.match(j.error, /No se pudo leer el árbol de categorías/);
  const n = (await stack.pool.query('select count(*)::int n from compra.products')).rows[0].n;
  assert.equal(n, 0);
  results.push(`Sin acceso a las fuentes: la sincronización falla de forma controlada («${j.error.slice(0, 90)}…») y no toca el catálogo`); console.log('✔', results.at(-1));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  procs.forEach((p) => { try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); } });
  await Promise.race([stack.stop(), new Promise((r) => setTimeout(r, 3000))]);
  process.exit(process.exitCode || 0);
}
