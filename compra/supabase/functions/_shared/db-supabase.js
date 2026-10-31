// =====================================================================
// HOGAR · DESPENSA · Adaptador de base de datos para el motor de sincronización
// Recibe un cliente supabase-js creado con la clave service_role y el
// esquema «compra». Solo se usa dentro de las funciones Edge.
// =====================================================================

function must({ data, error }) {
  if (error) {
    const e = new Error(error.message || String(error));
    e.code = error.code;
    e.details = error.details;
    throw e;
  }
  return data;
}

export function createSupabaseDb(client) {
  return {
    async rpc(name, args) {
      return must(await client.rpc(name, args));
    },
    async insertTasks(runId, tasks) {
      const rows = tasks.map((t) => ({ run_id: runId, ...t }));
      for (let i = 0; i < rows.length; i += 500) {
        must(await client.from('catalog_sync_tasks').upsert(rows.slice(i, i + 500), { onConflict: 'run_id,category_id', ignoreDuplicates: true }));
      }
    },
    async updateRun(runId, token, patch) {
      return must(await client.from('catalog_sync_runs').update(patch).eq('id', runId).eq('lock_token', token).select().single());
    },
    async log(runId, token, msg) {
      return must(await client.rpc('sync_log', { p_run: runId, p_token: token, p_msg: msg }));
    },
    async nextTasks(runId, limit, maxAttempts) {
      return must(await client.from('catalog_sync_tasks').select('category_id, category_name, section_id, attempts')
        .eq('run_id', runId).eq('status', 'pending').lt('attempts', maxAttempts)
        .order('attempts', { ascending: true }).order('category_id', { ascending: true }).limit(limit));
    },
    async markTask(runId, categoryId, patch) {
      must(await client.from('catalog_sync_tasks').update(patch).eq('run_id', runId).eq('category_id', categoryId));
    },
    async taskProgress(runId) {
      const rows = must(await client.from('catalog_sync_tasks').select('status').eq('run_id', runId));
      const count = (s) => rows.filter((r) => r.status === s).length;
      return { total: rows.length, done: count('done'), failed: count('failed'), pending: count('pending') };
    },
    async upsertStaging(runId, rows) {
      if (!rows.length) return;
      const data = rows.map((r) => ({ run_id: runId, external_id: r.external_id, data: r }));
      for (let i = 0; i < data.length; i += 500) {
        must(await client.from('catalog_sync_staging').upsert(data.slice(i, i + 500), { onConflict: 'run_id,external_id', ignoreDuplicates: true }));
      }
    },
    async mergeStagingDetails(runId, token, items) {
      return must(await client.rpc('sync_merge_details', { p_run: runId, p_token: token, p_items: items }));
    }
  };
}
