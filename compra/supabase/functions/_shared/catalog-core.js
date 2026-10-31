// =====================================================================
// HOGAR · DESPENSA · Adaptador del catálogo de Mercadona
// ---------------------------------------------------------------------
// MercadonaCatalogProvider es la interfaz común. Cualquier fuente nueva solo
// tiene que implementar:
//   name                       → texto corto para registros
//   listCategories()           → [{ id, name, sectionId, sectionName }]
//   fetchCategory(id)          → JSON de la categoría (con productos)
//   fetchProduct(externalId)   → JSON de la ficha (opcional)
//
// Proveedores incluidos:
//   · mercadona-api : API pública (no oficial) de tienda.mercadona.es
//   · datania       : copia semanal en JSON de github.com/datania/mercadona-catalog
//                     publicada en Hugging Face (mismo formato que la API).
//
// Este archivo es JavaScript estándar (sin dependencias) para que lo puedan
// usar tanto la función Edge (Deno) como las pruebas (Node).
// =====================================================================

export const MERCADONA_API = 'https://tienda.mercadona.es/api';
export const DATANIA_BASE = 'https://huggingface.co/datasets/datania/mercadona-catalog/resolve/main';
export const USER_AGENT = 'Mozilla/5.0 (compatible; HogarDespensa/1.0; uso familiar, sincronizacion espaciada)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CatalogFetchError extends Error {
  constructor(message, { status = 0, url = '', retryable = false } = {}) {
    super(message);
    this.name = 'CatalogFetchError';
    this.status = status;
    this.url = url;
    this.retryable = retryable;
  }
}

/** Espera exponencial con tope: 1 s, 2 s, 4 s, 8 s… (más un poco de azar para no sincronizar ráfagas). */
export function backoffMs(attempt, base = 1000, cap = 30000, random = Math.random) {
  const exp = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp * (0.85 + random() * 0.3));
}

/**
 * GET JSON con tiempo máximo, reintentos y backoff. Respeta Retry-After.
 * No reintenta respuestas 4xx salvo 408 y 429 (bloqueos o errores de la API no se fuerzan).
 */
export async function fetchJsonWithRetry(fetchImpl, url, { retries = 3, timeoutMs = 15000, headers = {}, sleepImpl = sleep, random = Math.random } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json', 'Accept-Language': 'es-ES,es;q=0.9', 'User-Agent': USER_AGENT, ...headers },
        signal: ctrl.signal,
        redirect: 'follow'
      });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object' && !Array.isArray(data) && ('_error' in data || ('code' in data && !('id' in data) && !('results' in data)))) {
          throw new CatalogFetchError(`La fuente devolvió un error: ${data.en_message || data._error || data.code}`, { status: res.status, url });
        }
        return data;
      }
      const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
      lastError = new CatalogFetchError(`HTTP ${res.status} en ${url}`, { status: res.status, url, retryable });
      if (!retryable || attempt === retries) throw lastError;
      const ra = Number(res.headers?.get?.('retry-after'));
      await sleepImpl(Number.isFinite(ra) && ra > 0 ? Math.min(60000, ra * 1000) : backoffMs(attempt, 1000, 30000, random));
    } catch (e) {
      if (e instanceof CatalogFetchError && !e.retryable) throw e;
      lastError = e instanceof CatalogFetchError ? e : new CatalogFetchError(e?.name === 'AbortError' ? `Tiempo agotado en ${url}` : `Red: ${e?.message || e}`, { url, retryable: true });
      if (attempt === retries) throw lastError;
      await sleepImpl(backoffMs(attempt, 1000, 30000, random));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new CatalogFetchError(`Sin respuesta de ${url}`, { url });
}

// ---------------------------------------------------------------------
// Validación de formato (mismo criterio que datania/mercadona-catalog)
// ---------------------------------------------------------------------
export function parseCategoriesRoot(json) {
  if (!json || !Array.isArray(json.results) || !json.results.length) {
    throw new CatalogFetchError('El árbol de categorías no tiene el formato esperado');
  }
  const out = [];
  for (const section of json.results) {
    if (!Array.isArray(section?.categories)) continue;
    for (const c of section.categories) {
      if (!Number.isInteger(c?.id)) continue;
      if (c.published === false) continue;
      out.push({ id: c.id, name: String(c.name || ''), sectionId: Number.isInteger(section.id) ? section.id : null, sectionName: String(section.name || '') });
    }
  }
  if (!out.length) throw new CatalogFetchError('El árbol de categorías está vacío');
  return out;
}

export function validateCategoryPayload(json, id) {
  if (!json || String(json.id) !== String(id) || !Array.isArray(json.categories)) {
    throw new CatalogFetchError(`La categoría ${id} no tiene el formato esperado`);
  }
  return json;
}

// ---------------------------------------------------------------------
// Normalización de productos
// ---------------------------------------------------------------------
const num = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, n) : null;
};
const fmtNumber = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000).replace('.', ','));
const UNIT_LABEL = { l: 'L', ml: 'ml', kg: 'kg', g: 'g', ud: 'ud.', uds: 'ud.', m: 'm', cl: 'cl' };

/** «Brik 1 L», «Paquete 6 x 200 ml», «Pieza aprox. 1,2 kg». */
export function formatLabel(packaging, pi = {}) {
  const parts = [];
  if (packaging) parts.push(String(packaging).trim());
  const size = num(pi.unit_size);
  const unit = pi.size_format ? (UNIT_LABEL[String(pi.size_format).toLowerCase()] || String(pi.size_format)) : '';
  if (pi.is_pack && num(pi.total_units) && num(pi.pack_size)) {
    parts.push(`${fmtNumber(num(pi.total_units))} x ${fmtNumber(num(pi.pack_size))} ${unit}`.trim());
  } else if (size != null && unit) {
    parts.push(`${pi.approx_size ? 'aprox. ' : ''}${fmtNumber(size)} ${unit}`);
  }
  return parts.join(' ').trim() || null;
}

const IMG_HOST = /^https:\/\/[a-z0-9.-]+\.imgix\.net\//i;
export function cleanImageUrl(url) {
  const s = String(url || '').trim();
  if (!s || !/^https:\/\//i.test(s) || s.length > 600) return null;
  return s;
}
/** Versión mayor de la miniatura (imgix permite cambiar el tamaño en la URL). */
export function largerImage(thumb) {
  if (!thumb) return null;
  if (!IMG_HOST.test(thumb)) return thumb;
  try {
    const u = new URL(thumb);
    u.searchParams.set('h', '600');
    u.searchParams.set('w', '600');
    return u.toString();
  } catch { return thumb; }
}

/**
 * Convierte un producto de la API (en una categoría) en la fila de staging.
 * ctx: { section: {id, name}, category: {id, name}, sub: {id, name} | null, source, now }
 */
export function normalizeProduct(raw, ctx) {
  if (!raw || raw.id == null) return null;
  const externalId = String(raw.id).trim();
  if (!/^[0-9A-Za-z._-]{1,40}$/.test(externalId)) return null;
  const name = clip(raw.display_name, 300);
  if (!name) return null;
  const pi = raw.price_instructions || {};
  const sec = Array.isArray(raw.categories) && raw.categories[0] && Number.isInteger(raw.categories[0].id)
    ? { id: raw.categories[0].id, name: raw.categories[0].name } : ctx.section;
  const price = num(pi.unit_price);
  const refPrice = num(pi.bulk_price) ?? num(pi.reference_price);
  const prev = num(pi.previous_unit_price);
  const thumb = cleanImageUrl(raw.thumbnail);
  const now = ctx.now ? new Date(ctx.now) : new Date();
  const unavailableFrom = raw.unavailable_from ? new Date(raw.unavailable_from) : null;
  const eanRaw = raw.ean != null ? String(raw.ean).trim() : '';
  return {
    external_id: externalId,
    name,
    packaging: clip(raw.packaging, 80),
    format_label: clip(formatLabel(raw.packaging, pi), 120),
    category_id: sec?.id ?? null,
    category_name: clip(sec?.name, 120),
    subcategory_id: ctx.category?.id ?? null,
    subcategory_name: clip(ctx.category?.name, 120),
    subsubcategory_id: ctx.sub?.id ?? null,
    subsubcategory_name: clip(ctx.sub?.name, 120),
    price: price != null && price >= 0 && price < 100000 ? price : null,
    unit_price: refPrice != null && refPrice >= 0 && refPrice < 1000000 ? refPrice : null,
    unit_of_measure: clip(pi.reference_format, 12),
    unit_size: num(pi.unit_size),
    size_format: clip(pi.size_format, 12),
    selling_method: Number.isInteger(pi.selling_method) ? pi.selling_method : null,
    is_bulk: raw.is_bulk === true,
    approx_size: pi.approx_size === true,
    previous_price: prev != null && prev > 0 && prev < 100000 ? prev : null,
    price_decreased: pi.price_decreased === true && prev != null && price != null && prev > price,
    thumbnail_url: thumb,
    image_url: largerImage(thumb),
    share_url: typeof raw.share_url === 'string' && raw.share_url.startsWith('https://') ? raw.share_url.slice(0, 400) : null,
    published: raw.published !== false,
    unavailable: !!(unavailableFrom && !Number.isNaN(unavailableFrom.getTime()) && unavailableFrom <= now),
    is_new_arrival: raw.is_new_arrival === true || pi.is_new === true,
    source: ctx.source || null,
    ean: /^[0-9]{6,14}$/.test(eanRaw) ? eanRaw : null
  };
}

/** Todos los productos de una categoría (nivel 1) con su subcategoría (nivel 2). */
export function extractProducts(payload, { section, source, now } = {}) {
  const category = { id: payload.id, name: payload.name };
  const out = new Map();
  const walk = (node, sub) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.products)) {
      for (const p of node.products) {
        const row = normalizeProduct(p, { section, category, sub, source, now });
        if (row && !out.has(row.external_id)) out.set(row.external_id, row);
      }
    }
    if (Array.isArray(node.categories)) {
      for (const c of node.categories) walk(c, c && c.id !== payload.id ? { id: c.id, name: c.name } : sub);
    }
  };
  walk(payload, null);
  return [...out.values()];
}

/** Datos de la ficha individual que no vienen en la categoría. */
export function detailFields(raw) {
  if (!raw || raw.id == null) return null;
  const d = raw.details || {};
  const eanRaw = raw.ean != null ? String(raw.ean).trim() : '';
  const photo = Array.isArray(raw.photos) && raw.photos[0] ? raw.photos[0] : null;
  return {
    ean: /^[0-9]{6,14}$/.test(eanRaw) ? eanRaw : null,
    brand: clip(raw.brand || d.brand, 80),
    description: clip(d.description || d.legal_name, 600),
    image_url: cleanImageUrl(photo?.regular) || null,
    detail_fetched: true
  };
}

// ---------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------
export function createMercadonaApiProvider({ fetchImpl = fetch, warehouse = null, lang = 'es', baseUrl = MERCADONA_API, retry = {} } = {}) {
  const qs = () => {
    const p = new URLSearchParams({ lang });
    if (warehouse) p.set('wh', warehouse);
    return `?${p}`;
  };
  return {
    name: 'mercadona-api',
    async listCategories() { return parseCategoriesRoot(await fetchJsonWithRetry(fetchImpl, `${baseUrl}/categories/${qs()}`, retry)); },
    async fetchCategory(id) { return validateCategoryPayload(await fetchJsonWithRetry(fetchImpl, `${baseUrl}/categories/${encodeURIComponent(id)}/${qs()}`, retry), id); },
    async fetchProduct(externalId) { return fetchJsonWithRetry(fetchImpl, `${baseUrl}/products/${encodeURIComponent(externalId)}/${qs()}`, { ...retry, retries: 2 }); }
  };
}

export function createDataniaProvider({ fetchImpl = fetch, baseUrl = DATANIA_BASE, retry = {} } = {}) {
  return {
    name: 'datania',
    async listCategories() { return parseCategoriesRoot(await fetchJsonWithRetry(fetchImpl, `${baseUrl}/categories.json`, retry)); },
    async fetchCategory(id) { return validateCategoryPayload(await fetchJsonWithRetry(fetchImpl, `${baseUrl}/categories/${encodeURIComponent(id)}.json`, retry), id); },
    async fetchProduct(externalId) { return fetchJsonWithRetry(fetchImpl, `${baseUrl}/products/${encodeURIComponent(externalId)}.json`, { ...retry, retries: 2 }); }
  };
}

/** Código de almacén (wh) del código postal: la API lo devuelve en la cabecera x-customer-wh. */
export async function resolveWarehouse(fetchImpl, postalCode, baseUrl = MERCADONA_API) {
  if (!/^[0-9]{5}$/.test(String(postalCode || ''))) return null;
  const res = await fetchImpl(`${baseUrl}/postal-codes/actions/change-pc/`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ new_postal_code: String(postalCode) })
  });
  if (!res.ok) return null;
  const wh = res.headers.get('x-customer-wh');
  return wh && /^[a-z0-9]{2,12}$/i.test(wh) ? wh.toLowerCase() : null;
}
