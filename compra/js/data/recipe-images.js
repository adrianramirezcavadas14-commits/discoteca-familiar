/* =====================================================================
   Imágenes para recetas buscadas DESDE EL NAVEGADOR (plan B si la función
   compra-recetas no responde). Solo API públicas, gratuitas y sin clave,
   preparadas para ser llamadas desde cualquier web (CORS con origin=*):
   Wikipedia en español, Wikimedia Commons y Openverse.
   Nota: este archivo NO puede estar en una carpeta que empiece por «_»
   (GitHub Pages no publica esas carpetas).
   ===================================================================== */
const https = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) && u.length <= 2000 ? u : null);
const strip = (html) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 200);
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return 'la web'; } };

async function getJson(url, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`${hostOf(url)} respondió ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${hostOf(url)} no respondió a tiempo`);
    throw e;
  } finally { clearTimeout(t); }
}

function fromWikipedia(json) {
  return Object.values(json?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => ({ thumb: https(p?.thumbnail?.source), page: p?.fullurl || null, title: strip(p?.title) }))
    .filter((x) => x.thumb && !/\.svg/i.test(x.thumb))
    .map((x) => ({ url: x.thumb, thumb: x.thumb, page: x.page, title: x.title, source: 'Wikipedia', credit: 'Wikipedia · ver licencia en la página' }));
}
function fromCommons(json) {
  return Object.values(json?.query?.pages || {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => {
    const ii = p?.imageinfo?.[0];
    const thumb = https(ii?.thumburl) || https(ii?.url);
    if (!thumb || !/\.(jpe?g|png|webp)$/i.test(ii?.url || '')) return null;
    const md = ii?.extmetadata || {};
    return { url: thumb, thumb, page: ii?.descriptionurl || null, title: strip(p.title).replace(/^(File|Archivo):/, '').replace(/\.[a-z]+$/i, ''), source: 'Wikimedia Commons', credit: [strip(md.Artist?.value), strip(md.LicenseShortName?.value)].filter(Boolean).join(' · ') || 'Wikimedia Commons' };
  }).filter(Boolean);
}
function fromOpenverse(json) {
  return (Array.isArray(json?.results) ? json.results : []).map((r) => {
    const thumb = https(r?.thumbnail) || https(r?.url);
    return thumb ? { url: thumb, thumb, page: r?.foreign_landing_url || null, title: strip(r?.title), source: 'Openverse', credit: [strip(r?.creator), r?.license ? `CC ${String(r.license).toUpperCase()}` : ''].filter(Boolean).join(' · ') || 'Openverse' } : null;
  }).filter(Boolean);
}

export async function searchImagesInBrowser(query, page = 0, perPage = 20) {
  const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (q.length < 2) throw new Error('Escribe al menos dos letras.');
  const sources = [
    ['Wikipedia', page === 0 ? getJson(`https://es.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: q, gsrlimit: '12', gsrnamespace: '0', prop: 'pageimages|info', piprop: 'thumbnail', pithumbsize: '640', inprop: 'url', redirects: '1', origin: '*' })}`).then(fromWikipedia) : Promise.resolve([])],
    ['Wikimedia Commons', getJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${q} filetype:bitmap`, gsrnamespace: '6', gsrlimit: String(perPage), gsroffset: String(page * perPage), prop: 'imageinfo', iiprop: 'url|extmetadata', iiextmetadatafilter: 'Artist|LicenseShortName', iiurlwidth: '640', origin: '*' })}`).then(fromCommons)],
    ['Openverse', getJson(`https://api.openverse.org/v1/images/?${new URLSearchParams({ q, page_size: String(perPage), page: String(page + 1), mature: 'false' })}`).then(fromOpenverse)]
  ];
  const settled = await Promise.allSettled(sources.map((s) => s[1]));
  const errors = [];
  const lists = settled.map((r, i) => (r.status === 'fulfilled' ? r.value : (errors.push(`${sources[i][0]}: ${r.reason?.message || r.reason}`), [])));
  if (!lists.some((l) => l.length) && errors.length) throw new Error(`No se han podido buscar imágenes (${errors.join(' · ')})`);
  const seen = new Set();
  const images = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i] && !seen.has(l[i].url)) { seen.add(l[i].url); images.push(l[i]); }
  return { images, provider: 'libre-navegador', more: lists[1].length >= perPage || lists[2].length >= perPage, errors };
}
