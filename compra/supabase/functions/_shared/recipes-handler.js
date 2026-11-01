// =====================================================================
// HOGAR · DESPENSA · Lógica HTTP de «compra-recetas» (independiente de Deno)
//   POST JSON { action: 'buscar', q, page }  → { images: [...], provider, more }
//   POST multipart action=subir, file        → { url } (bucket público compra-recetas)
// La clave familiar (si está activada) se valida igual que en las otras funciones.
// =====================================================================
import { createSupabaseDb } from './db-supabase.js';
import { corsHeaders, json, resolveCaller } from './http.js';
import { searchRecipeImages, validateRecipeImage, cleanQuery, MAX_RECIPE_IMAGE_BYTES, DEFAULT_RECIPE_SITES } from './recipes-core.js';

/** Almacenamiento real: bucket público de Supabase Storage (solo escribe esta función). */
export function supabaseRecipeStorage(client, bucket) {
  return {
    async upload(path, bytes, mime) { const { error } = await client.storage.from(bucket).upload(path, bytes, { contentType: mime, upsert: false, cacheControl: '31536000' }); if (error) throw error; },
    publicUrl(path) { return client.storage.from(bucket).getPublicUrl(path).data.publicUrl; }
  };
}

export function createRecipesHandler({ client, storage, fetchImpl = fetch, braveKey = '', sites = '', allowedOrigins = '', newId = () => crypto.randomUUID() }) {
  const db = createSupabaseDb(client);
  const siteList = String(sites || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const SITES = siteList.length ? siteList : DEFAULT_RECIPE_SITES;
  // Caché corta en memoria: la misma búsqueda repetida no vuelve a salir a Internet.
  const cache = new Map();

  return async function handle(req) {
    const cors = corsHeaders(req, allowedOrigins);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405, cors);
    try {
      const caller = await resolveCaller(req, db);
      if (!caller) return json({ error: 'Clave familiar no válida.', code: 'clave_familiar_no_valida' }, 401, cors);
      const type = req.headers.get('content-type') || '';

      if (type.includes('application/json')) {
        const body = await req.json().catch(() => ({}));
        if (body.action !== 'buscar') return json({ error: 'Acción desconocida' }, 400, cors);
        const q = cleanQuery(body.q);
        const page = Math.max(0, Math.min(10, Math.trunc(Number(body.page) || 0)));
        if (q.length < 2) return json({ error: 'Escribe al menos dos letras.' }, 400, cors);
        const key = `${q.toLowerCase()}|${page}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 30 * 60 * 1000) return json(hit.data, 200, cors);
        const data = await searchRecipeImages(q, { fetchImpl, braveKey, sites: SITES, page });
        cache.set(key, { at: Date.now(), data });
        if (cache.size > 200) cache.delete(cache.keys().next().value);
        return json(data, 200, cors);
      }

      if (!type.includes('multipart/form-data')) return json({ error: 'Formato de petición no válido' }, 400, cors);
      const len = Number(req.headers.get('content-length') || 0);
      if (len > MAX_RECIPE_IMAGE_BYTES + 100000) return json({ error: 'La imagen supera los 3 MB.' }, 413, cors);
      const form = await req.formData();
      if (form.get('action') !== 'subir') return json({ error: 'Acción desconocida' }, 400, cors);
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Falta la imagen.' }, 400, cors);
      if (file.size > MAX_RECIPE_IMAGE_BYTES) return json({ error: 'La imagen supera los 3 MB.' }, 413, cors);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const check = validateRecipeImage(bytes, file.type);
      if (!check.ok) return json({ error: check.error }, 415, cors);
      const path = `${caller.householdId}/${newId()}.${check.ext}`;
      await storage.upload(path, bytes, check.mime);
      return json({ url: storage.publicUrl(path), source: 'Foto subida', credit: null }, 200, cors);
    } catch (e) {
      console.error(e);
      return json({ error: String(e?.message || e) }, 502, cors);
    }
  };
}
