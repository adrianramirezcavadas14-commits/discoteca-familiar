// =====================================================================
// HOGAR · Biblioteca · Función «agapea» (Supabase Edge Function)
// ---------------------------------------------------------------------
// Agapea no tiene API pública y su web no permite que otra página la lea
// directamente desde el navegador (CORS). Esta pequeña función hace de
// intermediaria: recibe la búsqueda, lee las páginas públicas de Agapea y
// devuelve los datos limpios en JSON.
//
// · No usa claves secretas ni toca la base de datos.
// · Se despliega desde el panel de Supabase (ver CAMBIOS.md, «Agapea»).
// · Peticiones (POST JSON):
//     { "isbn": "9788410346925" }                    → esa edición
//     { "q": "principito", "offset": 0, "limit": 10 } → búsqueda por texto
// · Respuesta: { items: [...], hasMore: bool, source: "Agapea" }
// =====================================================================

const BASE = "https://www.agapea.com";
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 HogarBiblioteca/1.0";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
const TTL = 30 * 60 * 1000; // 30 minutos de caché en memoria
const cache = new Map<string, { at: number; value: unknown }>();
let pageParam: string | null = null; // parámetro de paginación que funcione (se descubre solo)

type Book = {
  source: "Agapea";
  title: string;
  authors: string[];
  publisher: string | null;
  pages: number | null;
  language: string | null;
  isbn13: string | null;
  isbn10: string | null;
  physical: string | null;
  cover: string | null;
  url: string;
  genres: string[];
  synopsis: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
function remember<T>(key: string, value: T): T {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  return value;
}
function recall<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  return undefined;
}

async function getHtml(url: string, ms = 9000): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "es-ES,es;q=0.9", Accept: "text/html" }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) throw new Error(`Agapea respondió ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // Agapea puede servir ISO-8859-1: se respeta el juego de caracteres declarado.
    const head = new TextDecoder("latin1").decode(buf.slice(0, 3000));
    const charset = (res.headers.get("content-type") || "").match(/charset=([\w-]+)/i)?.[1] || head.match(/charset=["']?([\w-]+)/i)?.[1] || "utf-8";
    try { return new TextDecoder(charset.toLowerCase()).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
  } finally {
    clearTimeout(t);
  }
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ordf: "ª", ordm: "º" };
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}
/** HTML → líneas de texto; las celdas de una fila quedan separadas por « | ». */
export function textLines(html: string): string[] {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(th|td|dt|dd)>/gi, " | ")
    .replace(/<(br|\/tr|\/p|\/div|\/li|\/h\d|\/dl|\/span)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decode(body).split("\n").map((l) => l.replace(/\s+/g, " ").replace(/^[\s|]+|[\s|]+$/g, "").trim()).filter(Boolean);
}
const meta = (html: string, prop: string) =>
  decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1]
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"))?.[1] || "").trim();

const LABELS: Record<string, RegExp> = {
  authors: /^autor(?:es|\/es|a)?$/i,
  publisher: /^editorial$/i,
  pages: /^p[áa]ginas$/i,
  language: /^idioma$/i,
  isbn13: /^isbn(?:-13)?$/i,
  isbn10: /^isbn-?10$/i,
  physical: /^encuadernaci[óo]n$/i,
};
function fields(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // «Editorial | DUOMO», «Editorial: DUOMO» o la etiqueta sola y el valor en la línea siguiente.
    const m = line.match(/^([A-Za-zÁÉÍÓÚáéíóúñÑ/\-0-9 ]{3,20}?)\s*(?:\||:)\s*(.+)$/);
    const label = (m ? m[1] : line).replace(/:\s*$/, "").trim();
    for (const [key, re] of Object.entries(LABELS)) {
      if (out[key] || !re.test(label)) continue;
      const value = m ? m[2] : lines[i + 1] || "";
      if (value && !Object.values(LABELS).some((r) => r.test(value.trim()))) out[key] = value.replace(/^\|\s*/, "").trim();
    }
  }
  return out;
}
const isbnFromUrl = (u: string) => u.match(/-(97[89]\d{10})-i\.htm/i)?.[1] || null;
const cleanIsbn = (s = "") => s.replace(/[^0-9Xx]/g, "").toUpperCase();
const SMALL = new Set(["y", "e", "o", "u", "de", "del", "la", "las", "el", "los", "en", "a", "al", "con", "por", "para", "un", "una", "sin", "sobre"]);
/** «EL PRINCIPITO» → «El Principito» (solo si viene todo en mayúsculas). */
const titleCase = (s: string) => (s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s)
  ? s.toLowerCase().replace(/(^|[\s(¿¡"«-])(\p{L}+)/gu, (_, a: string, w: string) => a + (a !== "" && a !== "(" && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)))
  : s);

/** Sinopsis: el bloque «Resumen»/«Sinopsis» de la ficha o, si no, la descripción de la página. */
const STOP = /^(detalles del libro|ficha t[ée]cnica|leer m[áa]s|leer menos|opiniones|valoraciones|comentarios|otros libros|libros relacionados|autor\/es|editorial|p[áa]ginas|isbn)\b/i;
export function synopsisOf(html: string, lines: string[]): string | null {
  let best = "";
  for (let i = 0; i < lines.length; i++) {
    if (!/^(resumen|sinopsis)(\s+del\s+libro)?\s*:?$/i.test(lines[i])) continue;
    const parts: string[] = [];
    for (let k = i + 1; k < lines.length && parts.length < 30; k++) {
      if (STOP.test(lines[k])) break;
      parts.push(lines[k]);
    }
    const text = parts.join("\n\n").trim();
    if (text.length > best.length) best = text;
  }
  const metaText = meta(html, "og:description") || meta(html, "description");
  if (metaText.length > best.length) best = metaText;
  best = best.replace(/\s*(\.\.\.|…)?\s*leer m[áa]s\s*$/i, "").trim();
  return best.length >= 40 ? best.slice(0, 8000) : null;
}

export function parseDetail(html: string, url: string): Book | null {
  const lines = textLines(html);
  const f = fields(lines);
  const og = meta(html, "og:title");
  const h1 = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  // og:title = «TÍTULO - AUTOR - ISBN»
  const ogParts = og.split(/\s+-\s+/);
  const title = titleCase(h1 || ogParts[0] || "");
  if (!title) return null;
  let authors = (f.authors || ogParts[1] || "").split(/\s*[;,]\s*|\s+y\s+/).map((a) => titleCase(a.trim())).filter(Boolean);
  if (!authors.length && ogParts.length > 2) authors = [titleCase(ogParts[1])];
  const i13 = cleanIsbn(f.isbn13 || "") || isbnFromUrl(url) || cleanIsbn(ogParts[ogParts.length - 1] || "");
  const isbn13 = /^97[89]\d{10}$/.test(i13) ? i13 : null;
  const i10 = cleanIsbn(f.isbn10 || "");
  let cover = meta(html, "og:image") || null;
  if (cover && !/^https?:/i.test(cover)) cover = new URL(cover, BASE).toString();
  const pages = parseInt((f.pages || "").replace(/\D/g, ""), 10);
  const lang = (f.language || "").trim();
  return {
    source: "Agapea",
    title,
    authors,
    publisher: f.publisher ? f.publisher.trim() : null,
    pages: Number.isFinite(pages) && pages > 0 ? pages : null,
    language: lang ? (/castellano|espa/i.test(lang) ? "Español" : titleCase(lang)) : null,
    isbn13,
    isbn10: /^\d{9}[\dX]$/.test(i10) ? i10 : null,
    physical: f.physical || null,
    cover,
    url,
    genres: [],
    synopsis: synopsisOf(html, lines),
  };
}

/** Enlaces únicos a fichas de libro (…-ISBN13-i.htm) en el orden de la página. */
export function detailLinks(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/href=["']([^"']*?-97[89]\d{10}-i\.htm)["']/gi)) {
    const u = new URL(decode(m[1]), BASE).toString();
    const key = isbnFromUrl(u) || u;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

async function detail(url: string): Promise<Book | null> {
  const key = `d:${isbnFromUrl(url) || url}`;
  const hit = recall<Book | null>(key);
  if (hit !== undefined) return hit;
  try { return remember(key, parseDetail(await getHtml(url), url)); } catch { return null; }
}

async function searchPage(q: string, page: number): Promise<string[]> {
  const key = `s:${q.toLowerCase()}:${page}`;
  const hit = recall<string[]>(key);
  if (hit) return hit;
  const base = `${BASE}/buscador/buscador.php?texto=${encodeURIComponent(q)}`;
  if (page === 1) return remember(key, detailLinks(await getHtml(base)));
  // Agapea no anuncia su paginación: se prueban los nombres habituales y se guarda el que funcione.
  const first = await searchPage(q, 1);
  for (const p of pageParam ? [pageParam] : ["pagina", "pag", "page", "p", "np"]) {
    try {
      const links = detailLinks(await getHtml(`${base}&${p}=${page}`));
      if (links.length && links[0] !== first[0]) { pageParam = p; return remember(key, links); }
    } catch { /* se prueba el siguiente */ }
  }
  return remember(key, []);
}

async function inBatches<T, R>(list: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < list.length; i += size) out.push(...(await Promise.all(list.slice(i, i + size).map(fn))));
  return out;
}

async function byIsbn(isbn: string) {
  const links = await searchPage(isbn, 1);
  const exact = links.filter((u) => isbnFromUrl(u) === isbn);
  const books = (await inBatches(exact.length ? exact : links.slice(0, 3), 4, detail)).filter((b): b is Book => !!b && (b.isbn13 === isbn || b.isbn10 === isbn));
  return { items: books.slice(0, 3), hasMore: false };
}

async function byText(q: string, offset: number, limit: number) {
  // Se acumulan enlaces de las páginas necesarias hasta cubrir offset + limit.
  const links: string[] = [];
  let page = 1;
  let exhausted = false;
  while (links.length < offset + limit + 1 && page <= 6) {
    const got = await searchPage(q, page);
    const fresh = got.filter((u) => !links.includes(u));
    if (!fresh.length) { exhausted = true; break; }
    links.push(...fresh);
    page++;
  }
  const slice = links.slice(offset, offset + limit);
  const items = (await inBatches(slice, 6, detail)).filter((b): b is Book => !!b);
  return { items, hasMore: links.length > offset + limit || (!exhausted && page > 6) };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : Object.fromEntries(url.searchParams);
    const isbn = cleanIsbn(String(body.isbn || ""));
    const q = String(body.q || "").trim().slice(0, 160);
    const offset = Math.max(0, Math.min(200, Number(body.offset) || 0));
    const limit = Math.max(1, Math.min(20, Number(body.limit) || 10));
    if (body.ping) return json({ ok: true, source: "Agapea" });
    if (isbn.length === 13 || isbn.length === 10) return json({ ...(await byIsbn(isbn)), source: "Agapea" });
    if (q.length >= 2) return json({ ...(await byText(q, offset, limit)), source: "Agapea" });
    return json({ items: [], hasMore: false, source: "Agapea", error: "Falta «q» o «isbn»" }, 400);
  } catch (e) {
    return json({ items: [], hasMore: false, source: "Agapea", error: String((e as Error)?.message || e) }, 502);
  }
});
