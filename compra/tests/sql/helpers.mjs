// Utilidades para probar las migraciones contra un PostgreSQL real.
// Variables: COMPRA_TEST_PG_HOST (/tmp), COMPRA_TEST_PG_PORT (54329), COMPRA_TEST_PG_USER (postgres)
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, '..', '..', 'supabase', 'migrations');
export const FAMILY_KEY = 'clave-de-prueba-123';
export const HOUSEHOLD = '00000000-0000-4000-8000-000000000001';
export const STORE = '00000000-0000-4000-8000-000000000101';

const base = {
  host: process.env.COMPRA_TEST_PG_HOST || '/tmp',
  port: Number(process.env.COMPRA_TEST_PG_PORT || 54329),
  user: process.env.COMPRA_TEST_PG_USER || 'postgres'
};

export async function pgAvailable() {
  const c = new pg.Client({ ...base, database: 'postgres' });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}

/** Crea una base de datos nueva, aplica 00_entorno + todas las migraciones (dos veces: idempotencia). */
export async function freshDatabase(name, { withKey = true } = {}) {
  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.query(`create database ${name}`);
  await admin.end();
  const pool = new pg.Pool({ ...base, database: name, max: 6 });
  await pool.query(readFileSync(join(here, '00_entorno_local_supabase.sql'), 'utf8'));
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (let round = 0; round < 2; round++) {
    for (const f of files) await pool.query(readFileSync(join(MIGRATIONS, f), 'utf8'));
  }
  if (withKey) await pool.query('select compra.set_household_key($1)', [FAMILY_KEY]);
  return pool;
}

/** Ejecuta fn como el rol anónimo de Supabase con la cabecera x-compra-key indicada. */
export async function asAnon(pool, key, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role anon');
    await c.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(key == null ? {} : { 'x-compra-key': key })]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { c.release(); }
}

export const rpc = async (c, fn, args = {}) => {
  const names = Object.keys(args);
  const sql = `select to_jsonb(compra.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})) as v`;
  const vals = names.map((n) => (n === 'p_value' ? JSON.stringify(args[n]) : args[n] !== null && typeof args[n] === 'object' && !(args[n] instanceof Date) && !Array.isArray(args[n]) ? JSON.stringify(args[n])
    : Array.isArray(args[n]) && n !== 'p_change_ids' ? JSON.stringify(args[n]) : args[n]));
  await c.query('savepoint rpc_call');
  try {
    const r = await c.query(sql, vals);
    await c.query('release savepoint rpc_call');
    return r.rows[0]?.v;
  } catch (e) {
    await c.query('rollback to savepoint rpc_call');
    throw e;
  }
};

/** Adaptador del motor de sincronización sobre pg (equivalente a db-supabase.js). */
export function createPgDb(pool) {
  const SETOF = new Set(['sync_detail_candidates']);
  const VOID = new Set(['sync_fail', 'sync_log']);
  return {
    async rpc(name, args) {
      const names = Object.keys(args || {});
      const call = `compra.${name}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      const vals = names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n]));
      if (SETOF.has(name)) return (await pool.query(`select * from ${call}`, vals)).rows;
      if (VOID.has(name)) { await pool.query(`select ${call}`, vals); return null; }
      return (await pool.query(`select to_jsonb(${call}) as v`, vals)).rows[0].v;
    },
    async insertTasks(runId, tasks) {
      for (const t of tasks) {
        await pool.query('insert into compra.catalog_sync_tasks (run_id, category_id, category_name, section_id) values ($1,$2,$3,$4) on conflict do nothing',
          [runId, t.category_id, t.category_name, t.section_id]);
      }
    },
    async updateRun(runId, token, patch) {
      const keys = Object.keys(patch);
      const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
      const vals = keys.map((k) => (patch[k] !== null && typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k]));
      const r = await pool.query(`update compra.catalog_sync_runs set ${sets} where id = $1 and lock_token = $2 returning *`, [runId, token, ...vals]);
      if (!r.rows[0]) throw new Error('sync_lock_lost');
      return r.rows[0];
    },
    async log(runId, token, msg) { await pool.query('select compra.sync_log($1,$2,$3)', [runId, token, msg]); },
    async nextTasks(runId, limit, max) {
      return (await pool.query(`select category_id, category_name, section_id, attempts from compra.catalog_sync_tasks
        where run_id = $1 and status = 'pending' and attempts < $3 order by attempts, category_id limit $2`, [runId, limit, max])).rows;
    },
    async markTask(runId, cid, patch) {
      const keys = Object.keys(patch);
      await pool.query(`update compra.catalog_sync_tasks set ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} where run_id = $1 and category_id = $2`,
        [runId, cid, ...keys.map((k) => patch[k])]);
    },
    async taskProgress(runId) {
      const r = (await pool.query(`select count(*)::int total, count(*) filter (where status='done')::int done,
        count(*) filter (where status='failed')::int failed, count(*) filter (where status='pending')::int pending
        from compra.catalog_sync_tasks where run_id = $1`, [runId])).rows[0];
      return r;
    },
    async upsertStaging(runId, rows) {
      for (const r of rows) {
        await pool.query('insert into compra.catalog_sync_staging (run_id, external_id, data) values ($1,$2,$3) on conflict do nothing', [runId, r.external_id, JSON.stringify(r)]);
      }
    },
    async mergeStagingDetails(runId, token, items) {
      return (await pool.query('select compra.sync_merge_details($1,$2,$3) as n', [runId, token, JSON.stringify(items)])).rows[0].n;
    }
  };
}
