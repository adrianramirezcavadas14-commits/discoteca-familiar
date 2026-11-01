// =====================================================================
// HOGAR · DESPENSA · Búsqueda de imágenes para las recetas (sin dependencias)
// ---------------------------------------------------------------------
// Proveedores (en el servidor, nunca desde el navegador):
//  1. Brave Search API (imágenes) limitada a webs de recetas conocidas,
//     solo si se configura el secreto BRAVE_SEARCH_API_KEY.
//  2. Sin clave: Wikimedia Commons y Openverse (imágenes con licencia libre,
//     APIs públicas y gratuitas pensadas para esto).
// No se descargan ni se copian imágenes: se devuelve su dirección, la página
// de origen y el autor. Nada de «scraping» de páginas web.
// =====================================================================

export const RECIPE_BUCKET = 'compra-recetas';
export const MAX_RECIPE_IMAGE_BYTES = 3 * 1024 * 1024;
export const USER_AGENT = 'HogarDespensa/1.1 (aplicación familiar; https://github.com)';

export const DEFAULT_RECIPE_SITES = [
  'recetasgratis.net', 'directoalpaladar.com', 'cookpad.com', 'hogarmania.com', 'recetasderechupete.com',
  'lasrecetasdelchef.net', 'karlosarguinano.com', 'canalcocina.es', 'bonviveur.es', 'javirecetas.com',
  'pequerecetas.com', 'unareceta.com', 'cocinatis.com', 'elcomidista.elpais.com', 'recetas.elperiodico.com',
  'thermorecetas.com', 'cocinafacil.com.mx', 'allrecipes.com', 'bbcgoodfood.com', 'mis-recetas.org'
];

export const cleanQuery = (q) => String(q ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
const https = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) && u.length <= 2000 ? u : null);
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 200);

export function isRecipeSite(url, sites = DEFAULT_RECIPE_SITES) {
  const h = hostOf(url);
  return !!h && sites.some((s) => h === s || h.endsWith(`.${s}`));
}

async function getJson(fetchImpl, url, { headers = {}, timeoutMs = 9000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`${hostOf(url)} respondió ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${hostOf(url)} no respondió a tiempo`);
    throw e;
  } finally { clearTimeout(t); }
}

/** Brave: resultados de webs de recetas primero; el resto, después. */
export function parseBrave(json, sites = DEFAULT_RECIPE_SITES) {
  const out = [];
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    const image = https(r?.properties?.url) || https(r?.thumbnail?.src);
    const thumb = https(r?.thumbnail?.src) || image;
    const page = typeof r?.url === 'string' ? r.url : null;
    if (!image) continue;
    out.push({ url: image, thumb, page, title: strip(r?.title), source: hostOf(page) || r?.source || 'web', credit: hostOf(page) || null, recipeSite: isRecipeSite(page, sites) });
  }
  return [...out.filter((x) => x.recipeSite), ...out.filter((x) => !x.recipeSite)];
}

export function parseCommons(json) {
  const pages = Object.values(json?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const out = [];
  for (const p of pages) {
    const ii = p?.imageinfo?.[0];
    const thumb = https(ii?.thumburl) || https(ii?.url);
    if (!thumb || !/\.(jpe?g|png|webp)$/i.test(ii?.url || '')) continue;
    const md = ii?.extmetadata || {};
    const author = strip(md.Artist?.value);
    const license = strip(md.LicenseShortName?.value);
    out.push({ url: thumb, thumb, page: ii?.descriptionurl || null, title: strip(p.title).replace(/^File:|^Archivo:/, '').replace(/\.[a-z]+$/i, ''), source: 'Wikimedia Commons', credit: [author, license].filter(Boolean).join(' · ') || 'Wikimedia Commons', recipeSite: false });
  }
  return out;
}

export function parseOpenverse(json) {
  const out = [];
  for (const r of Array.isArray(json?.results) ? json.results : []) {
    const url = https(r?.url);
    const thumb = https(r?.thumbnail) || url;
    if (!url && !thumb) continue;
    out.push({ url: thumb || url, thumb: thumb || url, page: r?.foreign_landing_url || null, title: strip(r?.title), source: r?.source ? `Openverse · ${r.source}` : 'Openverse', credit: [strip(r?.creator), r?.license ? `CC ${String(r.license).toUpperCase()}` : ''].filter(Boolean).join(' · ') || 'Openverse', recipeSite: false });
  }
  return out;
}

/**
 * Busca imágenes. offset/page permite «cargar más».
 * Devuelve { images, provider, more, errors }.
 */
export async function searchRecipeImages(query, { fetchImpl = fetch, braveKey = '', sites = DEFAULT_RECIPE_SITES, page = 0, perPage = 20 } = {}) {
  const q = cleanQuery(query);
  if (q.length < 2) throw new Error('Escribe al menos dos letras.');
  const errors = [];
  if (braveKey) {
    try {
      const url = `https://api.search.brave.com/res/v1/images/search?${new URLSearchParams({ q: `${q} receta`, count: '100', country: 'ES', search_lang: 'es', safesearch: 'strict', spellcheck: 'false' })}`;
      const all = parseBrave(await getJson(fetchImpl, url, { headers: { 'X-Subscription-Token': braveKey, 'Accept-Encoding': 'gzip' } }), sites);
      const slice = all.slice(page * perPage, (page + 1) * perPage);
      if (slice.length || page > 0) return { images: dedupe(slice), provider: 'brave', more: all.length > (page + 1) * perPage, errors };
    } catch (e) { errors.push(`Brave: ${e.message}`); }
  }
  const results = await Promise.allSettled([
    getJson(fetchImpl, `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(perPage), gsroffset: String(page * perPage), prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '640', origin: '*' })}`).then(parseCommons),
    getJson(fetchImpl, `https://api.openverse.org/v1/images/?${new URLSearchParams({ q, page_size: String(perPage), page: String(page + 1), mature: 'false' })}`).then(parseOpenverse)
  ]);
  const [commons, openverse] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    errors.push(`${i ? 'Openverse' : 'Wikimedia Commons'}: ${r.reason?.message || r.reason}`);
    return [];
  });
  if (!commons.length && !openverse.length && errors.length) throw new Error(`No se han podido buscar imágenes (${errors.join(' · ')})`);
  // Se intercalan las dos fuentes para que las primeras 5 sean variadas.
  const mixed = [];
  for (let i = 0; i < Math.max(commons.length, openverse.length); i++) { if (commons[i]) mixed.push(commons[i]); if (openverse[i]) mixed.push(openverse[i]); }
  return { images: dedupe(mixed), provider: 'libre', more: commons.length >= perPage || openverse.length >= perPage, errors };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((x) => { const k = x.url.split('?')[0]; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Foto subida a mano: solo JPG, PNG o WEBP de hasta 3 MB (se mira el contenido real). */
export function validateRecipeImage(bytes, declaredType = '') {
  const size = bytes?.byteLength ?? bytes?.length ?? 0;
  if (!size) return { ok: false, error: 'La imagen está vacía.' };
  if (size > MAX_RECIPE_IMAGE_BYTES) return { ok: false, error: 'La imagen supera los 3 MB.' };
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (f, t) => String.fromCharCode(...b.slice(f, t));
  let mime = null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
  else if (b[0] === 0x89 && ascii(1, 4) === 'PNG') mime = 'image/png';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') mime = 'image/webp';
  if (!mime) return { ok: false, error: 'Formato no admitido. Usa una foto JPG, PNG o WEBP.' };
  const declared = String(declaredType || '').toLowerCase();
  if (declared && declared !== 'application/octet-stream' && declared !== mime) return { ok: false, error: 'El tipo del archivo no coincide con su contenido.' };
  return { ok: true, mime, ext: { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime], size };
}
