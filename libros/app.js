/* =====================================================================
   HOGAR · NUESTRA BIBLIOTECA FAMILIAR · app.js
   ---------------------------------------------------------------------
   Supabase es la fuente principal de datos (tablas books, book_wishlist,
   book_ratings, reading_journeys, reading_sessions, reading_pending).
   localStorage solo guarda una copia de resiliencia para abrir sin red.
   Fuentes externas: Open Library (principal) y Google Books (apoyo).
   ===================================================================== */
(() => {
  'use strict';

  /* =================================================================
     0. CONSTANTES
     ================================================================= */
  // Mismos familiares que la discoteca familiar. En la biblioteca se muestran siempre en este orden.
  const FAMILY = ['Mamá', 'María', 'Papá', 'Adrián'];
  const LOCATIONS = ['Aranjuez', 'Madrid', 'La Adrada'];
  const FORMATS = ['Tapa dura', 'Tapa blanda', 'Bolsillo'];
  const OWNER_PALETTE = ['#ef6f6c', '#ff8f5a', '#e5a93d', '#77a843', '#3e9c87', '#3c91d4', '#6674c7', '#8f6fc5', '#c95c93', '#7b6b61', '#46566e', '#202937'];
  const LIBRARY_COLORS_KEY = 'bibliotecaOwnerColors';
  const DEFAULT_COLORS = { 'Papá': '#ef6f6c', 'Mamá': '#8f6fc5', 'María': '#e6973f', 'Adrián': '#3e9c87' };
  const FORMAT_COLORS = { 'Tapa dura': '#ff786b', 'Tapa blanda': '#4285f4', 'Bolsillo': '#ffd166', 'Sin formato': '#a9a39a' };
  const AUTHOR_COLORS = ['#ef6f6c', '#3e9c87', '#6674c7', '#e5a93d', '#c95c93', '#3c91d4', '#8f6fc5', '#a9a39a'];
  const DELETE_PASSWORD = '1354';
  const PAGE_SIZE = 20;
  const MAX_PAGE_INDICATORS = 10;
  const COVER_BUCKET = 'book-covers';
  const CACHE_KEY = 'bibliotecaHogarCache_v1';
  const NET_TIMEOUT = 15000;
  const LOADER_TIMEOUT = 30000;

  // Librerías externas con versión fija y un CDN de reserva.
  const LIBS = {
    supabase: [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0/dist/umd/supabase.js',
      'https://unpkg.com/@supabase/supabase-js@2.100.0/dist/umd/supabase.js'
    ],
    zxing: [
      'https://unpkg.com/@zxing/browser@0.1.5/umd/zxing-browser.min.js',
      'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js'
    ]
  };
  const LIB_READY = { supabase: () => !!window.supabase?.createClient, zxing: () => !!window.ZXingBrowser };

  const T = {
    books: 'books',
    wishes: 'book_wishlist',
    ratings: 'book_ratings',
    journeys: 'reading_journeys',
    sessions: 'reading_sessions',
    pending: 'reading_pending'
  };

  const GIF = {
    boot: { src: './organizando-libreria.gif', alt: 'La biblioteca se está ordenando' },
    search: { src: './tom-leyendo.gif', alt: 'Tom leyendo mientras busca el libro' },
    save: { src: './hermione.gif', alt: 'Hermione archivando el libro' },
    random: { src: './ovejas-bella.gif', alt: 'Las ovejas eligiendo un libro' }
  };

  const MSG = {
    search: ['Tom está buscando el libro entre los estantes…', 'Consultando títulos, autores y ediciones…', 'Comprobando que la portada corresponda a esta edición…'],
    isbn: ['Tom está buscando el ISBN entre los estantes…', 'Consultando Open Library y Google Books…', 'Comprobando que la portada corresponda a esta edición…'],
    save: ['Hermione está archivando el nuevo libro…', 'Guardando el ejemplar en la biblioteca familiar…', 'Colocando cada dato en su lugar…'],
    update: ['Hermione está actualizando el libro…', 'Sincronizando los cambios con la biblioteca familiar…', 'Colocando cada dato en su lugar…'],
    remove: ['Hermione está retirando el libro de la estantería…', 'Revisando valoraciones, lecturas y paradas…', 'Dejando cada estante en orden…'],
    wish: ['Hermione está apuntando el deseo…', 'Guardando el destino de papel para toda la familia…', 'Colocando cada dato en su lugar…'],
    random: ['Las ovejas están buscando la próxima historia…', 'Revisando géneros, propietarios y ubicaciones…', 'Las ovejas están eligiendo entre los libros disponibles…']
  };

  /* -----------------------------------------------------------------
     DATOS DE DEMOSTRACIÓN (solo visuales, nunca se guardan en Supabase)
     · Para desactivarlos por completo: SHOW_DEMO_STATS = false.
     · Se dejan de usar automáticamente en cuanto existe cualquier
       lectura terminada real en reading_journeys.
     · Mamá: 23 libros en 2025 y 15 en 2026 (reparto mensual inventado).
     ----------------------------------------------------------------- */
  const SHOW_DEMO_STATS = true;
  const DEMO_FINISHED_BY_MONTH = {
    'Mamá': {
      2025: [2, 1, 3, 2, 1, 2, 4, 3, 1, 2, 1, 1], // 23
      2026: [1, 2, 1, 2, 2, 1, 3, 1, 1, 1, 0, 0]  // 15
    }
  };

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const LANGUAGE_NAMES = {
    spa: 'Español', es: 'Español', eng: 'Inglés', en: 'Inglés', cat: 'Catalán', ca: 'Catalán', glg: 'Gallego', gl: 'Gallego',
    baq: 'Euskera', eus: 'Euskera', eu: 'Euskera', fre: 'Francés', fra: 'Francés', fr: 'Francés', ger: 'Alemán', deu: 'Alemán', de: 'Alemán',
    ita: 'Italiano', it: 'Italiano', por: 'Portugués', pt: 'Portugués', lat: 'Latín', la: 'Latín', jpn: 'Japonés', ja: 'Japonés',
    rus: 'Ruso', ru: 'Ruso', chi: 'Chino', zho: 'Chino', zh: 'Chino', dut: 'Neerlandés', nld: 'Neerlandés', nl: 'Neerlandés'
  };

  /* =================================================================
     1. UTILIDADES
     ================================================================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const idOf = (v) => String(v);
  const clean = (v) => { const s = String(v ?? '').trim(); return s ? s : null; };
  const arr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));
  const plural = (n, one, many) => `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;
  const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

  function uuid() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v));

  function toISODate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function parseISODate(s) {
    const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const todayISO = () => toISODate(new Date());
  function fmtDate(v) {
    if (!v) return '';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? parseISODate(v) : new Date(v);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-ES');
  }
  function fmtLongDate(iso) {
    const d = parseISODate(iso);
    const s = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const fmtDecimal = (v) => Number(v).toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  const fmtRating = (v) => `${fmtDecimal(v)} ${Number(v) === 1 ? 'estrella' : 'estrellas'}`;

  function parseYear(v) {
    const m = String(v ?? '').match(/(\d{4})/);
    if (!m) return null;
    const y = Number(m[1]);
    return y > 0 && y <= 2100 ? y : null;
  }
  function parsePositiveInt(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) return NaN;
    return Number(s);
  }

  function withTimeout(promise, ms = NET_TIMEOUT) {
    let t;
    return Promise.race([
      promise,
      new Promise((_, reject) => { t = setTimeout(() => { const e = new Error('Tiempo de espera agotado'); e.code = 'TIMEOUT'; reject(e); }, ms); })
    ]).finally(() => clearTimeout(t));
  }

  /** Carga un script con tiempo máximo (no se queda colgado si el CDN no responde). */
  function loadScript(url, ms = 12000) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      const t = setTimeout(() => { el.remove(); reject(new Error(`Sin respuesta de ${url}`)); }, ms);
      el.src = url;
      el.async = true;
      el.onload = () => { clearTimeout(t); resolve(); };
      el.onerror = () => { clearTimeout(t); el.remove(); reject(new Error(`No se pudo cargar ${url}`)); };
      document.head.appendChild(el);
    });
  }
  const libLoads = {};
  /** Carga una librería probando cada CDN; devuelve true si queda disponible. */
  function loadLib(name) {
    if (LIB_READY[name]()) return Promise.resolve(true);
    if (!libLoads[name]) {
      libLoads[name] = (async () => {
        for (const url of LIBS[name]) {
          try { await loadScript(url); if (LIB_READY[name]()) return true; } catch (e) { console.warn(e.message); }
        }
        return false;
      })().then((ok) => { if (!ok) delete libLoads[name]; return ok; });
    }
    return libLoads[name];
  }

  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ---------- ISBN ---------- */
  const cleanIsbn = (v) => String(v ?? '').toUpperCase().replace(/[^0-9X]/g, '');
  function isValidIsbn10(s) {
    if (!/^\d{9}[\dX]$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
  }
  function isValidIsbn13(s) {
    if (!/^\d{13}$/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
    return sum % 10 === 0;
  }
  function isbn10to13(s) {
    if (!isValidIsbn10(s)) return null;
    const base = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
    return base + ((10 - (sum % 10)) % 10);
  }
  function isbn13to10(s) {
    if (!isValidIsbn13(s) || !s.startsWith('978')) return null;
    const base = s.slice(3, 12);
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
    const c = (11 - (sum % 11)) % 11;
    return base + (c === 10 ? 'X' : String(c));
  }
  /** Interpreta un código escaneado o escrito: devuelve {isbn13, isbn10, valid, reason}. */
  function parseIsbn(raw) {
    let s = cleanIsbn(raw);
    // Código EAN con complemento de precio (13 + 5 dígitos)
    if (s.length === 18 && /^97[89]/.test(s)) s = s.slice(0, 13);
    if (s.length === 13) {
      if (!/^97[89]/.test(s)) return { valid: false, reason: 'Este código de barras no es un ISBN (los ISBN empiezan por 978 o 979).' };
      if (!isValidIsbn13(s)) return { valid: false, reason: 'El ISBN-13 no es válido: revisa los dígitos.' };
      return { valid: true, isbn13: s, isbn10: isbn13to10(s) };
    }
    if (s.length === 10) {
      if (!isValidIsbn10(s)) return { valid: false, reason: 'El ISBN-10 no es válido: revisa los dígitos.' };
      return { valid: true, isbn10: s, isbn13: isbn10to13(s) };
    }
    return { valid: false, reason: s ? 'Un ISBN tiene 10 o 13 caracteres.' : 'Escribe o escanea un ISBN.' };
  }
  const isbnSet = (r) => new Set([r?.isbn13, r?.isbn10, ...(r?.isbns || [])].filter(Boolean).map(cleanIsbn));

  /* ---------- Autores y géneros ---------- */
  function normalizeAuthors(list) {
    const seen = new Set();
    const out = [];
    for (const raw of arr(list)) {
      const name = String(raw ?? '').replace(/\s+/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
      const key = norm(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  }

  const GENRE_ES = {
    'fiction': 'Ficción', 'novel': 'Novela', 'novels': 'Novela', 'literary fiction': 'Narrativa', 'fantasy': 'Fantasía',
    'fantasy fiction': 'Fantasía', 'science fiction': 'Ciencia ficción', 'mystery': 'Misterio', 'mystery fiction': 'Misterio',
    'detective and mystery stories': 'Novela policíaca', 'crime': 'Novela negra', 'thriller': 'Thriller', 'thrillers': 'Thriller',
    'suspense': 'Suspense', 'horror': 'Terror', 'horror tales': 'Terror', 'romance': 'Romántica', 'love stories': 'Romántica',
    'historical fiction': 'Novela histórica', 'history': 'Historia', 'biography': 'Biografía', 'biography & autobiography': 'Biografía',
    'autobiography': 'Biografía', 'poetry': 'Poesía', 'drama': 'Teatro', 'humor': 'Humor', 'comics & graphic novels': 'Cómic',
    'comics': 'Cómic', 'graphic novels': 'Cómic', 'juvenile fiction': 'Literatura juvenil', 'young adult fiction': 'Literatura juvenil',
    'juvenile literature': 'Literatura juvenil', "children's fiction": 'Infantil', "children's stories": 'Infantil', 'children': 'Infantil',
    'cooking': 'Cocina', 'travel': 'Viajes', 'art': 'Arte', 'science': 'Ciencia', 'philosophy': 'Filosofía', 'psychology': 'Psicología',
    'self-help': 'Autoayuda', 'religion': 'Religión', 'business & economics': 'Economía y empresa', 'economics': 'Economía',
    'education': 'Educación', 'health & fitness': 'Salud', 'medical': 'Medicina', 'music': 'Música', 'nature': 'Naturaleza',
    'political science': 'Política', 'social science': 'Ciencias sociales', 'sports & recreation': 'Deportes', 'computers': 'Informática',
    'technology & engineering': 'Tecnología', 'mathematics': 'Matemáticas', 'language arts & disciplines': 'Lengua', 'essays': 'Ensayo',
    'literary criticism': 'Crítica literaria', 'short stories': 'Relatos', 'adventure stories': 'Aventuras', 'adventure': 'Aventuras',
    'action & adventure': 'Aventuras', 'magic': 'Magia', 'family & relationships': 'Familia', 'true crime': 'Crónica negra',
    'foreign language study': 'Idiomas', 'reference': 'Consulta', 'games & activities': 'Juegos', 'crafts & hobbies': 'Manualidades',
    'gardening': 'Jardinería', 'pets': 'Mascotas', 'photography': 'Fotografía', 'architecture': 'Arquitectura', 'design': 'Diseño',
    'performing arts': 'Artes escénicas', 'body, mind & spirit': 'Espiritualidad', 'house & home': 'Hogar', 'law': 'Derecho',
    'classics': 'Clásicos', 'classic literature': 'Clásicos', 'transportation': 'Transporte', 'true story': 'Historia real', 'dystopias': 'Distopía', 'dystopian': 'Distopía'
  };
  const GENRE_JUNK = /^(accessible book|protected daisy|in library|lending library|large type books?|open library staff picks|internet archive wishlist|overdrive|ebook|e-?books?|nyt:|new york times|reviewed|award|general|fiction, general|literature|long now|translations? into|spanish language|english language|readers|textbooks?|study and teaching|[\d\s-]+$)/i;

  function capitalize(s) {
    return s.charAt(0).toLocaleUpperCase('es-ES') + s.slice(1);
  }
  /** Limpia, traduce las categorías más comunes y elimina duplicados por mayúsculas o acentos. */
  function normalizeGenres(list, limit = 6) {
    const parts = [];
    for (const raw of arr(list)) {
      String(raw ?? '').split(/\s*(?:\/|>|--|;|·)\s*/).forEach((p) => parts.push(p));
    }
    const seen = new Set();
    const out = [];
    for (let p of parts) {
      p = p.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim().replace(/[.,]+$/, '');
      if (!p || p.length < 3 || p.length > 40 || GENRE_JUNK.test(p) || /[:=]/.test(p)) continue;
      const translated = GENRE_ES[p.toLowerCase()] || p;
      const label = capitalize(translated);
      const key = norm(label);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= limit) break;
    }
    return out;
  }
  const genreKey = (g) => norm(g);

  function languageName(code) {
    if (!code) return null;
    const c = String(code).replace('/languages/', '').toLowerCase();
    return LANGUAGE_NAMES[c] || (c.length > 3 ? capitalize(c) : c.toUpperCase());
  }
  function formatFromPhysical(v) {
    const s = norm(v);
    if (!s) return null;
    if (/mass market|pocket|bolsillo/.test(s)) return 'Bolsillo';
    if (/hardcover|hardback|tapa dura|cartone|library binding/.test(s)) return 'Tapa dura';
    if (/paperback|softcover|tapa blanda|rustica|trade paper/.test(s)) return 'Tapa blanda';
    return null;
  }

  /* ---------- Colores de las personas (los mismos que la discoteca) ---------- */
  // Parten de los colores de la discoteca, pero los cambios hechos aquí se guardan solo
  // en este dispositivo y solo para la biblioteca (clave propia en localStorage).
  let ownerColors = { ...DEFAULT_COLORS };
  const readColors = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null') || {}; } catch { return {}; } };
  function loadOwnerColors() {
    ownerColors = { ...DEFAULT_COLORS, ...readColors('ownerColors'), ...readColors(LIBRARY_COLORS_KEY) };
  }
  function saveOwnerColor(name, color) {
    const mine = readColors(LIBRARY_COLORS_KEY);
    mine[name] = color;
    try { localStorage.setItem(LIBRARY_COLORS_KEY, JSON.stringify(mine)); } catch { /* sin almacenamiento: dura hasta recargar */ }
    ownerColors[name] = color;
  }
  const colorOf = (n) => ownerColors[n] || '#687086';
  const byFamilyOrder = (list) => [...list].sort((a, b) => (FAMILY.indexOf(a) + 99) % 99 - (FAMILY.indexOf(b) + 99) % 99);
  /** Viñeta de persona. Con pick = true se puede pulsar para cambiar su color. */
  const ownerChip = (n, pick = false) => pick
    ? `<button type="button" class="owner owner-pick" data-owner-chip="${esc(n)}" style="background:${esc(colorOf(n))}" aria-label="${esc(n)}: cambiar color" title="Cambiar el color de ${esc(n)}">${esc(n)}</button>`
    : `<span class="owner" data-owner-chip="${esc(n)}" style="background:${esc(colorOf(n))}">${esc(n)}</span>`;
  const pickChip = (n) => ownerChip(n, true);

  /* =================================================================
     2. ESTADO
     ================================================================= */
  const S = {
    db: null,
    ready: false,
    idIsUuid: true,
    missing: new Set(),
    books: [], ratings: [], wishes: [], journeys: [], sessions: [], pending: [],
    bookMap: new Map(),
    page: 'search',
    search: { q: '', owner: null, format: null, location: null, page: 1, filtered: [], highlight: null },
    form: { mode: 'new', editId: null, returnPage: 'search', wishId: null, owners: new Set(), location: null, format: null, meta: {}, cover: { url: '', path: null, blob: null, preview: '' }, choices: [] },
    detailId: null,
    rating: { bookId: null, person: FAMILY[0], value: 0, saved: null },
    cal: { person: FAMILY[0], year: new Date().getFullYear(), month: new Date().getMonth(), day: null, bookId: null, sessionId: null, rereading: false },
    stats: { person: FAMILY[0], year: null, buyYear: null },
    recommend: { genres: new Set(), lastId: null, list: [] },
    searchCtx: { purpose: 'add', person: null, results: [], stack: [] },
    pick: { person: null },
    wishDetail: null,
    lastSync: 0
  };

  function rebuildIndex() {
    S.bookMap = new Map(S.books.map((b) => [idOf(b.id), b]));
  }
  const bookById = (id) => S.bookMap.get(idOf(id));
  /** Libros de casa. Los leídos fuera (biblioteca pública, digitales…) tienen in_collection = false. */
  const inHome = (b) => b.in_collection !== false;
  const homeBooks = () => S.books.filter(inHome);

  /** Prepara campos derivados (no se guardan en Supabase). */
  function prepBook(b) {
    b.authors = normalizeAuthors(b.authors);
    b.genres = arr(b.genres).filter(Boolean);
    b.owners = byFamilyOrder(arr(b.owners).filter(Boolean));
    const hay = [b.title, b.subtitle, ...b.authors, b.publisher, ...b.genres].filter(Boolean).join(' ');
    Object.defineProperty(b, '_hay', { value: norm(hay), configurable: true, enumerable: false, writable: true });
    Object.defineProperty(b, '_isbn', { value: [b.isbn13, b.isbn10].filter(Boolean).map(cleanIsbn).join(' '), configurable: true, enumerable: false, writable: true });
    Object.defineProperty(b, '_sort', { value: `${norm(b.authors[0] || '~')}|${norm(b.title)}`, configurable: true, enumerable: false, writable: true });
    return b;
  }
  const sortBooks = () => S.books.sort((a, b) => collator.compare(a._sort, b._sort));

  function upsertLocal(list, row) {
    const i = list.findIndex((x) => idOf(x.id) === idOf(row.id));
    if (i >= 0) list[i] = { ...list[i], ...row };
    else list.push(row);
    return i >= 0 ? list[i] : row;
  }
  function removeLocal(list, id) {
    const i = list.findIndex((x) => idOf(x.id) === idOf(id));
    if (i >= 0) list.splice(i, 1);
  }
  function setBookLocal(row) {
    const b = prepBook({ ...(bookById(row.id) || {}), ...row });
    upsertLocal(S.books, b);
    const i = S.books.findIndex((x) => idOf(x.id) === idOf(b.id));
    S.books[i] = b;
    sortBooks();
    rebuildIndex();
    return b;
  }
  function removeBookLocal(id) {
    removeLocal(S.books, id);
    const k = idOf(id);
    S.ratings = S.ratings.filter((r) => idOf(r.book_id) !== k);
    S.pending = S.pending.filter((r) => idOf(r.book_id) !== k);
    S.sessions = S.sessions.filter((r) => idOf(r.book_id) !== k);
    S.journeys = S.journeys.filter((r) => idOf(r.book_id) !== k);
    rebuildIndex();
  }

  /* ---------- Copia local de resiliencia ---------- */
  function writeCache() {
    const data = { savedAt: new Date().toISOString(), books: S.books, ratings: S.ratings, wishes: S.wishes, journeys: S.journeys, sessions: S.sessions, pending: S.pending };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch {
      // Si no cabe (portadas en data:), se guarda sin esas imágenes.
      try {
        data.books = S.books.map((b) => (String(b.cover_url || '').startsWith('data:') ? { ...b, cover_url: null } : b));
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch { /* sin copia local: Supabase sigue siendo la fuente */ }
    }
  }
  const saveCache = debounce(writeCache, 600);
  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c || !Array.isArray(c.books)) return false;
      S.books = c.books.map(prepBook);
      S.ratings = c.ratings || [];
      S.wishes = c.wishes || [];
      S.journeys = c.journeys || [];
      S.sessions = c.sessions || [];
      S.pending = c.pending || [];
      sortBooks();
      rebuildIndex();
      return true;
    } catch { return false; }
  }

  /* =================================================================
     3. AVISOS, DIÁLOGOS Y PANTALLA DE CARGA
     ================================================================= */
  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /** Solo se muestra cuando algo va mal (sin conexión, copia local, error al guardar). */
  function setSync(text, state = '') {
    const el = $('#syncStatus');
    el.textContent = text;
    el.className = `sync-status ${state}`;
    el.hidden = state !== 'error';
  }

  /* ---------- Modales ---------- */
  const openModals = [];
  function openModal(el) {
    if (!el.classList.contains('open')) {
      el.classList.add('open');
      openModals.push(el);
    }
    document.body.classList.add('locked');
  }
  function closeModal(el) {
    if (!el) return;
    el.classList.remove('open');
    const i = openModals.indexOf(el);
    if (i >= 0) openModals.splice(i, 1);
    if (el.id === 'scanModal') stopScanner();
    if (!openModals.length && !$('#loadingScreen').classList.contains('open') && !$('#recommendResult').classList.contains('open')) document.body.classList.remove('locked');
  }
  function unlockIfIdle() {
    if (!openModals.length && !$('#loadingScreen').classList.contains('open') && !$('#recommendResult').classList.contains('open')) document.body.classList.remove('locked');
  }

  /* ---------- Diálogo genérico (contraseña, confirmaciones) ---------- */
  let dialogResolve = null;
  function dialog({ title, message = '', html = false, input = null, buttons = [{ label: 'Aceptar', value: true, kind: 'primary' }] }) {
    if (dialogResolve) dialogResolve({ value: null, input: '' });
    return new Promise((resolve) => {
      const modal = $('#dialogModal');
      $('#dlgTitle').textContent = title;
      const msg = $('#dlgMessage');
      if (html) msg.innerHTML = message; else msg.textContent = message;
      const inp = $('#dlgInput');
      inp.hidden = !input;
      inp.value = '';
      if (input) {
        inp.type = input.type || 'text';
        inp.setAttribute('inputmode', input.inputmode || 'text');
        inp.placeholder = input.placeholder || '';
        inp.setAttribute('aria-label', input.label || title);
      }
      $('#dlgActions').innerHTML = buttons.map((b, i) => `<button type="button" class="${esc(b.kind || '')}" data-i="${i}">${esc(b.label)}</button>`).join('');
      dialogResolve = (r) => { dialogResolve = null; closeModal(modal); resolve(r); };
      $('#dlgActions').onclick = (e) => {
        const b = e.target.closest('[data-i]');
        if (b) dialogResolve?.({ value: buttons[+b.dataset.i].value, input: inp.value });
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const primary = buttons.find((b) => b.kind === 'primary' || b.kind === 'danger');
          dialogResolve?.({ value: primary ? primary.value : true, input: inp.value });
        }
      };
      openModal(modal);
      setTimeout(() => (input ? inp : $('#dlgActions button:last-child'))?.focus(), 60);
    });
  }
  async function confirmDialog(title, message, okLabel = 'Aceptar', kind = 'primary', html = false) {
    const r = await dialog({ title, message, html, buttons: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, kind }] });
    return r.value === true;
  }

  /* ---------- Pantalla de carga con GIF, mensajes y barra de progreso ---------- */
  const Loader = (() => {
    const el = $('#loadingScreen');
    let progress = 0, progTimer = null, msgTimer = null;

    function setProgress(n) {
      progress = Math.max(0, Math.min(100, Math.round(n)));
      $('#loadingProgress').style.width = `${progress}%`;
      $('#loadingPercent').textContent = `${progress} %`;
      $('#loadingBar').setAttribute('aria-valuenow', String(progress));
    }
    function clearTimers() {
      clearInterval(progTimer); progTimer = null;
      clearInterval(msgTimer); msgTimer = null;
    }
    function show({ gif = GIF.save, messages = [], title, text }) {
      clearTimers();
      el.classList.remove('error');
      $('#loadingActions').hidden = true;
      const img = $('#loadingCharacter');
      if (img.getAttribute('src') !== gif.src) img.src = gif.src;
      img.alt = gif.alt;
      const list = messages.length ? messages : [title || 'Un momento…'];
      let i = 0;
      $('#loadingTitle').textContent = title || list[0];
      $('#loadingText').textContent = text || 'No cierres ni recargues la aplicación.';
      if (list.length > 1 && !title) {
        msgTimer = setInterval(() => {
          i = (i + 1) % list.length;
          $('#loadingTitle').textContent = list[i];
        }, 1800);
      }
      setProgress(0);
      progTimer = setInterval(() => { if (progress < 90) setProgress(progress + Math.max(1, Math.ceil((90 - progress) / 12))); }, 240);
      el.setAttribute('aria-busy', 'true');
      el.classList.add('open');
      document.body.classList.add('locked');
    }
    async function hide() {
      clearTimers();
      setProgress(100);
      await sleep(180);
      el.classList.remove('open', 'error');
      el.setAttribute('aria-busy', 'false');
      unlockIfIdle();
    }
    /** Muestra el error dentro de la tarjeta y espera a que el usuario reintente o cierre. */
    function fail(message, canRetry = true) {
      clearTimers();
      setProgress(100);
      el.classList.add('error');
      el.setAttribute('aria-busy', 'false');
      $('#loadingTitle').textContent = 'Algo se ha quedado fuera de su estante';
      $('#loadingText').textContent = message;
      $('#loadingActions').hidden = false;
      $('#loadingRetry').hidden = !canRetry;
      return new Promise((resolve) => {
        const done = (v) => {
          $('#loadingRetry').onclick = null; $('#loadingClose').onclick = null;
          if (!v) { el.classList.remove('open', 'error'); unlockIfIdle(); }
          resolve(v);
        };
        $('#loadingRetry').onclick = () => done(true);
        $('#loadingClose').onclick = () => done(false);
        setTimeout(() => (canRetry ? $('#loadingRetry') : $('#loadingClose')).focus(), 50);
      });
    }
    /** Ejecuta una tarea con pantalla de carga, tiempo máximo y opción de reintentar. */
    async function run(opts, task) {
      show(opts);
      try {
        const value = await withTimeout(Promise.resolve().then(task), opts.timeout || LOADER_TIMEOUT);
        await hide();
        return { ok: true, value };
      } catch (error) {
        console.error(error);
        if (error?.silent) { await hide(); return { ok: false, error }; }
        const retry = await fail(explainError(error), opts.retry !== false);
        if (retry) return run(opts, task);
        return { ok: false, error };
      }
    }
    return { show, hide, fail, run, setProgress };
  })();

  function explainError(e) {
    const msg = String(e?.message || e?.error_description || e || '');
    const code = String(e?.code || '');
    if (e?.userMessage) return e.userMessage;
    if (code === 'TIMEOUT') return 'La operación está tardando demasiado. Comprueba la conexión y vuelve a intentarlo.';
    if (!navigator.onLine || /Failed to fetch|NetworkError|Load failed|network ?error|ERR_INTERNET/i.test(msg)) return 'No hay conexión a Internet. Comprueba la red y vuelve a intentarlo.';
    if (code === 'PGRST204' || code === '42703' || /column .* does not exist|Could not find the .* column/i.test(msg)) return 'Falta una columna en Supabase. Ejecuta de nuevo libros/sql/biblioteca_migracion.sql.';
    if (code === '42P01' || code === 'PGRST205' || /relation .* does not exist|Could not find the table/i.test(msg)) return 'Falta una tabla en Supabase. Ejecuta libros/sql/biblioteca_migracion.sql en el SQL Editor de Supabase.';
    if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Supabase ha rechazado el permiso (RLS o grants). Ejecuta la migración SQL para crear las políticas.';
    if (code === '23505') return 'Ese registro ya existe y no se ha duplicado.';
    if (code === '23514' || /check constraint/i.test(msg)) return /incoherente/i.test(msg) ? msg : 'Algún dato está fuera del rango permitido. Revisa el formulario.';
    if (code === '23503') return 'El libro relacionado ya no existe en la biblioteca.';
    if (/Bucket not found/i.test(msg)) return 'No existe el bucket de portadas "book-covers". Ejecuta la migración SQL.';
    if (/Invalid API key|JWT|apikey|No API key/i.test(msg)) return 'La clave pública de libros/supabase-config.js no es válida.';
    if (/payload too large|exceeded the maximum allowed size|413/i.test(msg)) return 'La imagen es demasiado grande. Prueba con otra foto.';
    return msg || 'Ha ocurrido un error inesperado.';
  }
  const isMissingTable = (e) => !['42703', 'PGRST204'].includes(String(e?.code)) && (['42P01', 'PGRST205'].includes(String(e?.code)) || /^relation .* does not exist|Could not find the table/i.test(String(e?.message)));

  /* =================================================================
     4. ACCESO A SUPABASE
     ================================================================= */
  function assertDb() {
    if (!S.db) { const e = new Error('La conexión con Supabase todavía no está lista.'); e.userMessage = 'La biblioteca todavía no está conectada con Supabase. Revisa la conexión y recarga.'; throw e; }
    if (!navigator.onLine) { const e = new Error('offline'); e.userMessage = 'No hay conexión a Internet. Los cambios no se pueden guardar ahora.'; throw e; }
  }
  async function q(promise) {
    const { data, error, count } = await withTimeout(promise);
    if (error) throw error;
    return count != null && data == null ? count : data;
  }
  const db = {
    async all(table, order = 'created_at') {
      const out = [];
      const step = 1000;
      for (let from = 0; ; from += step) {
        const rows = await q(S.db.from(table).select('*').order(order, { ascending: true }).order('id', { ascending: true }).range(from, from + step - 1));
        out.push(...rows);
        if (rows.length < step) break;
      }
      return out;
    },
    async insert(table, row) {
      assertDb();
      const { data, error } = await withTimeout(S.db.from(table).insert(row).select().single());
      if (error) {
        // Tabla antigua con ids numéricos: se deja que Supabase genere el id.
        if (error.code === '22P02' && row.id != null && /uuid|bigint|integer/i.test(error.message || '')) {
          S.idIsUuid = false;
          const { id, ...rest } = row;
          return q(S.db.from(table).insert(rest).select().single());
        }
        // Reintento tras un corte: si el registro ya entró con el mismo id, se recupera.
        if (error.code === '23505' && row.id != null) {
          const again = await withTimeout(S.db.from(table).select('*').eq('id', row.id).maybeSingle());
          if (again.data) return again.data;
        }
        throw error;
      }
      return data;
    },
    async update(table, id, patch) {
      assertDb();
      return q(S.db.from(table).update(patch).eq('id', id).select().single());
    },
    async upsert(table, row, onConflict) {
      assertDb();
      return q(S.db.from(table).upsert(row, { onConflict }).select().single());
    },
    async remove(table, id) {
      assertDb();
      await q(S.db.from(table).delete().eq('id', id));
    },
    async one(table, id) {
      return q(S.db.from(table).select('*').eq('id', id).maybeSingle());
    }
  };
  const newId = () => (S.idIsUuid ? { id: uuid() } : {});

  /* =================================================================
     5. PORTADAS (HTML) Y NAVEGACIÓN
     ================================================================= */
  const fallbackHtml = (title) => `<div class="cover-fallback" aria-hidden="true"><span class="cf-icon">📖</span><span class="cf-title">${esc(title || '')}</span></div>`;
  function coverHtml(url, title, eager = false) {
    if (!url) return fallbackHtml(title);
    return `<img class="cover-img" src="${esc(url)}" alt="Portada de ${esc(title || 'libro')}" ${eager ? '' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-title="${esc(title || '')}">`;
  }
  const thumbHtml = (url, title) => `<span class="thumb">${coverHtml(url, title)}</span>`;
  // Si una portada externa no carga, se sustituye por el marcador visual.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('cover-img')) img.outerHTML = fallbackHtml(img.dataset.title);
  }, true);

  const drawer = $('#drawer');
  const setMenu = (open) => drawer.classList.toggle('open', open);

  const PAGE_RENDER = {
    search: () => { applySearch(true); fitFilterRow(); },
    recommend: () => renderRecommendGenres(),
    wishlist: () => renderWishlist(),
    ratings: () => renderRatings(),
    calendar: () => renderCalendar(),
    pending: () => renderPending(),
    stats: () => renderStats()
  };

  function showPage(id) {
    if (spot.step) setSpotStep(null);
    S.page = id;
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === id));
    $$('.drawer-nav .navbtn').forEach((b) => b.classList.toggle('active', b.dataset.page === id));
    setMenu(false);
    window.scrollTo(0, 0);
    PAGE_RENDER[id]?.();
  }

  /** Vuelve a pintar lo visible tras un cambio de datos (sin recargar desde Supabase). */
  const refreshViews = debounce(() => {
    $('#bookCount').textContent = plural(homeBooks().length, 'libro', 'libros');
    PAGE_RENDER[S.page]?.();
    if ($('#bookModal').classList.contains('open') && S.detailId) {
      if (bookById(S.detailId)) renderBookDetail(S.detailId); else closeModal($('#bookModal'));
    }
    if ($('#dayModal').classList.contains('open')) renderDayRecords();
    saveCache();
  }, 60);

  /* =================================================================
     6. EXPLORAR LA BIBLIOTECA
     ================================================================= */
  const searchInput = $('#q');
  const clearBtn = $('#clearSearch');

  function buildFilterChips() {
    const groups = { owner: FAMILY, location: LOCATIONS };
    $$('#quickFilters .filter-group').forEach((g) => {
      const key = g.dataset.filterGroup;
      // En pantallas estrechas «Tapa dura/Tapa blanda» se acortan para que los 10 filtros quepan en una línea.
      const short = { 'Tapa dura': 'Dura', 'Tapa blanda': 'Blanda' };
      g.innerHTML = groups[key].map((v) => `<button type="button" class="filter-chip" data-value="${esc(v)}" aria-pressed="false" aria-label="${esc(v)}">${short[v] ? `<span class="lbl-long">${esc(v)}</span><span class="lbl-short" aria-hidden="true">${esc(short[v])}</span>` : esc(v)}</button>`).join('');
    });
  }
  /** Busca el mayor tamaño de letra con el que los 10 filtros caben en una sola línea (solo móvil). */
  function fitFilterRow() {
    const row = $('#quickFilters');
    if (!row || !row.offsetParent) return;
    if (window.innerWidth > 760) { row.style.removeProperty('--ff'); return; }
    let lo = 7, hi = 13;
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      row.style.setProperty('--ff', `${mid}px`);
      if (row.scrollWidth <= row.clientWidth) lo = mid; else hi = mid;
    }
    row.style.setProperty('--ff', `${Math.floor(lo * 4) / 4}px`);
  }

  function syncFilterChips() {
    $$('#quickFilters .filter-group').forEach((g) => {
      const active = S.search[g.dataset.filterGroup];
      $$('.filter-chip', g).forEach((b) => {
        const on = b.dataset.value === active;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
  }

  function matchesQuery(b, qn, qIsbn) {
    if (!qn) return true;
    if (b._hay.includes(qn)) return true;
    return qIsbn.length >= 3 && b._isbn.includes(qIsbn);
  }

  function applySearch(keepPage = false) {
    const qn = norm(S.search.q);
    const qIsbn = cleanIsbn(S.search.q).length === S.search.q.replace(/[\s-]/g, '').length ? cleanIsbn(S.search.q) : '';
    const { owner, format, location } = S.search;
    S.search.filtered = S.books.filter((b) => inHome(b) && matchesQuery(b, qn, qIsbn)
      && (!owner || b.owners.includes(owner))
      && (!format || b.physical_format === format)
      && (!location || b.location === location));
    if (!keepPage) S.search.page = 1;
    clearBtn.disabled = !S.search.q && !owner && !format && !location;
    renderTable();
  }

  function genreCell(b) {
    if (!b.genres.length) return '<span class="muted">—</span>';
    const more = b.genres.length - 1;
    return `<span class="pill genre">${esc(b.genres[0])}</span>${more ? `<span class="pill more" title="${esc(b.genres.slice(1).join(', '))}">+${more}</span>` : ''}`;
  }

  function renderTable() {
    const list = S.search.filtered;
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    S.search.page = Math.min(Math.max(1, S.search.page), pages);
    const view = list.slice((S.search.page - 1) * PAGE_SIZE, S.search.page * PAGE_SIZE);
    $('#rows').innerHTML = view.map((b) => {
      const owners = b.owners.length ? `<div class="owners-cell">${b.owners.map(pickChip).join('')}</div>` : '<span class="muted">—</span>';
      const fmt = b.physical_format ? `<span class="pill">${esc(b.physical_format)}</span>` : '';
      return `<tr data-id="${esc(b.id)}" tabindex="0" aria-label="${esc(b.title)}"${S.search.highlight === idOf(b.id) ? ' class="just-added"' : ''}>
        <td class="c-cover">${thumbHtml(b.cover_url, b.title)}</td>
        <td class="t-title"><b>${esc(b.title)}</b>${b.subtitle ? `<small>${esc(b.subtitle)}</small>` : ''}</td>
        <td class="t-author">${esc(b.authors.join(', ') || '—')}</td>
        <td>${genreCell(b)}</td>
        <td class="c-num">${b.pages ? esc(b.pages) : '—'}</td>
        <td>${fmt || '<span class="muted">—</span>'}</td>
        <td>${owners}</td>
        <td>${esc(b.location || '—')}</td>
        <td class="t-mobile-meta">${b.genres[0] ? `<span class="pill genre">${esc(b.genres[0])}</span>` : ''}${fmt}${b.owners.map(pickChip).join('')}${b.location ? `<span class="loc">📍 ${esc(b.location)}</span>` : ''}</td>
      </tr>`;
    }).join('');
    $('#empty').hidden = !!list.length;
    $('#empty').textContent = homeBooks().length ? 'No encontramos ningún libro con esa búsqueda.' : 'La biblioteca está preparada. Cuando sumemos el primer libro, aparecerá aquí.';
    const total = homeBooks().length;
    $('#bookCount').textContent = list.length === total ? plural(total, 'libro', 'libros') : `${list.length.toLocaleString('es-ES')} de ${plural(total, 'libro', 'libros')}`;
    renderPager(pages);
  }

  /** Mismo criterio que la discoteca: primera, última y las cercanas, con un máximo de 10 indicadores. */
  function pageNumbers(page, pages) {
    if (pages <= MAX_PAGE_INDICATORS) return Array.from({ length: pages }, (_, i) => i + 1);
    const middle = MAX_PAGE_INDICATORS - 2;
    const start = Math.max(2, Math.min(page - 2, pages - middle));
    const nums = [1];
    for (let i = start; i < start + middle && i < pages; i++) nums.push(i);
    nums.push(pages);
    return [...new Set(nums)];
  }

  // Lomo de libro (cubierta granate, cinta de marcapáginas y franjas blancas).
  const SPINE_SVG = '<svg class="spine" viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="24" height="100" rx="1.6" fill="#b4004e"/><rect y="3" width="24" height="1.6" fill="#fff"/><rect y="21" width="24" height="2.4" fill="#fff"/><rect y="62" width="24" height="2.4" fill="#fff"/><rect y="67.5" width="24" height="2.4" fill="#fff"/><path d="M8.5 3h7v16l-3.5-3.6L8.5 19z" fill="#fff"/></svg>';
  function renderPager(pages) {
    const pager = $('#pager');
    if (!S.search.filtered.length) { pager.innerHTML = ''; return; }
    const page = S.search.page;
    const nums = pageNumbers(page, pages);
    let books = '';
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) books += '<span class="page-gap" aria-hidden="true">…</span>';
      books += `<button type="button" class="page-book${n === page ? ' active' : ''}" data-page="${n}" aria-label="Página ${n}"${n === page ? ' aria-current="page"' : ''}>${SPINE_SVG}<span class="num">${n}</span></button>`;
    });
    pager.innerHTML = `<button type="button" class="bookend prev" data-move="-1" aria-label="Página anterior"${page === 1 ? ' disabled' : ''}></button>`
      + '<span class="pager-word left" aria-hidden="true">BIBL</span>'
      + `<span class="shelf">${books}</span>`
      + '<span class="pager-word right" aria-hidden="true">OTECA</span>'
      + `<button type="button" class="bookend next" data-move="1" aria-label="Página siguiente"${page === pages ? ' disabled' : ''}></button>`;
  }

  function bindExplore() {
    buildFilterChips();
    fitFilterRow();
    window.addEventListener('resize', debounce(fitFilterRow, 120));
    document.fonts?.ready?.then(fitFilterRow);
    searchInput.addEventListener('input', () => { S.search.q = searchInput.value; S.search.highlight = null; applySearch(); });
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchInput.blur(); } });
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      S.search.q = '';
      S.search.owner = S.search.format = S.search.location = null;
      syncFilterChips();
      applySearch();
      // No se vuelve a enfocar el campo: en el móvil no se abre el teclado.
      searchInput.blur();
      clearBtn.blur();
    });
    $('#quickFilters').addEventListener('click', (e) => {
      const chip = e.target.closest('.filter-chip');
      if (!chip) return;
      const group = chip.closest('.filter-group').dataset.filterGroup;
      S.search[group] = S.search[group] === chip.dataset.value ? null : chip.dataset.value;
      syncFilterChips();
      applySearch();
    });
    $('#pager').addEventListener('click', (e) => {
      const p = e.target.closest('[data-page]');
      const m = e.target.closest('[data-move]');
      if (p) S.search.page = +p.dataset.page;
      else if (m && !m.disabled) S.search.page += +m.dataset.move;
      else return;
      renderTable();
      $('#search .table-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('#rows').addEventListener('click', (e) => {
      if (e.target.closest('.owner-pick')) return; // la viñeta abre la paleta de colores
      const tr = e.target.closest('tr[data-id]');
      if (tr) openBookDetail(tr.dataset.id);
    });
    $('#rows').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-id]')) { e.preventDefault(); openBookDetail(e.target.dataset.id); }
    });
  }

  /** Abre el buscador con un texto y sin filtros previos (lo usa el Top 7 de autores/as). */
  function searchFor(text) {
    S.search.q = text;
    S.search.owner = S.search.format = S.search.location = null;
    searchInput.value = text;
    syncFilterChips();
    showPage('search');
    applySearch();
  }

  /* =================================================================
     7. FICHA DEL LIBRO
     ================================================================= */
  function starsHtml(value, size = '') {
    let html = `<span class="stars ${size}" role="img" aria-label="${esc(fmtRating(value))}">`;
    for (let i = 1; i <= 5; i++) html += starInner(value, i, 'span');
    return `${html}</span>`;
  }
  const STAR_PATH = 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z';
  function starInner(value, i, tag, attrs = '') {
    const state = value >= i ? 'full' : value >= i - 0.5 ? 'half' : 'empty';
    return `<${tag} class="star ${state}" ${attrs}><svg class="s-out" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg><span class="s-fill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg></span><i class="s-split" aria-hidden="true"></i></${tag}>`;
  }

  function ratingsListHtml(bookId) {
    return FAMILY.map((p) => {
      const r = S.ratings.find((x) => idOf(x.book_id) === idOf(bookId) && x.person === p);
      return `<div class="rating-row"><small>${esc(p)}</small><span class="rv">${r ? `${starsHtml(Number(r.rating))}<em>${esc(fmtDecimal(r.rating))}</em>` : '<em>Sin valorar</em>'}</span></div>`;
    }).join('');
  }

  function openBookDetail(id) {
    if (!bookById(id)) return;
    S.detailId = idOf(id);
    renderBookDetail(id);
    openModal($('#bookModal'));
  }

  function renderBookDetail(id) {
    const b = bookById(id);
    if (!b) return;
    $('#bmCover').innerHTML = coverHtml(b.cover_url, b.title, true);
    $('#bmFormat').textContent = inHome(b) ? (b.physical_format || 'Formato sin indicar') : 'Leído fuera de casa';
    $('#bmTitle').textContent = b.title;
    $('#bmSubtitle').textContent = b.subtitle || '';
    $('#bmAuthors').textContent = b.authors.join(', ') || 'Autor desconocido';
    const isbn = [b.isbn13 && `ISBN-13: <b>${esc(b.isbn13)}</b>`, b.isbn10 && `ISBN-10: <b>${esc(b.isbn10)}</b>`].filter(Boolean).join('<br>');
    const genres = b.genres.length ? b.genres.map((g, i) => `<span class="pill${i ? ' more' : ' genre'}">${esc(g)}</span>`).join('') : '<b>—</b>';
    $('#bmMeta').innerHTML = [
      `<span class="wide">🔢 ${isbn || 'ISBN: <b>—</b>'}</span>`,
      `<span>🏢 Editorial: <b>${esc(b.publisher || '—')}</b></span>`,
      `<span>📅 Año: <b>${esc(b.published_year || '—')}</b></span>`,
      `<span>📑 Edición: <b>${esc(b.edition || '—')}</b></span>`,
      `<span>📄 Páginas: <b>${esc(b.pages || '—')}</b></span>`,
      `<span class="wide">🏷️ Género: ${genres}</span>`,
      `<span>🌍 Idioma: <b>${esc(b.language || '—')}</b></span>`,
      `<span>📍 Ubicación: <b>${esc(b.location || '—')}</b></span>`,
      `<span class="wide">👤 Propietarios: ${b.owners.length ? b.owners.map(ownerChip).join('') : '<b>—</b>'}</span>`,
      b.notes ? `<span class="wide">📝 Notas: <b>${esc(b.notes)}</b></span>` : '',
      `<span class="wide">🗓️ Incorporado el <b>${esc(fmtDate(b.created_at) || '—')}</b>${b.updated_at && b.updated_at !== b.created_at ? ` <small class="muted">· editado el ${esc(fmtDate(b.updated_at))}</small>` : ''}</span>`
    ].join('');
    $('#bmRatings').innerHTML = S.missing.has(T.ratings) ? '<p class="muted">Las valoraciones necesitan la migración SQL.</p>' : ratingsListHtml(b.id);
    const journeys = journeysForBook(b.id);
    $('#bmJourneysWrap').hidden = !journeys.length;
    $('#bmJourneys').innerHTML = journeys.map((j) => `<div class="journey-row"><b>${esc(j.person)}</b><span>${j.finished ? `📗 Terminado el ${esc(fmtDate(j.finishedOn))}` : `📖 En curso · pág. ${esc(j.lastPage)}`}${j.startedOn ? ` <small class="muted">(desde ${esc(fmtDate(j.startedOn))})</small>` : ''}</span></div>`).join('');
  }

  function bindDetail() {
    $('#bookModalClose').addEventListener('click', () => closeModal($('#bookModal')));
    $('#bookModal').addEventListener('click', (e) => { if (e.target.id === 'bookModal') closeModal(e.currentTarget); });
    $('#bmEdit').addEventListener('click', () => startEdit(S.detailId));
    $('#bmDelete').addEventListener('click', () => deleteBook(S.detailId));
    $('#bmRate').addEventListener('click', () => goRate(S.detailId));
    $('#bmCalendar').addEventListener('click', () => startCalendarPick(S.detailId));
  }

  /* ---------- Eliminación protegida (contraseña 1354, como la discoteca) ---------- */
  async function countRelated(bookId) {
    const local = {
      ratings: S.ratings.filter((r) => idOf(r.book_id) === idOf(bookId)).length,
      pending: S.pending.filter((r) => idOf(r.book_id) === idOf(bookId)).length,
      sessions: S.sessions.filter((r) => idOf(r.book_id) === idOf(bookId)).length
    };
    try {
      const c = (t) => (S.missing.has(t) ? Promise.resolve(0) : q(S.db.from(t).select('id', { count: 'exact', head: true }).eq('book_id', bookId)));
      const [ratings, pending, sessions] = await Promise.all([c(T.ratings), c(T.pending), c(T.sessions)]);
      return { ratings: Number(ratings) || 0, pending: Number(pending) || 0, sessions: Number(sessions) || 0 };
    } catch {
      return local;
    }
  }

  async function deleteBook(id) {
    const b = bookById(id);
    if (!b) return;
    const pw = await dialog({
      title: 'Eliminar libro',
      message: 'Introduce la contraseña para eliminar este libro:',
      input: { type: 'password', inputmode: 'numeric', label: 'Contraseña' },
      buttons: [{ label: 'Cancelar', value: false }, { label: 'Continuar', value: true, kind: 'primary' }]
    });
    if (pw.value !== true) return;
    if (pw.input !== DELETE_PASSWORD) { toast('Contraseña incorrecta'); return; }

    const rel = await countRelated(b.id);
    const journeys = journeysForBook(b.id);
    const sameIsbnWishes = S.wishes.filter((w) => (b.isbn13 && w.isbn13 === b.isbn13) || (b.isbn10 && w.isbn10 === b.isbn10)).length;
    const lines = [
      `<li>${plural(rel.ratings, 'valoración', 'valoraciones')} de la familia: <b>se eliminarán</b>.</li>`,
      `<li>${plural(rel.pending, 'registro', 'registros')} en Próximas paradas: <b>se eliminarán</b>.</li>`,
      `<li>${plural(rel.sessions, 'sesión', 'sesiones')} de lectura${journeys.length ? ` (${journeys.map((j) => `${esc(j.person)}: ${j.startedOn ? `inicio ${esc(fmtDate(j.startedOn))}` : ''}${j.finished ? `, fin ${esc(fmtDate(j.finishedOn))}` : ', en curso'}`).join('; ')})` : ''}: ${rel.sessions ? '<b>se eliminarán tras una segunda confirmación</b>' : 'ninguna'}.</li>`,
      `<li>${plural(sameIsbnWishes, 'deseo', 'deseos')} con este ISBN en Destinos de papel: <b>se conservan</b>.</li>`
    ];
    const ok = await confirmDialog('¿Eliminar este libro?', `<p>Vas a eliminar «${esc(b.title)}»${b.owners.length ? ` de ${esc(b.owners.join(' y '))}` : ''}.</p><ul>${lines.join('')}</ul>`, 'Eliminar', 'danger', true);
    if (!ok) return;
    if (rel.sessions) {
      const ok2 = await confirmDialog('Este libro tiene lecturas registradas',
        `<p>Hay ${plural(rel.sessions, 'sesión', 'sesiones')} en Mi ruta de lectura. Si continúas, desaparecerán del calendario y de las estadísticas.</p><p><b>¿Eliminar definitivamente el libro y su historial de lectura?</b></p>`,
        'Sí, eliminar todo', 'danger', true);
      if (!ok2) return;
    }
    const res = await Loader.run({ gif: GIF.save, messages: MSG.remove }, async () => {
      await db.remove(T.books, b.id); // valoraciones, paradas y lecturas se borran por ON DELETE CASCADE
      await removeCoverIfUnused(b.cover_path, b.id);
    });
    if (!res.ok) return;
    removeBookLocal(b.id);
    closeModal($('#bookModal'));
    S.detailId = null;
    if (S.rating.bookId === idOf(b.id)) S.rating.bookId = null;
    applySearch(true);
    refreshViews();
    toast('Libro eliminado');
  }

  async function removeCoverIfUnused(path, exceptId) {
    if (!path) return;
    try {
      const others = await q(S.db.from(T.books).select('id').eq('cover_path', path).neq('id', exceptId).limit(1));
      if (others?.length) return; // la imagen la usa otro ejemplar
      await S.db.storage.from(COVER_BUCKET).remove([path]);
    } catch (e) {
      console.warn('No se pudo borrar la portada del almacenamiento', e);
    }
  }

  /* =================================================================
     8. SUMAR / EDITAR UN LIBRO: FORMULARIO
     ================================================================= */
  const form = $('#bookForm');

  /** Campo de varias etiquetas (autores, géneros). Intro o separador añade; × elimina. */
  function chipInput(root, separators) {
    let items = [];
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.enterKeyHint = 'next';
    input.placeholder = root.dataset.placeholder || '';
    input.setAttribute('aria-labelledby', root.getAttribute('aria-labelledby') || '');
    root.appendChild(input);
    function render() {
      $$('.chip', root).forEach((c) => c.remove());
      items.forEach((v, i) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.innerHTML = `<span>${esc(v)}</span><button type="button" data-i="${i}" aria-label="Quitar ${esc(v)}">×</button>`;
        root.insertBefore(c, input);
      });
      input.placeholder = items.length ? '' : (root.dataset.placeholder || '');
    }
    function add(text) {
      String(text || '').split(separators).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).forEach((v) => {
        if (!items.some((x) => norm(x) === norm(v))) items.push(v);
      });
      render();
    }
    function commit() { if (input.value.trim()) { add(input.value); input.value = ''; } }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Backspace' && !input.value && items.length) { items.pop(); render(); }
    });
    input.addEventListener('input', () => {
      if (separators.test(input.value)) {
        const parts = input.value.split(separators);
        const last = parts.pop();
        add(parts.join(';'));
        input.value = last;
      }
    });
    input.addEventListener('blur', commit);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { items.splice(+b.dataset.i, 1); render(); input.focus(); return; }
      if (e.target === root) input.focus();
    });
    return {
      get() { commit(); return [...items]; },
      set(list) { items = []; input.value = ''; add(arr(list).join(';')); },
      focus() { input.focus(); }
    };
  }
  let authorsField, genresField;

  function buildEntryGroups() {
    const lists = { owners: FAMILY, location: LOCATIONS, format: FORMATS };
    $$('.entry-group', form).forEach((g) => {
      g.innerHTML = lists[g.dataset.entryGroup].map((v) => `<button type="button" data-value="${esc(v)}" aria-pressed="false">${esc(v)}</button>`).join('');
    });
  }
  function syncEntryGroups() {
    $$('.entry-group', form).forEach((g) => {
      const type = g.dataset.entryGroup;
      $$('button', g).forEach((b) => {
        const on = type === 'owners' ? S.form.owners.has(b.dataset.value) : S.form[type] === b.dataset.value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    });
  }

  /* ---------- Portada ---------- */
  /** Limpia la dirección copiada (incluidos los enlaces de Google «imgres?imgurl=…»). */
  function imageUrlFrom(raw) {
    let url = String(raw || '').trim().replace(/&amp;/g, '&');
    try {
      const u = new URL(url);
      const wrapped = u.searchParams.get('imgurl') || u.searchParams.get('mediaurl');
      if (wrapped && /^https?:/i.test(wrapped)) url = wrapped;
    } catch { return ''; }
    url = url.replace(/^http:\/\//i, 'https://');
    return /^https:\/\/\S+$/i.test(url) ? url : '';
  }
  function revokePreview() {
    if (S.form.cover.preview?.startsWith('blob:')) URL.revokeObjectURL(S.form.cover.preview);
  }
  function setCover({ url = '', path = null, blob = null } = {}) {
    revokePreview();
    S.form.cover = { url, path, blob, preview: blob ? URL.createObjectURL(blob) : url };
    $('#fCoverUrl').value = blob || String(url).startsWith('data:') ? '' : url;
    renderCoverPreview();
  }
  function renderCoverPreview() {
    const p = $('#coverPreview');
    const src = S.form.cover.preview;
    p.classList.toggle('empty', !src);
    if (!src) { p.innerHTML = '<span>Sin portada</span>'; return; }
    p.innerHTML = `<img src="${esc(src)}" alt="Portada seleccionada" referrerpolicy="no-referrer">`;
    const img = $('img', p);
    img.onerror = () => {
      p.classList.add('empty');
      p.innerHTML = '<span>No se pudo cargar esta portada</span>';
      $('#coverHelp').textContent = 'Portada no disponible. Usa la dirección directa de una imagen, haz una foto o elige una imagen.';
    };
    img.onload = () => { $('#coverHelp').textContent = S.form.cover.blob ? 'Foto preparada: se guardará al pulsar «Guardar libro».' : 'Portada cargada correctamente.'; };
  }
  function showCoverChoices(urls) {
    S.form.choices = [...new Set(arr(urls).filter(Boolean))];
    $('#coverChoices').innerHTML = S.form.choices.length > 1
      ? S.form.choices.map((u, i) => `<button type="button" class="cover-choice${i === 0 ? ' active' : ''}" data-cover="${esc(u)}" aria-label="Portada opción ${i + 1}"><img src="${esc(u)}" alt="" referrerpolicy="no-referrer"></button>`).join('')
      : '';
  }

  /** Comprime una foto para no subir imágenes enormes (máx. 1000 px y ~350 KB). */
  async function compressImage(file, max = 1000, targetBytes = 350000, minQuality = 0.5) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw Object.assign(new Error('not-image'), { userMessage: 'El archivo elegido no es una imagen.' });
    if (file.size > 40 * 1024 * 1024) throw Object.assign(new Error('too-big'), { userMessage: 'La imagen es demasiado grande (más de 40 MB). Prueba con otra foto.' });
    let source;
    try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {
      source = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => { URL.revokeObjectURL(url); resolve(im); };
        im.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error('decode'), { userMessage: 'No se ha podido leer esa imagen.' })); };
        im.src = url;
      });
    }
    const w = source.width, h = source.height;
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    let quality = 0.84;
    let blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    while (blob && blob.size > targetBytes && quality > minQuality) {
      quality -= 0.08;
      blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    }
    if (!blob) throw Object.assign(new Error('encode'), { userMessage: 'No se ha podido preparar la imagen.' });
    return blob;
  }
  const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('No se pudo leer la imagen'));
    r.readAsDataURL(blob);
  });

  async function handleCoverFile(file) {
    if (!file) return;
    try {
      $('#coverHelp').textContent = 'Preparando la foto…';
      const blob = await compressImage(file);
      setCover({ blob });
      $$('.cover-choice').forEach((c) => c.classList.remove('active'));
    } catch (e) {
      $('#coverHelp').textContent = explainError(e);
      toast(explainError(e));
    }
  }

  /** Sube la portada a Supabase Storage (o, si no se puede, la guarda comprimida en la fila). */
  async function persistCover() {
    const c = S.form.cover;
    if (c.blob) {
      const path = `covers/${new Date().getFullYear()}/${uuid()}.jpg`;
      try {
        const { error } = await withTimeout(S.db.storage.from(COVER_BUCKET).upload(path, c.blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }), 25000);
        if (error) throw error;
        const { data } = S.db.storage.from(COVER_BUCKET).getPublicUrl(path);
        return { cover_url: data.publicUrl, cover_path: path };
      } catch (e) {
        console.warn('Storage no disponible, se guarda la portada comprimida en la fila', e);
        const small = await compressImage(c.blob, 520, 90000, 0.4);
        S.form.coverWarning = 'La portada se ha guardado en formato reducido porque el almacenamiento de imágenes no respondió.';
        return { cover_url: await blobToDataUrl(small), cover_path: null };
      }
    }
    if (c.url) return { cover_url: c.url, cover_path: c.path || null };
    return { cover_url: null, cover_path: null };
  }

  /* ---------- Rellenar, leer y limpiar el formulario ---------- */
  function resetForm(mode = 'new') {
    form.reset();
    revokePreview();
    S.form = { mode, editId: null, returnPage: 'search', wishId: null, owners: new Set(), location: null, format: null, meta: {}, cover: { url: '', path: null, blob: null, preview: '' }, choices: [], coverWarning: null };
    authorsField.set([]);
    genresField.set([]);
    syncEntryGroups();
    renderCoverPreview();
    showCoverChoices([]);
    $('#coverHelp').textContent = 'Si la búsqueda no trae portada, puedes hacerle una foto al libro.';
    $('#formError').textContent = '';
    $('#formTitle').textContent = 'Sumar un libro';
    $('#formSubtitle').textContent = 'Escanea su ISBN, búscalo por título o completa los datos a mano.';
    $('#saveBook').textContent = 'Guardar libro';
    $('#entryActions').hidden = false;
    $('#pasteCover').hidden = true;
  }

  /** Completa el formulario con una edición encontrada (se puede corregir todo antes de guardar). */
  function fillForm(r) {
    $('#fTitle').value = r.title || '';
    $('#fSubtitle').value = r.subtitle || '';
    authorsField.set(r.authors || []);
    $('#fPublisher').value = r.publisher || '';
    $('#fIsbn13').value = r.isbn13 || '';
    $('#fIsbn10').value = r.isbn10 || '';
    $('#fYear').value = r.year || r.published_year || '';
    $('#fEdition').value = r.edition || '';
    genresField.set(r.genres || []);
    $('#fPages').value = r.pages || '';
    $('#fLanguage').value = r.language || '';
    S.form.meta = {
      published_date: r.published_date || null,
      openlibrary_work_id: r.olWork || r.openlibrary_work_id || null,
      openlibrary_edition_id: r.olEdition || r.openlibrary_edition_id || null,
      google_books_id: r.googleId || r.google_books_id || null
    };
    const suggested = formatFromPhysical(r.physical);
    if (suggested && !S.form.format) S.form.format = suggested;
    syncEntryGroups();
    const covers = [...new Set([...(r.covers || []), r.cover || r.cover_url].filter(Boolean))];
    showCoverChoices(covers);
    if (covers[0]) setCover({ url: covers[0] });
    else if (!S.form.cover.blob) { setCover({}); $('#coverHelp').textContent = 'Esta edición no tiene portada en las fuentes. Puedes hacerle una foto o elegir una imagen.'; }
    $('#formError').textContent = '';
    if (S.page !== 'add') showPage('add');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function readForm() {
    const errors = [];
    const warnings = [];
    const title = clean($('#fTitle').value);
    const authors = normalizeAuthors(authorsField.get());
    if (!title) errors.push(['Escribe el título del libro.', '#fTitle']);
    if (!authors.length) errors.push(['Indica al menos un autor o autora.', null]);
    const i13 = cleanIsbn($('#fIsbn13').value);
    let i10 = cleanIsbn($('#fIsbn10').value);
    if (i13 && i13.length !== 13) errors.push(['El ISBN-13 debe tener 13 dígitos.', '#fIsbn13']);
    else if (i13 && !isValidIsbn13(i13)) warnings.push('El ISBN-13 no supera la comprobación del dígito de control.');
    if (i10 && i10.length !== 10) errors.push(['El ISBN-10 debe tener 10 caracteres.', '#fIsbn10']);
    else if (i10 && !isValidIsbn10(i10)) warnings.push('El ISBN-10 no supera la comprobación del dígito de control.');
    if (!i10 && i13 && isValidIsbn13(i13)) i10 = isbn13to10(i13) || '';
    const yearRaw = $('#fYear').value.trim();
    const year = yearRaw ? parseYear(yearRaw) : null;
    if (yearRaw && (!year || !/^\d{1,4}$/.test(yearRaw))) errors.push(['El año debe ser un número de 4 cifras.', '#fYear']);
    const pages = parsePositiveInt($('#fPages').value);
    if (Number.isNaN(pages) || pages === 0) errors.push(['El número de páginas debe ser un número entero mayor que 0.', '#fPages']);
    const missing = [];
    if (!S.form.owners.size) missing.push('propietario');
    if (!S.form.location) missing.push('ubicación');
    if (!S.form.format) missing.push('formato');
    const payload = {
      title,
      subtitle: clean($('#fSubtitle').value),
      authors,
      isbn13: i13 || null,
      isbn10: i10 || null,
      publisher: clean($('#fPublisher').value),
      published_year: year,
      published_date: S.form.meta.published_date || null,
      edition: clean($('#fEdition').value),
      pages: Number.isNaN(pages) ? null : pages,
      genres: normalizeGenres(genresField.get(), 12),
      language: clean($('#fLanguage').value),
      openlibrary_work_id: S.form.meta.openlibrary_work_id || null,
      openlibrary_edition_id: S.form.meta.openlibrary_edition_id || null,
      google_books_id: S.form.meta.google_books_id || null,
      owners: FAMILY.filter((p) => S.form.owners.has(p)),
      location: S.form.location,
      physical_format: S.form.format,
      notes: clean($('#fNotes').value)
    };
    // Los géneros escritos a mano se respetan aunque no estén en el diccionario de traducción.
    const typedGenres = genresField.get();
    if (typedGenres.length && !payload.genres.length) payload.genres = normalizeAuthors(typedGenres);
    return { payload, errors, warnings, missing };
  }

  function showFormError(msg, sel) {
    $('#formError').textContent = msg;
    if (sel) $(sel)?.focus();
    $('#formError').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  async function findDuplicates(p) {
    if (!p.isbn13 && !p.isbn10) {
      const key = `${norm(p.authors[0])}|${norm(p.title)}`;
      return { byIsbn: false, list: homeBooks().filter((b) => `${norm(b.authors[0])}|${norm(b.title)}` === key) };
    }
    const local = homeBooks().filter((b) => (p.isbn13 && b.isbn13 === p.isbn13) || (p.isbn10 && b.isbn10 === p.isbn10));
    try {
      const ors = [p.isbn13 && `isbn13.eq.${p.isbn13}`, p.isbn10 && `isbn10.eq.${p.isbn10}`].filter(Boolean).join(',');
      const rows = await q(S.db.from(T.books).select('*').or(ors));
      return { byIsbn: true, list: rows ? rows.filter(inHome) : local };
    } catch {
      return { byIsbn: true, list: local };
    }
  }

  async function submitBook(e) {
    e?.preventDefault();
    $('#formError').textContent = '';
    const { payload, errors, warnings, missing } = readForm();
    if (errors.length) { showFormError(errors[0][0], errors[0][1]); return; }
    for (const w of warnings) {
      if (!(await confirmDialog('Revisa el ISBN', `${w} ¿Guardar igualmente?`, 'Guardar igualmente'))) return;
    }
    if (missing.length && !(await confirmDialog('Faltan datos de la estantería', `Falta indicar: ${missing.join(', ')}. Sin esos datos el libro no aparecerá en algunos filtros. ¿Guardar igualmente?`, 'Guardar igualmente'))) return;
    const editing = S.form.mode === 'edit';
    if (!editing && S.db) {
      const dup = await findDuplicates(payload);
      if (dup.list.length) {
        const desc = dup.list.slice(0, 4).map((b) => `<li>${esc(b.title)} · ${esc(arr(b.owners).join(' y ') || 'sin propietario')} · ${esc(b.location || 'sin ubicación')} · ${esc(b.physical_format || 'sin formato')}</li>`).join('');
        const ok = await confirmDialog(dup.byIsbn ? 'Ya hay un ejemplar con este ISBN' : 'Parece que este libro ya está en casa',
          `<p>${dup.byIsbn ? 'La biblioteca ya tiene' : 'Hay'} ${plural(dup.list.length, 'ejemplar', 'ejemplares')} ${dup.byIsbn ? 'de esta edición' : 'con el mismo título y autor'}:</p><ul>${desc}</ul><p>¿Es otro ejemplar físico distinto (por ejemplo, de otra persona)?</p>`,
          'Añadir otro ejemplar', 'primary', true);
        if (!ok) return;
      }
    }
    const before = editing ? bookById(S.form.editId) : null;
    S.form.coverWarning = null;
    const res = await Loader.run({ gif: GIF.save, messages: editing ? MSG.update : MSG.save }, async () => {
      assertDb();
      const coverInfo = await persistCover();
      const row = { ...payload, ...coverInfo };
      if (editing) return db.update(T.books, S.form.editId, row); // created_at no se envía: se conserva
      return db.insert(T.books, { ...newId(), ...row });
    });
    if (!res.ok) return;
    const saved = setBookLocal(res.value);
    if (S.form.coverWarning) toast(S.form.coverWarning, 4200);
    if (before?.cover_path && before.cover_path !== saved.cover_path) removeCoverIfUnused(before.cover_path, saved.id);

    const wishId = S.form.wishId;
    if (wishId) {
      try {
        await db.remove(T.wishes, wishId);
        removeLocal(S.wishes, wishId);
        toast('Libro guardado y destino de papel cumplido ✨');
      } catch (err) {
        toast(`Libro guardado, pero no se pudo quitar el deseo: ${explainError(err)}`, 4500);
      }
    } else if (!S.form.coverWarning) {
      toast(editing ? 'Cambios guardados' : 'Libro guardado en la biblioteca');
    }

    const returnPage = S.form.returnPage;
    resetForm();
    if (editing) {
      showPage(returnPage === 'add' ? 'search' : returnPage);
      openBookDetail(saved.id);
    } else {
      // El libro nuevo se ve al momento en Explorar: sin filtros y en su página.
      S.search.q = ''; searchInput.value = '';
      S.search.owner = S.search.format = S.search.location = null;
      syncFilterChips();
      S.search.highlight = idOf(saved.id);
      S.search.filtered = homeBooks();
      const idx = S.search.filtered.findIndex((b) => idOf(b.id) === idOf(saved.id));
      S.search.page = Math.floor(Math.max(0, idx) / PAGE_SIZE) + 1;
      showPage('search');
      requestAnimationFrame(() => $(`#rows tr[data-id="${CSS.escape(idOf(saved.id))}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      setTimeout(() => { S.search.highlight = null; }, 4000);
    }
    refreshViews();
  }

  function startEdit(id) {
    const b = bookById(id);
    if (!b) return;
    const returnPage = S.page;
    closeModal($('#bookModal'));
    resetForm('edit');
    S.form.editId = idOf(b.id);
    S.form.returnPage = returnPage;
    $('#formTitle').textContent = 'Editar libro';
    $('#formSubtitle').textContent = 'Corrige lo que necesites. La fecha de incorporación no cambia.';
    $('#saveBook').textContent = 'Guardar cambios';
    fillForm({ ...b, year: b.published_year, covers: [b.cover_url] });
    S.form.owners = new Set(b.owners);
    S.form.location = b.location || null;
    S.form.format = b.physical_format || null;
    syncEntryGroups();
    $('#fNotes').value = b.notes || '';
    setCover({ url: b.cover_url || '', path: b.cover_path || null });
    showCoverChoices([]);
    showPage('add');
  }

  function startFromWish(w) {
    resetForm('new');
    S.form.wishId = idOf(w.id);
    S.form.owners = new Set([w.person]);
    $('#formSubtitle').textContent = `Desde Destinos de papel de ${w.person}: revisa los datos y elige dónde estará.`;
    fillForm({ ...w, year: w.published_year, covers: [w.cover_url] });
    syncEntryGroups();
    setCover({ url: w.cover_url || '' });
  }

  function bindForm() {
    authorsField = chipInput($('#fAuthors'), /[;\n]/);
    genresField = chipInput($('#fGenres'), /[,;\n]/);
    buildEntryGroups();
    form.addEventListener('submit', submitBook);
    form.addEventListener('keydown', (e) => {
      // Intro en un campo normal no envía el formulario por accidente.
      if (e.key === 'Enter' && e.target.matches('input:not([type=submit])') && !e.target.closest('.chip-input')) {
        e.preventDefault();
        if (e.target.id === 'fIsbn13' || e.target.id === 'fIsbn10') $('#lookupIsbn').click();
      }
    });
    $('.entry-filter-row', form).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-value]');
      if (!b) return;
      const type = b.closest('.entry-group').dataset.entryGroup;
      const v = b.dataset.value;
      if (type === 'owners') { if (S.form.owners.has(v)) S.form.owners.delete(v); else S.form.owners.add(v); }
      else S.form[type] = S.form[type] === v ? null : v;
      syncEntryGroups();
    });
    $('#coverChoices').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cover]');
      if (!b) return;
      $$('.cover-choice').forEach((x) => x.classList.toggle('active', x === b));
      setCover({ url: b.dataset.cover });
    });
    $('#coverCamera').addEventListener('change', (e) => { handleCoverFile(e.target.files?.[0]); e.target.value = ''; });
    $('#coverFile').addEventListener('change', (e) => { handleCoverFile(e.target.files?.[0]); e.target.value = ''; });
    $('#removeCover').addEventListener('click', () => { setCover({}); $$('.cover-choice').forEach((x) => x.classList.remove('active')); });
    $('#fCoverUrl').addEventListener('change', () => {
      const u = imageUrlFrom($('#fCoverUrl').value);
      if (!u) { if ($('#fCoverUrl').value.trim()) $('#coverHelp').textContent = 'Usa la dirección de una imagen que empiece por https://'; return; }
      setCover({ url: u });
    });
    // Google Imágenes con título y autor: allí se elige la portada y se copia su dirección.
    $('#googleCover').addEventListener('click', () => {
      const title = $('#fTitle').value.trim();
      if (!title) { $('#coverHelp').textContent = 'Escribe primero el título para buscar su portada.'; $('#fTitle').focus(); return; }
      const q = `${title} ${authorsField.get().join(' ')} portada libro`.replace(/\s+/g, ' ').trim();
      window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, '_blank', 'noopener');
      $('#coverHelp').textContent = 'En Google, mantén pulsada la portada → «Copiar dirección de la imagen» y vuelve aquí para pegarla. También puedes descargarla y usar «Elegir imagen».';
      if (navigator.clipboard?.readText) $('#pasteCover').hidden = false;
    });
    $('#pasteCover').addEventListener('click', async () => {
      try {
        const u = imageUrlFrom(await navigator.clipboard.readText());
        if (!u) throw new Error('sin url');
        setCover({ url: u });
        $$('.cover-choice').forEach((x) => x.classList.remove('active'));
      } catch {
        $('#coverHelp').textContent = 'No se pudo leer una dirección de imagen. Pégala a mano en el campo de arriba.';
        $('#fCoverUrl').focus();
      }
    });
    $('#lookupIsbn').addEventListener('click', () => lookupIsbn($('#fIsbn13').value || $('#fIsbn10').value));
    $('#scanIsbn').addEventListener('click', openScanner);
    $('#openTitleSearch').addEventListener('click', () => openTitleSearch('add'));
    $('#manualEntry').addEventListener('click', () => {
      if (S.form.mode !== 'edit') resetForm();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => $('#fTitle').focus({ preventScroll: true }), 350);
    });
    $('#cancelEdit').addEventListener('click', () => {
      const wasEdit = S.form.mode === 'edit';
      const editId = S.form.editId;
      const back = S.form.returnPage;
      resetForm();
      showPage(wasEdit && back !== 'add' ? back : 'search');
      if (wasEdit && editId) openBookDetail(editId);
    });
  }

  /* =================================================================
     9. FUENTES EXTERNAS: OPEN LIBRARY (principal) Y GOOGLE BOOKS (apoyo)
     ================================================================= */
  const OL = 'https://openlibrary.org';
  const olCover = (id) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`;
  const olIsbnCover = (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;

  async function fetchJson(url, ms = 12000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') { const x = new Error('Tiempo de espera agotado'); x.code = 'TIMEOUT'; throw x; }
      throw e;
    } finally { clearTimeout(t); }
  }

  /** Normaliza un resultado: autores, géneros e ISBN-10/13 equivalentes (mismo identificador). */
  function finalize(r) {
    r.authors = normalizeAuthors(r.authors);
    r.genres = normalizeGenres(r.genres);
    r.isbns = [...new Set(arr(r.isbns).map(cleanIsbn).filter(Boolean))];
    r.isbn13 = r.isbn13 ? cleanIsbn(r.isbn13) : (r.isbns.find((i) => i.length === 13 && isValidIsbn13(i)) || null);
    r.isbn10 = r.isbn10 ? cleanIsbn(r.isbn10) : (r.isbns.find((i) => i.length === 10 && isValidIsbn10(i)) || null);
    if (r.isbn10 && !r.isbn13) r.isbn13 = isbn10to13(r.isbn10);
    if (r.isbn13 && !r.isbn10) r.isbn10 = isbn13to10(r.isbn13);
    r.year = r.year ?? parseYear(r.published_date);
    r.covers = [...new Set([r.cover, ...(r.covers || [])].filter(Boolean))];
    r.cover = r.covers[0] || null;
    r.title = r.title ? String(r.title).trim() : '';
    return r;
  }
  const isbnMatches = (r, p) => { const s = isbnSet(r); return (p.isbn13 && s.has(p.isbn13)) || (p.isbn10 && s.has(p.isbn10)); };

  function olDataToResult(v) {
    const ids = v.identifiers || {};
    return finalize({
      source: 'Open Library', title: v.title, subtitle: v.subtitle, authors: (v.authors || []).map((a) => a.name),
      publisher: v.publishers?.[0]?.name || null, published_date: v.publish_date || null, pages: v.number_of_pages || null,
      genres: (v.subjects || []).map((s) => s.name || s), isbns: [...(ids.isbn_13 || []), ...(ids.isbn_10 || [])],
      cover: v.cover?.large || v.cover?.medium || null, olEdition: v.key ? String(v.key).split('/').pop() : null,
      googleId: ids.google?.[0] || null
    });
  }
  function olEditionToResult(e, authors = []) {
    const cid = (e.covers || []).find((c) => c > 0);
    return finalize({
      source: 'Open Library', title: e.title, subtitle: e.subtitle, authors,
      publisher: e.publishers?.[0] || null, published_date: e.publish_date || null, pages: e.number_of_pages || null,
      genres: e.subjects || [], language: languageName(e.languages?.[0]?.key), edition: e.edition_name || null,
      physical: e.physical_format || null, isbns: [...(e.isbn_13 || []), ...(e.isbn_10 || [])],
      cover: cid ? olCover(cid) : null, olEdition: e.key ? String(e.key).split('/').pop() : null,
      olWork: e.works?.[0]?.key ? String(e.works[0].key).split('/').pop() : null
    });
  }
  function gbToResult(item) {
    const v = item.volumeInfo || {};
    const ids = v.industryIdentifiers || [];
    let cover = v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || null;
    if (cover) cover = cover.replace(/^http:/, 'https:').replace(/&edge=curl/g, '');
    return finalize({
      source: 'Google Books', title: v.title, subtitle: v.subtitle, authors: v.authors || [], publisher: v.publisher || null,
      published_date: v.publishedDate || null, pages: v.pageCount || null, genres: v.categories || [],
      language: languageName(v.language), isbns: ids.filter((x) => /ISBN/.test(x.type)).map((x) => x.identifier),
      isbn13: ids.find((x) => x.type === 'ISBN_13')?.identifier || null, isbn10: ids.find((x) => x.type === 'ISBN_10')?.identifier || null,
      cover, googleId: item.id
    });
  }

  /** Completa datos que faltan SOLO con otra fuente de la misma edición (mismo ISBN-13). */
  function mergeSameEdition(a, b) {
    if (!a) return b;
    if (!b || !a.isbn13 || a.isbn13 !== b.isbn13) return a;
    const m = { ...a };
    for (const k of ['subtitle', 'publisher', 'published_date', 'year', 'pages', 'language', 'edition', 'physical', 'olWork', 'olEdition', 'googleId', 'isbn10']) {
      if (m[k] == null || m[k] === '') m[k] = b[k];
    }
    if (!m.title) m.title = b.title;
    if (!m.authors?.length) m.authors = b.authors;
    const gGenres = a.source === 'Google Books' ? a.genres : b.source === 'Google Books' ? b.genres : [];
    m.genres = normalizeGenres([...gGenres, ...a.genres, ...b.genres]);
    m.covers = [...new Set([...(a.covers || []), ...(b.covers || [])])];
    m.cover = m.covers[0] || null;
    m.isbns = [...new Set([...(a.isbns || []), ...(b.isbns || [])])];
    if (a.source !== b.source && !String(m.source).includes(b.source)) m.source = `${a.source} + ${b.source}`;
    return m;
  }
  function groupByIsbn(list) {
    const byIsbn = new Map();
    const loose = [];
    for (const r of list) {
      if (!r.title) continue;
      if (r.isbn13) byIsbn.set(r.isbn13, mergeSameEdition(byIsbn.get(r.isbn13), r));
      else loose.push(r);
    }
    return [...byIsbn.values(), ...loose];
  }

  function imageLoads(url, ms = 6000) {
    return new Promise((resolve) => {
      const img = new Image();
      const t = setTimeout(() => { img.src = ''; resolve(false); }, ms);
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 10 && img.naturalHeight > 10); };
      img.onerror = () => { clearTimeout(t); resolve(false); };
      img.src = url;
    });
  }
  /** Comprueba que cada portada (de la propia edición o de su ISBN) existe; descarta las rotas. */
  async function verifyCovers(list, max = 24) {
    const jobs = [];
    for (const r of list.slice(0, max)) {
      const candidates = [...(r.covers || [])];
      // Si la edición no trae portada, se prueba la de su ISBN (Open Library da 1×1 px cuando no existe).
      if (!candidates.length && r.isbn13) candidates.push(olIsbnCover(r.isbn13));
      r.covers = [];
      for (const url of [...new Set(candidates)].slice(0, 3)) jobs.push(imageLoads(url).then((ok) => { if (ok) r.covers.push(url); }));
    }
    await Promise.all(jobs);
    list.forEach((r) => {
      const order = (u) => (u.includes('/b/id/') ? 0 : u.includes('books.google') ? 1 : 2);
      r.covers.sort((a, b) => order(a) - order(b));
      r.cover = r.covers[0] || null;
    });
    return list;
  }

  async function olByIsbn(p) {
    const keys = [p.isbn13, p.isbn10].filter(Boolean);
    const data = await fetchJson(`${OL}/api/books?bibkeys=${keys.map((k) => `ISBN:${k}`).join(',')}&jscmd=data&format=json`);
    const out = new Map();
    for (const v of Object.values(data || {})) {
      const r = olDataToResult(v);
      const k = r.olEdition || r.isbn13;
      out.set(k, out.has(k) ? mergeSameEdition(out.get(k), r) : r);
    }
    // Ficha completa de cada edición encontrada: idioma, nombre de edición, formato y obra.
    await Promise.all([...out.entries()].map(async ([k, base]) => {
      if (!base.olEdition) return;
      try {
        const ed = await fetchJson(`${OL}/books/${base.olEdition}.json`, 8000);
        const r = olEditionToResult(ed, base.authors);
        const m = { ...base };
        for (const f of ['language', 'edition', 'physical', 'olWork', 'pages', 'publisher', 'subtitle']) if (!m[f]) m[f] = r[f];
        m.covers = [...new Set([...(base.covers || []), ...(r.covers || [])])];
        out.set(k, m);
      } catch { /* los datos básicos ya son suficientes */ }
    }));
    return [...out.values()].filter((r) => isbnMatches(r, p));
  }
  async function gbByIsbn(p) {
    const d = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${p.isbn13 || p.isbn10}&maxResults=10&printType=books`);
    return (d.items || []).map(gbToResult).filter((r) => isbnMatches(r, p));
  }
  async function lookupBothByIsbn(p) {
    const [ol, gb] = await Promise.allSettled([olByIsbn(p), gbByIsbn(p)]);
    if (ol.status === 'rejected' && gb.status === 'rejected') {
      throw Object.assign(new Error('sources'), { userMessage: `Open Library y Google Books no responden ahora mismo (${explainError(ol.reason)}). Reintenta o completa los datos a mano.` });
    }
    return groupByIsbn([...(ol.value || []), ...(gb.value || [])]);
  }

  /** Alta por ISBN (escrito o escaneado). Nunca bloquea el alta manual. */
  async function lookupIsbn(raw) {
    const p = parseIsbn(raw);
    if (!p.valid) {
      if (S.page !== 'add') showPage('add');
      showFormError(p.reason, '#fIsbn13');
      toast(p.reason);
      return;
    }
    if (S.page !== 'add') showPage('add');
    $('#fIsbn13').value = p.isbn13 || '';
    $('#fIsbn10').value = p.isbn10 || '';
    $('#formError').textContent = '';
    const res = await Loader.run({ gif: GIF.search, messages: MSG.isbn }, async () => verifyCovers(await lookupBothByIsbn(p)));
    if (!res.ok) return;
    const list = res.value;
    if (!list.length) {
      const r = await dialog({
        title: 'No hemos encontrado este ISBN',
        message: `Ni Open Library ni Google Books tienen una edición con el ISBN ${p.isbn13 || p.isbn10}. Puedes buscarlo por título y autor o completar los datos a mano (el ISBN ya está escrito).`,
        buttons: [{ label: 'Completar a mano', value: 'manual' }, { label: 'Buscar por título', value: 'title', kind: 'primary' }]
      });
      if (r.value === 'title') openTitleSearch('add');
      else $('#fTitle').focus();
      return;
    }
    S.searchCtx.purpose = 'add';
    if (list.length === 1) {
      fillForm(list[0]);
      toast(`Datos completados desde ${list[0].source}. Revísalos antes de guardar.`);
    } else {
      showEditions(list, { title: 'Hay varias ediciones con este ISBN', hint: 'Elige la que tienes en la mano.', exact: p });
    }
  }

  /* ---------- Búsqueda por título y autor ---------- */
  function openTitleSearch(purpose, person = null) {
    S.searchCtx = { purpose, person, results: [], stack: [] };
    $('#searchModalTitle').textContent = purpose === 'wish' ? `Nuevo destino de papel para ${person}` : 'Buscar por título y autor';
    $('#searchModalHint').textContent = 'Buscamos en Open Library y, si hace falta, en Google Books.';
    $('#tsTitle').value = purpose === 'add' ? $('#fTitle').value.trim() : '';
    $('#tsAuthor').value = purpose === 'add' ? (authorsField.get()[0] || '') : '';
    $('#tsError').textContent = '';
    openModal($('#searchModal'));
    setTimeout(() => $('#tsTitle').focus(), 80);
  }

  async function searchByTitle(title, author) {
    const olUrl = new URL(`${OL}/search.json`);
    olUrl.searchParams.set('title', title);
    if (author) olUrl.searchParams.set('author', author);
    olUrl.searchParams.set('limit', '12');
    olUrl.searchParams.set('lang', 'es');
    olUrl.searchParams.set('fields', 'key,title,subtitle,author_name,first_publish_year,cover_i,edition_count,subject,editions,editions.key,editions.title,editions.subtitle,editions.isbn,editions.publisher,editions.publish_date,editions.cover_i,editions.language,editions.number_of_pages_median');
    const gq = `intitle:"${title.replace(/"/g, '')}"${author ? ` inauthor:"${author.replace(/"/g, '')}"` : ''}`;
    const [ol, gb] = await Promise.allSettled([
      fetchJson(olUrl.toString()),
      fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(gq)}&maxResults=20&printType=books`)
    ]);
    if (ol.status === 'rejected' && gb.status === 'rejected') {
      throw Object.assign(new Error('sources'), { userMessage: `Open Library y Google Books no responden ahora mismo (${explainError(ol.reason)}).` });
    }
    const olResults = (ol.value?.docs || []).map((doc) => {
      const ed = doc.editions?.docs?.[0];
      const r = finalize({
        source: 'Open Library', title: ed?.title || doc.title, subtitle: ed?.subtitle || doc.subtitle, authors: doc.author_name || [],
        publisher: ed?.publisher?.[0] || null, published_date: ed?.publish_date?.[0] || null,
        pages: ed?.number_of_pages_median || null, genres: doc.subject || [], language: languageName(ed?.language?.[0]),
        isbns: ed?.isbn || [], cover: ed?.cover_i ? olCover(ed.cover_i) : null,
        olWork: doc.key ? String(doc.key).split('/').pop() : null, olEdition: ed?.key ? String(ed.key).split('/').pop() : null
      });
      r.editionCount = doc.edition_count || 0;
      if (!ed) { r.workOnly = true; r.firstYear = doc.first_publish_year || null; r.year = null; }
      return r;
    });
    const gbResults = (gb.value?.items || []).map(gbToResult);
    return groupByIsbn([...olResults, ...gbResults]);
  }

  async function runTitleSearch(e) {
    e?.preventDefault();
    const title = $('#tsTitle').value.trim();
    const author = $('#tsAuthor').value.trim();
    if (!title) { $('#tsError').textContent = 'El título es obligatorio.'; $('#tsTitle').focus(); return; }
    $('#tsError').textContent = '';
    closeModal($('#searchModal'));
    const res = await Loader.run({ gif: GIF.search, messages: MSG.search }, async () => verifyCovers(await searchByTitle(title, author)));
    if (!res.ok) { openModal($('#searchModal')); $('#tsError').textContent = res.error ? explainError(res.error) : ''; return; }
    if (!res.value.length) {
      openModal($('#searchModal'));
      $('#tsError').textContent = 'No se encontraron coincidencias. Prueba con menos palabras, revisa el autor o complétalo a mano.';
      return;
    }
    showEditions(res.value, { title: 'Elige la edición correcta', hint: 'Comprueba el ISBN, la editorial y el año: cada edición es distinta.' });
  }

  /* ---------- Lista de ediciones ---------- */
  function resultHtml(r, i, exact) {
    const tags = [
      `<span class="ri-tag src">${esc(r.source)}</span>`,
      r.isbn13 || r.isbn10 ? `<span class="ri-tag">ISBN ${esc(r.isbn13 || r.isbn10)}</span>` : '<span class="ri-tag">Sin ISBN</span>',
      exact && isbnMatches(r, exact) ? '<span class="ri-tag exact">✓ Coincide con el ISBN</span>' : '',
      r.edition ? `<span class="ri-tag">${esc(r.edition)}</span>` : '',
      r.physical ? `<span class="ri-tag">${esc(r.physical)}</span>` : '',
      r.language ? `<span class="ri-tag">${esc(r.language)}</span>` : '',
      r.pages ? `<span class="ri-tag">${esc(r.pages)} págs.</span>` : ''
    ].join('');
    const year = r.year || (r.firstYear ? `1.ª publicación ${r.firstYear}` : 'Año desconocido');
    return `<div class="result-item" role="group" aria-label="${esc(r.title)}">
      ${thumbHtml(r.cover, r.title)}
      <div class="ri-body">
        <b>${esc(r.title)}${r.subtitle ? `: <small>${esc(r.subtitle)}</small>` : ''}</b>
        <span class="ri-line">${esc(r.authors.join(', ') || 'Autor desconocido')}</span>
        <span class="ri-line">${esc(r.publisher || 'Editorial desconocida')} · ${esc(year)}</span>
        <div class="ri-tags">${tags}</div>
        <div class="ri-actions">
          ${r.workOnly ? '' : `<button type="button" class="primary" data-pick="${i}">Elegir esta edición</button>`}
          ${r.olWork && (r.editionCount > 1 || r.workOnly) ? `<button type="button" data-editions="${i}">Ver ediciones${r.editionCount ? ` (${r.editionCount})` : ''}</button>` : ''}
        </div>
      </div>
    </div>`;
  }
  function showEditions(list, { title, hint, exact = null, back = false } = {}) {
    S.searchCtx.results = list;
    S.searchCtx.exact = exact;
    $('#editionTitle').textContent = title || 'Elige la edición correcta';
    $('#editionHint').textContent = hint || '';
    $('#editionBack').hidden = !back;
    $('#editionResults').innerHTML = list.map((r, i) => resultHtml(r, i, exact)).join('');
    $('#editionManual').textContent = { wish: 'No está: buscar con otras palabras', day: 'No está: apuntarlo solo con el título' }[S.searchCtx.purpose] || 'No está: lo completo a mano';
    openModal($('#editionModal'));
    $('#editionModal .edition-box').scrollTop = 0;
  }

  async function showWorkEditions(r) {
    const res = await Loader.run({ gif: GIF.search, messages: MSG.search }, async () => {
      const d = await fetchJson(`${OL}/works/${r.olWork}/editions.json?limit=60`);
      const list = (d.entries || []).map((e) => olEditionToResult(e, r.authors)).filter((x) => x.title);
      const score = (x) => (x.language === 'Español' ? 0 : 2) + (x.isbn13 ? 0 : 1);
      list.sort((a, b) => score(a) - score(b) || (b.year || 0) - (a.year || 0));
      return verifyCovers(list, 30);
    });
    if (!res.ok) return;
    if (!res.value.length) { toast('Open Library no tiene ediciones concretas de esta obra.'); return; }
    S.searchCtx.stack.push({ results: S.searchCtx.results, title: $('#editionTitle').textContent, hint: $('#editionHint').textContent });
    showEditions(res.value, { title: `Ediciones de «${r.title}»`, hint: 'Primero las ediciones en español y con ISBN.', back: true });
  }

  /** Al elegir una edición se completan los huecos solo con fuentes del mismo ISBN. */
  async function chooseResult(r) {
    closeModal($('#editionModal'));
    let full = r;
    if (r.isbn13 || r.isbn10) {
      const res = await Loader.run({ gif: GIF.search, messages: [MSG.search[2], MSG.search[1]] , retry: false }, async () => {
        try {
          const same = await lookupBothByIsbn({ isbn13: r.isbn13, isbn10: r.isbn10 });
          let m = r;
          for (const x of same) m = mergeSameEdition(m, x);
          return (await verifyCovers([m]))[0];
        } catch { return r; }
      });
      if (res.ok && res.value) full = res.value;
    }
    if (S.searchCtx.purpose === 'wish') await saveWish(full, S.searchCtx.person);
    else if (S.searchCtx.purpose === 'day') await useOutsideBookForDay(full);
    else {
      fillForm(full);
      toast('Formulario completado. Puedes corregir cualquier dato.');
    }
  }

  function bindSearch() {
    $('#titleSearchForm').addEventListener('submit', runTitleSearch);
    $('#searchModalClose').addEventListener('click', () => closeModal($('#searchModal')));
    $('#editionClose').addEventListener('click', () => closeModal($('#editionModal')));
    $('#editionResults').addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]');
      const eds = e.target.closest('[data-editions]');
      if (pick) chooseResult(S.searchCtx.results[+pick.dataset.pick]);
      else if (eds) showWorkEditions(S.searchCtx.results[+eds.dataset.editions]);
    });
    $('#editionBackBtn').addEventListener('click', () => {
      const prev = S.searchCtx.stack.pop();
      if (prev) showEditions(prev.results, { title: prev.title, hint: prev.hint, exact: S.searchCtx.exact, back: S.searchCtx.stack.length > 0 });
    });
    $('#editionManual').addEventListener('click', () => {
      closeModal($('#editionModal'));
      if (S.searchCtx.purpose === 'wish') openTitleSearch('wish', S.searchCtx.person);
      else if (S.searchCtx.purpose === 'day') useOutsideBookForDay({ title: $('#dayExtTitle').value.trim(), authors: normalizeAuthors([$('#dayExtAuthor').value]), genres: [] });
      else { showPage('add'); $('#fTitle').focus(); }
    });
  }

  /* =================================================================
     10. ESCÁNER DE CÓDIGO DE BARRAS (mismo sistema que la discoteca)
     ================================================================= */
  const scan = { controls: null, busy: false, last: '', hits: 0 };

  function stopScanner() {
    try { scan.controls?.stop(); } catch { /* ya detenido */ }
    scan.controls = null;
    const v = $('#scanVideo');
    if (v?.srcObject) { v.srcObject.getTracks().forEach((t) => t.stop()); v.srcObject = null; }
  }
  function cameraErrorText(e) {
    const n = e?.name || '';
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'El permiso de la cámara está denegado. Actívalo en los ajustes del navegador o usa «Hacer foto».';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No se ha encontrado una cámara compatible. Usa «Hacer foto» o «Elegir foto».';
    if (n === 'NotReadableError') return 'La cámara está ocupada por otra aplicación. Ciérrala y vuelve a intentarlo.';
    return `${e?.message || 'No se pudo abrir la cámara'}. Puedes usar «Hacer foto» o «Elegir foto».`;
  }
  function onCodeDetected(code) {
    const p = parseIsbn(code);
    if (!p.valid) { $('#scanStatus').textContent = `${code}: ${p.reason}`; scan.busy = false; return false; }
    navigator.vibrate?.(120);
    $('#scanStatus').textContent = `ISBN detectado: ${p.isbn13 || p.isbn10}`;
    stopScanner();
    closeModal($('#scanModal'));
    lookupIsbn(p.isbn13 || p.isbn10);
    return true;
  }

  async function openScanner() {
    if (S.form.mode !== 'edit' && S.page === 'add' && !$('#fTitle').value.trim()) resetForm();
    scan.busy = false; scan.last = ''; scan.hits = 0;
    openModal($('#scanModal'));
    const status = $('#scanStatus');
    status.textContent = 'Solicitando la cámara…';
    try {
      if (!window.isSecureContext) throw Object.assign(new Error('La cámara en directo necesita https'), { name: 'SecurityError' });
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no ofrece cámara en directo');
      if (!window.ZXingBrowser) { status.textContent = 'Preparando el lector de códigos…'; await loadLib('zxing'); }
      if (!window.ZXingBrowser) throw new Error('No se pudo cargar el lector de códigos (revisa la conexión)');
      if (!$('#scanModal').classList.contains('open')) return;
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      scan.controls = await reader.decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        $('#scanVideo'),
        (result) => {
          if (!result || scan.busy) return;
          const code = cleanIsbn(result.getText());
          if (!code) return;
          if (code === scan.last) scan.hits++; else { scan.last = code; scan.hits = 1; }
          status.textContent = `Leyendo: ${code} (${scan.hits}/2)`;
          if (scan.hits >= 2) { scan.busy = true; onCodeDetected(code); }
        }
      );
      if (!$('#scanModal').classList.contains('open')) { stopScanner(); return; }
      await $('#scanVideo').play().catch(() => {});
      status.textContent = 'Apunta la cámara al código de barras de la contraportada.';
    } catch (e) {
      stopScanner();
      status.textContent = cameraErrorText(e);
    }
  }

  async function decodeImageFile(file) {
    if (!file) return;
    const status = $('#scanStatus');
    status.textContent = 'Leyendo el código de la foto…';
    let url = '';
    try {
      const blob = await compressImage(file, 1600, 4e6, 0.9);
      if ('BarcodeDetector' in window) {
        try {
          const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'code_128'] });
          const bmp = await createImageBitmap(blob);
          const found = await det.detect(bmp);
          bmp.close?.();
          if (found[0]?.rawValue && onCodeDetected(cleanIsbn(found[0].rawValue))) return;
        } catch { /* se prueba con ZXing */ }
      }
      if (!window.ZXingBrowser) await loadLib('zxing');
      if (!window.ZXingBrowser) throw Object.assign(new Error('lector'), { userMessage: 'No se pudo cargar el lector de códigos. Revisa la conexión o escribe el ISBN a mano.' });
      url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const res = await reader.decodeFromImageElement(img);
      if (!onCodeDetected(cleanIsbn(res.getText()))) return;
    } catch (e) {
      status.textContent = e?.userMessage || 'No se ha podido leer el código. Acerca la cámara, evita reflejos y vuelve a intentarlo, o escribe el ISBN a mano.';
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  async function requestFocus(event) {
    const view = $('#scanView');
    const ring = $('#focusRing');
    const rect = view.getBoundingClientRect();
    const x = event?.clientX ?? rect.left + rect.width / 2;
    const y = event?.clientY ?? rect.top + rect.height / 2;
    ring.style.left = `${x - rect.left}px`;
    ring.style.top = `${y - rect.top}px`;
    ring.classList.add('show');
    setTimeout(() => ring.classList.remove('show'), 650);
    const track = $('#scanVideo').srcObject?.getVideoTracks?.()[0];
    const status = $('#scanStatus');
    if (!track) { status.textContent = 'La cámara todavía no está preparada.'; return; }
    try {
      const modes = track.getCapabilities?.().focusMode || [];
      if (modes.includes('single-shot')) await track.applyConstraints({ advanced: [{ focusMode: 'single-shot' }] });
      else if (modes.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'manual' }] }).catch(() => {});
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      } else throw new Error('sin enfoque');
      status.textContent = 'Enfoque solicitado. Mantén el código dentro del rectángulo.';
    } catch {
      status.textContent = 'Este móvil no permite controlar el enfoque desde la web. Usa «Hacer foto».';
    }
  }

  function bindScanner() {
    $('#scanClose').addEventListener('click', () => closeModal($('#scanModal')));
    $('#scanView').addEventListener('click', requestFocus);
    $('#scanFocus').addEventListener('click', () => requestFocus());
    $('#scanPhoto').addEventListener('change', (e) => { decodeImageFile(e.target.files?.[0]); e.target.value = ''; });
    $('#scanGallery').addEventListener('change', (e) => { decodeImageFile(e.target.files?.[0]); e.target.value = ''; });
    document.addEventListener('visibilitychange', () => { if (document.hidden && scan.controls) { stopScanner(); $('#scanStatus').textContent = 'Cámara en pausa. Cierra y vuelve a abrir el escáner.'; } });
  }

  /* =================================================================
     11. ¿QUÉ LEEMOS HOY?
     ================================================================= */
  function genreIndex() {
    const idx = new Map();
    for (const b of homeBooks()) {
      for (const g of b.genres) {
        const k = genreKey(g);
        if (!k) continue;
        const cur = idx.get(k) || { key: k, label: g, count: 0 };
        cur.count++;
        idx.set(k, cur);
      }
    }
    return [...idx.values()].sort((a, b) => collator.compare(a.label, b.label));
  }

  function fillSelect(sel, values, placeholder) {
    const el = $(sel);
    const current = el.value;
    el.innerHTML = `<option value="">${esc(placeholder)}</option>${values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}`;
    if (values.includes(current)) el.value = current;
  }

  /** Los 10 géneros más repetidos; el resto se agrupa en «Otros». */
  const OTHER_GENRES = '__otros__';
  function genreGroups() {
    const byCount = genreIndex().sort((a, b) => b.count - a.count || collator.compare(a.label, b.label));
    return { top: byCount.slice(0, 10), rest: byCount.slice(10) };
  }
  function renderRecommendGenres() {
    const { top, rest } = genreGroups();
    const valid = new Set(top.map((g) => g.key));
    if (rest.length) valid.add(OTHER_GENRES);
    [...S.recommend.genres].forEach((k) => { if (!valid.has(k)) S.recommend.genres.delete(k); });
    const chip = (key, label, count, title = '') => `<button type="button" class="recommend-genre${S.recommend.genres.has(key) ? ' active' : ''}" data-genre="${esc(key)}" aria-pressed="${S.recommend.genres.has(key)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}<small>${count}</small></button>`;
    $('#recommendGenres').innerHTML = top.length
      ? top.map((g) => chip(g.key, g.label, g.count)).join('') + (rest.length ? chip(OTHER_GENRES, 'Otros', rest.reduce((a, g) => a + g.count, 0), rest.map((g) => g.label).join(', ')) : '')
      : '<p class="empty-note">Todavía no hay géneros guardados. Aparecerán aquí al sumar libros con género.</p>';
  }
  function selectedGenreKeys() {
    const keys = new Set(S.recommend.genres);
    if (keys.delete(OTHER_GENRES)) genreGroups().rest.forEach((g) => keys.add(g.key));
    return keys;
  }

  function resetRecommend() {
    S.recommend.genres.clear();
    $('#recommendOwner').value = '';
    $('#recommendLocation').value = '';
    $('#recommendError').textContent = '';
  }

  const bookHasGenre = (b, keys) => b.genres.some((g) => keys.has(genreKey(g)));

  async function recommendCandidates(owner, location) {
    try {
      assertDb();
      const rows = await q(S.db.from(T.books).select('*').contains('owners', [owner]).eq('location', location));
      return rows.map((r) => prepBook({ ...r })).filter(inHome);
    } catch (e) {
      console.warn('Recomendación con la copia local', e);
      return homeBooks().filter((b) => b.owners.includes(owner) && b.location === location);
    }
  }

  async function runRecommendation(again = false) {
    const owner = $('#recommendOwner').value;
    const location = $('#recommendLocation').value;
    if (!S.recommend.genres.size || !owner || !location) {
      $('#recommendError').textContent = 'Selecciona al menos un género, una persona y una ubicación.';
      return;
    }
    $('#recommendError').textContent = '';
    closeRecommendResult();
    const res = await Loader.run({ gif: GIF.random, messages: MSG.random, retry: false }, async () => {
      const started = Date.now();
      let list = S.recommend.list;
      if (!again || !list.length) {
        const keys = selectedGenreKeys();
        list = (await recommendCandidates(owner, location)).filter((b) => bookHasGenre(b, keys));
        S.recommend.list = list;
      }
      await sleep(Math.max(0, (again ? 1300 : 2200) - (Date.now() - started)));
      if (!list.length) return null;
      const pool = list.length > 1 ? list.filter((b) => idOf(b.id) !== S.recommend.lastId) : list;
      return pool[Math.floor(Math.random() * pool.length)];
    });
    if (!res.ok) return;
    if (!res.value) {
      $('#recommendError').textContent = 'No hay libros que cumplan los tres requisitos. Prueba con otros géneros, otra persona u otra ubicación.';
      return;
    }
    S.recommend.lastId = idOf(res.value.id);
    showRecommendResult(bookById(res.value.id) || res.value);
  }

  function showRecommendResult(b) {
    $('#rrCover').innerHTML = coverHtml(b.cover_url, b.title, true);
    $('#rrTitle').textContent = b.title;
    $('#rrAuthor').textContent = b.authors.join(', ') || 'Autor desconocido';
    $('#rrMeta').innerHTML = [
      b.genres[0] && `<span>🏷️ ${esc(b.genres[0])}</span>`,
      b.physical_format && `<span>📘 ${esc(b.physical_format)}</span>`,
      b.location && `<span>📍 ${esc(b.location)}</span>`
    ].filter(Boolean).join('');
    $('#rrAgain').hidden = S.recommend.list.length < 2;
    $('#recommendResult').classList.add('open');
    document.body.classList.add('locked');
  }
  function closeRecommendResult() {
    $('#recommendResult').classList.remove('open');
    unlockIfIdle();
  }

  function bindRecommend() {
    fillSelect('#recommendOwner', FAMILY, 'Elige una persona');
    fillSelect('#recommendLocation', LOCATIONS, 'Elige una ubicación');
    $('#recommendGenres').addEventListener('click', (e) => {
      const b = e.target.closest('[data-genre]');
      if (!b) return;
      const k = b.dataset.genre;
      if (S.recommend.genres.has(k)) S.recommend.genres.delete(k); else S.recommend.genres.add(k);
      b.classList.toggle('active', S.recommend.genres.has(k));
      b.setAttribute('aria-pressed', String(S.recommend.genres.has(k)));
      S.recommend.list = [];
      $('#recommendError').textContent = '';
    });
    ['#recommendOwner', '#recommendLocation'].forEach((s) => $(s).addEventListener('change', () => { S.recommend.list = []; $('#recommendError').textContent = ''; }));
    $('#recommendGo').addEventListener('click', () => runRecommendation(false));
    $('#rrAgain').addEventListener('click', () => runRecommendation(true));
    $('#rrOpen').addEventListener('click', () => { const id = S.recommend.lastId; closeRecommendResult(); openBookDetail(id); });
    $('#recommendClose').addEventListener('click', closeRecommendResult);
    $('#recommendResult').addEventListener('click', (e) => { if (e.target.id === 'recommendResult') closeRecommendResult(); });
  }

  /* =================================================================
     12. DESTINOS DE PAPEL (wishlist familiar)
     ================================================================= */
  const expandedWish = new Set();

  function missingNotice(table) {
    return `<div class="nodata">Esta sección necesita la tabla <b>${esc(table)}</b>. Ejecuta <b>libros/sql/biblioteca_migracion.sql</b> en el SQL Editor de Supabase y recarga la aplicación.</div>`;
  }

  function personCard(person, inner, addLabel, addAttr) {
    return `<section class="person-card" data-person="${esc(person)}">
      <div class="person-card-head">
        <div class="person-name"><i class="person-dot" style="background:${esc(colorOf(person))}"></i><h3>${esc(person)}</h3></div>
        <button type="button" class="add-btn" ${addAttr}="${esc(person)}">＋ ${esc(addLabel)}</button>
      </div>
      <div class="person-list">${inner}</div>
    </section>`;
  }

  function renderWishlist() {
    const grid = $('#wishlistGrid');
    if (S.missing.has(T.wishes)) { grid.innerHTML = missingNotice(T.wishes); return; }
    grid.innerHTML = FAMILY.map((person) => {
      const list = S.wishes.filter((w) => w.person === person).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const visible = expandedWish.has(person) ? list : list.slice(0, 5);
      const items = visible.map((w) => `<div class="item-card">
          ${thumbHtml(w.cover_url, w.title)}
          <button type="button" class="ic-body" data-wish="${esc(w.id)}"><b>${esc(w.title)}</b><span>${esc(arr(w.authors).join(', ') || 'Autor desconocido')}${w.published_year ? ` · ${esc(w.published_year)}` : ''}</span><small>✨ ${esc(person)} · desde el ${esc(fmtDate(w.created_at))}</small></button>
          <div class="ic-actions">
            <button type="button" class="go-cal" data-obtain="${esc(w.id)}" aria-label="Ya lo tenemos: añadir a la biblioteca" title="Ya lo tenemos: añadir a la biblioteca">📥</button>
            <button type="button" class="rm" data-rmwish="${esc(w.id)}" aria-label="Eliminar deseo" title="Eliminar deseo">🗑</button>
          </div>
        </div>`).join('');
      const more = list.length > visible.length ? `<button type="button" class="more-btn" data-morewish="${esc(person)}">Mostrar más (${list.length - visible.length})</button>` : '';
      return personCard(person, (items || '<div class="empty-note">Todavía no hay destinos de papel apuntados.</div>') + more, 'Añadir deseo', 'data-addwish');
    }).join('');
  }

  async function saveWish(r, person) {
    const dup = S.wishes.find((w) => w.person === person && ((r.isbn13 && w.isbn13 === r.isbn13) || (!r.isbn13 && norm(w.title) === norm(r.title) && norm(arr(w.authors)[0]) === norm(r.authors[0]))));
    if (dup) { toast(`Ese libro ya estaba en los destinos de ${person}.`); return; }
    const row = {
      ...newId(), person, title: r.title, subtitle: r.subtitle || null, authors: r.authors || [],
      isbn13: r.isbn13 || null, isbn10: r.isbn10 || null, publisher: r.publisher || null, published_year: r.year || null,
      published_date: r.published_date || null, edition: r.edition || null, pages: r.pages || null, genres: r.genres || [],
      language: r.language || null, cover_url: r.cover || null, openlibrary_work_id: r.olWork || null,
      openlibrary_edition_id: r.olEdition || null, google_books_id: r.googleId || null, source: r.source || null
    };
    const res = await Loader.run({ gif: GIF.save, messages: MSG.wish }, () => db.insert(T.wishes, row));
    if (!res.ok) return;
    upsertLocal(S.wishes, res.value);
    renderWishlist();
    saveCache();
    toast(`Destino de papel añadido para ${person}`);
  }

  function openWish(id) {
    const w = S.wishes.find((x) => idOf(x.id) === idOf(id));
    if (!w) return;
    S.wishDetail = idOf(w.id);
    $('#wmCover').innerHTML = coverHtml(w.cover_url, w.title, true);
    $('#wmPerson').textContent = `✨ Destino de ${w.person}`;
    $('#wmTitle').textContent = w.title;
    $('#wmAuthors').textContent = arr(w.authors).join(', ') || 'Autor desconocido';
    $('#wmMeta').innerHTML = [
      `<span class="wide">🔢 ISBN: <b>${esc(w.isbn13 || w.isbn10 || '—')}</b></span>`,
      `<span>📑 Edición: <b>${esc(w.edition || '—')}</b></span>`,
      `<span>🏢 Editorial: <b>${esc(w.publisher || '—')}</b></span>`,
      `<span>📅 Año: <b>${esc(w.published_year || '—')}</b></span>`,
      `<span>📄 Páginas: <b>${esc(w.pages || '—')}</b></span>`,
      `<span class="wide">🗓️ En la lista desde el <b>${esc(fmtDate(w.created_at))}</b></span>`
    ].join('');
    openModal($('#wishModal'));
  }

  async function removeWish(id) {
    const w = S.wishes.find((x) => idOf(x.id) === idOf(id));
    if (!w) return;
    if (!(await confirmDialog('Eliminar deseo', `¿Quitar «${w.title}» de los destinos de papel de ${w.person}?`, 'Eliminar', 'danger'))) return;
    try {
      await db.remove(T.wishes, w.id);
      removeLocal(S.wishes, w.id);
      closeModal($('#wishModal'));
      renderWishlist();
      saveCache();
      toast('Deseo eliminado');
    } catch (e) { toast(explainError(e), 4000); }
  }

  function obtainWish(id) {
    const w = S.wishes.find((x) => idOf(x.id) === idOf(id));
    if (!w) return;
    closeModal($('#wishModal'));
    startFromWish(w);
  }

  function bindWishlist() {
    $('#wishlistGrid').addEventListener('click', (e) => {
      const t = e.target;
      const add = t.closest('[data-addwish]');
      if (add) return openTitleSearch('wish', add.dataset.addwish);
      const more = t.closest('[data-morewish]');
      if (more) { expandedWish.add(more.dataset.morewish); return renderWishlist(); }
      const ob = t.closest('[data-obtain]');
      if (ob) return obtainWish(ob.dataset.obtain);
      const rm = t.closest('[data-rmwish]');
      if (rm) return removeWish(rm.dataset.rmwish);
      const it = t.closest('[data-wish]');
      if (it) openWish(it.dataset.wish);
    });
    $('#wishModalClose').addEventListener('click', () => closeModal($('#wishModal')));
    $('#wishModal').addEventListener('click', (e) => { if (e.target.id === 'wishModal') closeModal(e.currentTarget); });
    $('#wmRemove').addEventListener('click', () => removeWish(S.wishDetail));
    $('#wmObtain').addEventListener('click', () => obtainWish(S.wishDetail));
  }

  /* =================================================================
     13. CALIFICA TU VIAJE
     ================================================================= */
  function ratingFor(bookId, person) {
    return S.ratings.find((r) => idOf(r.book_id) === idOf(bookId) && r.person === person) || null;
  }
  function loadRatingValue() {
    const r = S.rating.bookId ? ratingFor(S.rating.bookId, S.rating.person) : null;
    S.rating.saved = r ? Number(r.rating) : null;
    S.rating.value = r ? Number(r.rating) : 0;
  }
  function goRate(bookId) {
    closeModal($('#bookModal'));
    S.rating.bookId = idOf(bookId);
    loadRatingValue();
    showPage('ratings');
  }

  const personTabs = (current, attr) => FAMILY.map((p) => `<button type="button" class="person-tab${p === current ? ' active' : ''}" ${attr}="${esc(p)}" aria-pressed="${p === current}"><i style="background:${esc(colorOf(p))}"></i>${esc(p)}</button>`).join('');

  function starButtons(value) {
    let html = '';
    for (let i = 1; i <= 5; i++) html += starInner(value, i, 'button', `type="button" data-star="${i}" aria-label="${i} ${i === 1 ? 'estrella' : 'estrellas'}"`);
    return html;
  }
  function updateStars() {
    const box = $('#ratingStars');
    if (!box) return;
    $$('.star', box).forEach((s) => {
      const i = +s.dataset.star;
      const v = S.rating.value;
      s.classList.toggle('full', v >= i);
      s.classList.toggle('half', v < i && v >= i - 0.5);
      s.classList.toggle('empty', v < i - 0.5);
    });
    $('#ratingValue').textContent = fmtRating(S.rating.value);
    box.setAttribute('aria-valuenow', String(S.rating.value));
    box.setAttribute('aria-valuetext', fmtRating(S.rating.value));
  }

  function renderRatings() {
    const body = $('#ratingsBody');
    if (S.missing.has(T.ratings)) { body.innerHTML = missingNotice(T.ratings); return; }
    const b = S.rating.bookId && bookById(S.rating.bookId);
    if (!b) {
      S.rating.bookId = null;
      body.innerHTML = `<div class="rating-empty"><div class="big-icon" aria-hidden="true">⭐</div><h3>Primero elige un libro</h3><p>Búscalo en la biblioteca, abre su ficha y pulsa la estrella amarilla.</p><button type="button" class="primary-btn" data-rate-pick>📚 Elegir en la biblioteca</button></div>`;
      return;
    }
    body.innerHTML = `
      <div class="rating-book"><div class="detail-cover">${coverHtml(b.cover_url, b.title, true)}</div><div><h3>${esc(b.title)}</h3><p>${esc(b.authors.join(', ') || 'Autor desconocido')}</p></div></div>
      <div class="rating-section"><h4>¿Quién valora este viaje?</h4><div class="person-tabs" role="group" aria-label="Persona que valora">${personTabs(S.rating.person, 'data-rate-person')}</div></div>
      <div class="rating-section rating-stars-wrap">
        <div class="stars big" id="ratingStars" role="group" aria-label="Puntuación de 0 a 5 estrellas. Usa las flechas para medias estrellas">${starButtons(S.rating.value)}</div>
        <div class="rating-value" id="ratingValue" aria-live="polite"></div>
        <p class="rating-help">Toca una estrella: primero entera, después media y después vacía.${S.rating.saved != null ? ` Ahora mismo ${esc(S.rating.person)} tiene guardadas ${esc(fmtRating(S.rating.saved))}.` : ''}</p>
      </div>
      <div class="rating-tools">
        <button type="button" class="zero" data-rate-zero>Sin puntuación (0)</button>
        <button type="button" data-rate-clear>Limpiar</button>
        <button type="button" data-rate-pick>Elegir otro libro</button>
        <button type="button" class="save" data-rate-save>Guardar valoración</button>
      </div>
      <div class="rating-error" id="ratingError" role="alert"></div>
      <div class="rating-section"><h4>Valoraciones de la familia</h4>${ratingsListHtml(b.id)}</div>`;
    updateStars();
  }

  /** Ciclo de cada estrella: entera → media → vacía → entera. Las anteriores ajustan a su posición. */
  function cycleStar(i) {
    const v = S.rating.value;
    if (v === i) S.rating.value = i - 0.5;
    else if (v === i - 0.5) S.rating.value = i - 1;
    else S.rating.value = i;
    updateStars();
  }

  async function saveRating(btn) {
    const b = bookById(S.rating.bookId);
    if (!b) return;
    const value = Math.round(S.rating.value * 2) / 2;
    if (value < 0 || value > 5) { $('#ratingError').textContent = 'La valoración debe estar entre 0 y 5 estrellas.'; return; }
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const row = await db.upsert(T.ratings, { book_id: b.id, person: S.rating.person, rating: value }, 'book_id,person');
      S.ratings = S.ratings.filter((r) => !(idOf(r.book_id) === idOf(b.id) && r.person === S.rating.person));
      S.ratings.push(row);
      toast(`${S.rating.person}: ${fmtRating(value)} para «${b.title}»`);
      S.rating.bookId = null;
      S.rating.value = 0;
      renderRatings();
      saveCache();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = 'Guardar valoración';
      $('#ratingError').textContent = explainError(e);
    }
  }

  function bindRatings() {
    const body = $('#ratingsBody');
    body.addEventListener('click', (e) => {
      const t = e.target;
      const star = t.closest('[data-star]');
      if (star) return cycleStar(+star.dataset.star);
      const person = t.closest('[data-rate-person]');
      if (person) { S.rating.person = person.dataset.ratePerson; loadRatingValue(); return renderRatings(); }
      if (t.closest('[data-rate-zero]')) { S.rating.value = 0; return updateStars(); }
      if (t.closest('[data-rate-clear]')) { S.rating.bookId = null; S.rating.value = 0; return renderRatings(); }
      if (t.closest('[data-rate-pick]')) return showPage('search');
      const save = t.closest('[data-rate-save]');
      if (save) saveRating(save);
    });
    body.addEventListener('keydown', (e) => {
      if (!e.target.closest('#ratingStars')) return;
      const keys = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 };
      if (e.key in keys) S.rating.value = Math.min(5, Math.max(0, S.rating.value + keys[e.key]));
      else if (e.key === 'Home') S.rating.value = 0;
      else if (e.key === 'End') S.rating.value = 5;
      else return;
      e.preventDefault();
      updateStars();
    });
  }

  /* =================================================================
     14. CICLOS DE LECTURA (reading_journeys + reading_sessions)
     ---------------------------------------------------------------
     · Inicio = fecha de la primera sesión del ciclo.
     · Fin = fecha de la sesión marcada como terminada.
     · Un ciclo terminado no se reabre sin confirmar; una relectura
       crea un ciclo nuevo para no mezclar progresos.
     ================================================================= */
  const bySessionOrder = (a, b) => String(a.read_on).localeCompare(String(b.read_on)) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || (a.page - b.page);

  function journeyInfo(j) {
    const ss = S.sessions.filter((s) => idOf(s.journey_id) === idOf(j.id)).sort(bySessionOrder);
    if (!ss.length) return { id: idOf(j.id), bookId: idOf(j.book_id), person: j.person, empty: true, finished: false, sessions: [] };
    const fin = ss.filter((s) => s.finished).map((s) => s.read_on).sort();
    const last = ss[ss.length - 1];
    return {
      id: idOf(j.id), bookId: idOf(j.book_id), person: j.person, sessions: ss,
      startedOn: ss[0].read_on, finishedOn: fin.length ? fin[fin.length - 1] : null, finished: fin.length > 0,
      lastPage: last.page, lastDate: last.read_on, created_at: j.created_at
    };
  }
  const journeysFor = (person) => S.journeys.filter((j) => j.person === person).map(journeyInfo);
  const journeysForBook = (bookId) => S.journeys.filter((j) => idOf(j.book_id) === idOf(bookId)).map(journeyInfo).filter((j) => !j.empty);
  function openJourneyFor(bookId, person) {
    return S.journeys.filter((j) => j.person === person && idOf(j.book_id) === idOf(bookId)).map(journeyInfo).find((j) => !j.finished) || null;
  }
  function finishedJourneyFor(bookId, person) {
    return S.journeys.filter((j) => j.person === person && idOf(j.book_id) === idOf(bookId)).map(journeyInfo)
      .filter((j) => j.finished).sort((a, b) => String(b.finishedOn).localeCompare(String(a.finishedOn)))[0] || null;
  }
  async function refreshJourney(id) {
    try {
      const row = await db.one(T.journeys, id);
      if (row) upsertLocal(S.journeys, row); else removeLocal(S.journeys, id);
    } catch (e) { console.warn('No se pudo releer el ciclo de lectura', e); }
  }

  /* =================================================================
     15. MI RUTA DE LECTURA (calendario)
     ================================================================= */
  function renderCalendar() {
    $('#calendarPeople').innerHTML = personTabs(S.cal.person, 'data-cal-person');
    const grid = $('#calGrid');
    $('#calTitle').textContent = `${capitalize(MONTHS[S.cal.month])} ${S.cal.year}`;
    if (S.missing.has(T.sessions) || S.missing.has(T.journeys)) { grid.innerHTML = `<div style="grid-column:1/-1">${missingNotice(T.sessions)}</div>`; return; }
    const { year, month, person } = S.cal;
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
    const infos = new Map(journeysFor(person).map((j) => [j.id, j]));
    const byDay = new Map();
    for (const s of S.sessions) {
      if (s.person !== person || !String(s.read_on).startsWith(prefix)) continue;
      const info = infos.get(idOf(s.journey_id));
      const list = byDay.get(s.read_on) || [];
      let entry = list.find((x) => x.journeyId === idOf(s.journey_id));
      if (!entry) { entry = { journeyId: idOf(s.journey_id), bookId: idOf(s.book_id), start: false, end: false }; list.push(entry); }
      if (info && info.startedOn === s.read_on) entry.start = true;
      if (s.finished && info && info.finishedOn === s.read_on) entry.end = true;
      byDay.set(s.read_on, list);
    }
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const today = todayISO();
    let html = '';
    for (let i = 0; i < offset; i++) html += '<div class="cal-day out" aria-hidden="true"></div>';
    for (let d = 1; d <= days; d++) {
      const iso = `${prefix}${String(d).padStart(2, '0')}`;
      const list = byDay.get(iso) || [];
      const shown = list.length > 4 ? list.slice(0, 3) : list;
      const n = list.length > 4 ? 4 : list.length;
      const tiles = shown.map((x) => {
        const b = bookById(x.bookId);
        return `<div class="cal-cover">${coverHtml(b?.cover_url, b?.title || 'Libro')}${x.start ? '<i class="flag start" aria-hidden="true">★</i>' : ''}${x.end ? '<i class="flag end" aria-hidden="true">★</i>' : ''}</div>`;
      }).join('') + (list.length > 4 ? `<div class="cal-more">+${list.length - 3}</div>` : '');
      const label = `${d} de ${MONTHS[month]}${list.length ? `: ${plural(list.length, 'lectura', 'lecturas')}` : ''}`;
      html += `<button type="button" class="cal-day${iso === today ? ' today' : ''}" data-date="${iso}" aria-label="${esc(label)}"><span class="dnum">${d}</span>${n ? `<div class="cal-covers n${n}">${tiles}</div>` : ''}</button>`;
    }
    const total = offset + days;
    for (let i = total; i < Math.ceil(total / 7) * 7; i++) html += '<div class="cal-day out" aria-hidden="true"></div>';
    grid.innerHTML = html;
  }

  function moveMonth(delta) {
    const d = new Date(S.cal.year, S.cal.month + delta, 1);
    S.cal.year = d.getFullYear();
    S.cal.month = d.getMonth();
    renderCalendar();
  }

  /* ---------- Panel del día ---------- */
  function openDay(iso, { bookId = null } = {}) {
    S.cal.day = iso;
    S.cal.ctx = null;
    $('#dayTitle').textContent = fmtLongDate(iso);
    $('#dayPerson').innerHTML = `<i class="person-dot" style="display:inline-block;vertical-align:-2px;background:${esc(colorOf(S.cal.person))}"></i> Ruta de lectura de ${esc(S.cal.person)}`;
    showDayChoose();
    openModal($('#dayModal'));
    if (bookId) selectDayBook(bookId);
  }
  function showDayChoose() {
    $('#dayForm').hidden = true;
    $('#dayChoose').hidden = false;
    $('#dError').textContent = '';
    $('#dayExtError').textContent = '';
    $('#dayExtManual').hidden = true;
    renderDayRecords();
    renderInProgress();
  }

  function renderDayRecords() {
    const list = S.sessions.filter((s) => s.person === S.cal.person && s.read_on === S.cal.day).sort(bySessionOrder);
    const infos = new Map(journeysFor(S.cal.person).map((j) => [j.id, j]));
    $('#dayRecords').innerHTML = list.length ? `<h3 style="margin:6px 0 2px;font-size:16px">Lecturas de este día</h3>${list.map((s) => {
      const b = bookById(s.book_id);
      const info = infos.get(idOf(s.journey_id));
      const start = info?.startedOn === s.read_on;
      const end = s.finished && info?.finishedOn === s.read_on;
      return `<div class="day-record">${thumbHtml(b?.cover_url, b?.title)}<div><b>${esc(b?.title || 'Libro eliminado')}</b><span>Página ${esc(s.page)}${b?.pages ? ` de ${esc(b.pages)}` : ''}${s.notes ? ` · ${esc(s.notes)}` : ''}</span><div class="badges">${start ? '<span class="badge start">★ Empieza</span>' : ''}${end ? '<span class="badge end">★ Termina</span>' : ''}</div></div>
        <div class="ic-actions"><button type="button" data-edit-session="${esc(s.id)}" aria-label="Editar lectura" title="Editar">✏️</button><button type="button" class="rm" data-del-session="${esc(s.id)}" aria-label="Eliminar lectura" title="Eliminar">🗑</button></div></div>`;
    }).join('')}` : '';
  }

  function libraryMatches(query, limit = 25) {
    const qn = norm(query);
    const list = qn ? homeBooks().filter((b) => norm(`${b.title} ${b.subtitle || ''} ${b.authors.join(' ')}`).includes(qn) || (cleanIsbn(query).length >= 4 && b._isbn.includes(cleanIsbn(query)))) : [];
    return list.slice(0, limit);
  }
  const libraryItem = (b, attr, extra = '') => `<button type="button" class="result-item" ${attr}="${esc(b.id)}">${thumbHtml(b.cover_url, b.title)}<span class="ri-body"><b>${esc(b.title)}</b><span class="ri-line">${esc(b.authors.join(', ') || 'Autor desconocido')}</span>${extra}</span></button>`;

  function renderInProgress() {
    const list = journeysFor(S.cal.person).filter((j) => !j.finished && !j.empty).sort((a, b) => String(b.lastDate).localeCompare(String(a.lastDate)));
    $('#dayInProgress').innerHTML = list.length
      ? list.map((j) => { const b = bookById(j.bookId); return b ? libraryItem(b, 'data-daybook', `<span class="ri-line">Última página: <b>${esc(j.lastPage)}</b>${b.pages ? ` de ${esc(b.pages)}` : ''} · ${esc(fmtDate(j.lastDate))}</span>`) : ''; }).join('')
      : `<div class="empty-note">${esc(S.cal.person)} no tiene libros en curso.</div>`;
  }

  async function selectDayBook(bookId, { sessionId = null } = {}) {
    const b = bookById(bookId);
    if (!b) return;
    const person = S.cal.person;
    const ctx = { bookId: idOf(b.id), sessionId: sessionId ? idOf(sessionId) : null, journeyId: null, rereading: false, last: null, wasFinished: false };
    if (ctx.sessionId) {
      const s = S.sessions.find((x) => idOf(x.id) === ctx.sessionId);
      if (!s) return;
      ctx.journeyId = idOf(s.journey_id);
      ctx.wasFinished = !!s.finished;
      const others = S.sessions.filter((x) => idOf(x.journey_id) === ctx.journeyId && idOf(x.id) !== ctx.sessionId).sort(bySessionOrder);
      ctx.last = others.filter((x) => x.read_on <= s.read_on).pop() || null;
      $('#dPage').value = s.page;
      $('#dFinished').checked = !!s.finished;
      $('#dFinished').dataset.auto = '';
      $('#dNotes').value = s.notes || '';
    } else {
      const open = openJourneyFor(b.id, person);
      if (open) {
        ctx.journeyId = open.id;
        ctx.last = open.empty ? null : open.sessions[open.sessions.length - 1];
      } else {
        const done = finishedJourneyFor(b.id, person);
        if (done) {
          const ok = await confirmDialog('Este libro ya está terminado', `${person} terminó «${b.title}» el ${fmtDate(done.finishedOn)}. ¿Quieres empezar una relectura? Se guardará como un viaje nuevo, sin mezclar páginas.`, 'Empezar relectura');
          if (!ok) return;
          ctx.rereading = true;
        }
      }
      $('#dPage').value = '';
      $('#dFinished').checked = false;
      $('#dFinished').dataset.auto = '';
      $('#dNotes').value = '';
    }
    S.cal.ctx = ctx;
    $('#dayBook').innerHTML = `${thumbHtml(b.cover_url, b.title)}<div><b>${esc(b.title)}</b><span>${esc(b.authors.join(', ') || 'Autor desconocido')}</span>${ctx.rereading ? '<span class="badge start" style="display:inline-block;margin-top:4px">Relectura</span>' : ''}</div>`;
    $('#dTotal').textContent = b.pages ? `de ${b.pages} páginas` : 'Sin total de páginas';
    $('#dLast').textContent = ctx.last ? `Última página registrada: ${ctx.last.page} (${fmtDate(ctx.last.read_on)})` : (ctx.rereading ? 'Nuevo viaje de lectura' : 'Primera vez en tu ruta');
    $('#dSave').textContent = ctx.sessionId ? 'Guardar cambios' : 'Guardar lectura';
    $('#dError').textContent = '';
    updateDayProgress();
    $('#dayChoose').hidden = true;
    $('#dayForm').hidden = false;
    setTimeout(() => $('#dPage').focus(), 120);
  }

  function updateDayProgress() {
    const b = bookById(S.cal.ctx?.bookId);
    const page = Number($('#dPage').value);
    const pct = b?.pages && page > 0 ? Math.min(100, Math.round((page / b.pages) * 100)) : ($('#dFinished').checked ? 100 : 0);
    $('#dProgress').style.width = `${pct}%`;
    $('#dTotal').textContent = b?.pages ? `de ${b.pages} páginas${pct ? ` · ${pct} %` : ''}` : 'Sin total de páginas';
  }

  async function saveDaySession(e) {
    e.preventDefault();
    const ctx = S.cal.ctx;
    const b = bookById(ctx?.bookId);
    const err = (m) => { $('#dError').textContent = m; };
    if (!b) return err('El libro ya no existe en la biblioteca.');
    const person = S.cal.person;
    const date = S.cal.day;
    const raw = $('#dPage').value.trim();
    if (raw === '') return err('Escribe la página por la que vas.');
    const page = Number(raw);
    if (!Number.isInteger(page)) return err('La página debe ser un número entero.');
    if (page < 0) return err('La página no puede ser negativa.');
    const finished = $('#dFinished').checked;
    const notes = clean($('#dNotes').value);
    if (b.pages && page > b.pages) {
      if (!finished) return err(`El libro tiene ${b.pages} páginas. Si ya lo has terminado, marca «Libro terminado».`);
      if (!(await confirmDialog('La página supera el total', `Has escrito la página ${page}, pero el libro tiene ${b.pages}. ¿Guardarlo igualmente como terminado?`, 'Guardar'))) return;
    }
    if (ctx.last && page < ctx.last.page && !(await confirmDialog('Página menor que la anterior', `La última página registrada fue la ${ctx.last.page}. ¿Guardar igualmente la página ${page}?`, 'Guardar igualmente'))) return;
    if (ctx.journeyId && S.sessions.some((s) => idOf(s.journey_id) === ctx.journeyId && s.read_on === date && s.page === page && !!s.finished === finished && idOf(s.id) !== ctx.sessionId)) {
      return err('Esa misma página ya está registrada para este libro en este día.');
    }
    if (ctx.sessionId && ctx.wasFinished && !finished && !(await confirmDialog('¿Quitar «terminado»?', 'El libro volverá a estar en curso y se borrará su fecha de finalización.', 'Sí, sigue en curso'))) return;
    const btn = $('#dSave');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    setSync('Guardando…', 'saving');
    let createdJourney = null;
    try {
      let journeyId = ctx.rereading ? null : ctx.journeyId;
      if (!journeyId) {
        createdJourney = await db.insert(T.journeys, { ...newId(), book_id: b.id, person, status: 'reading' });
        upsertLocal(S.journeys, createdJourney);
        journeyId = idOf(createdJourney.id);
      }
      let row;
      try {
        row = ctx.sessionId
          ? await db.update(T.sessions, ctx.sessionId, { page, finished, notes })
          : await db.insert(T.sessions, { ...newId(), journey_id: journeyId, book_id: b.id, person, read_on: date, page, finished, notes });
      } catch (inner) {
        if (createdJourney) { try { await db.remove(T.journeys, createdJourney.id); } catch { /* el trigger lo limpia */ } removeLocal(S.journeys, createdJourney.id); }
        throw inner;
      }
      upsertLocal(S.sessions, row);
      await refreshJourney(journeyId);
      // Próximas paradas: si esta persona lo tenía pendiente, se quita (solo para ella).
      let removedPending = 0;
      if (!S.missing.has(T.pending)) {
        try {
          const gone = await q(S.db.from(T.pending).delete().eq('book_id', b.id).eq('person', person).select('id'));
          (gone || []).forEach((p) => removeLocal(S.pending, p.id));
          removedPending = (gone || []).length;
        } catch (pe) { console.warn('No se pudo actualizar Próximas paradas', pe); }
      }
      setSync('Compartido', 'online');
      const justFinished = finished && !(ctx.sessionId && ctx.wasFinished);
      S.cal.ctx = null;
      if (justFinished) {
        // Opcional: se abre Califica tu viaje con el libro y la persona ya puestos.
        closeModal($('#dayModal'));
        refreshViews();
        S.rating.person = person;
        goRate(b.id);
        toast(`¡Libro terminado! 📗 ${removedPending ? 'Quitado de Próximas paradas. ' : ''}Si quieres, valóralo ahora.`, 4200);
        return;
      }
      toast(removedPending ? 'Lectura guardada · quitado de Próximas paradas' : 'Lectura guardada');
      showDayChoose();
      refreshViews();
    } catch (ex) {
      setSync('Error al guardar', 'error');
      err(explainError(ex));
    } finally {
      btn.disabled = false;
      btn.textContent = ctx.sessionId ? 'Guardar cambios' : 'Guardar lectura';
    }
  }

  async function deleteSession(id) {
    const s = S.sessions.find((x) => idOf(x.id) === idOf(id));
    if (!s) return;
    const b = bookById(s.book_id);
    if (!(await confirmDialog('Eliminar lectura', `¿Borrar la página ${s.page} de «${b?.title || 'este libro'}» del ${fmtDate(s.read_on)}? Si era el primer día, el inicio pasará a la siguiente sesión.`, 'Eliminar', 'danger'))) return;
    try {
      await db.remove(T.sessions, s.id);
      removeLocal(S.sessions, s.id);
      await refreshJourney(s.journey_id);
      toast('Lectura eliminada');
      refreshViews();
      renderDayRecords();
      renderInProgress();
    } catch (e) { toast(explainError(e), 4000); }
  }

  /* ---------- Desde la ficha: elegir persona y después día (el resto se atenúa) ---------- */
  const spot = { step: null, bookId: null };
  function setSpotStep(step) {
    spot.step = step;
    $$('.spotlight').forEach((el) => el.classList.remove('spotlight'));
    const on = !!step;
    $('#spotDim').hidden = !on;
    $('#spotHint').hidden = !on;
    document.body.classList.toggle('spot-on', on);
    if (!on) { spot.bookId = null; return; }
    const b = bookById(spot.bookId);
    const title = b ? `«${b.title}»` : 'el libro';
    const target = step === 'person' ? $('#calendarPeople') : $('.calendar-card');
    target.classList.add('spotlight');
    $('#spotText').innerHTML = step === 'person'
      ? `<b>1/2</b> ¿Quién va a leer ${esc(title)}?`
      : `<b>2/2</b> Elige el día en que ${esc(S.cal.person)} empieza ${esc(title)}`;
    target.scrollIntoView({ block: step === 'person' ? 'center' : 'start', behavior: 'smooth' });
  }
  function startCalendarPick(bookId) {
    if (!bookById(bookId)) return;
    closeModal($('#bookModal'));
    const now = new Date();
    S.cal.year = now.getFullYear();
    S.cal.month = now.getMonth();
    showPage('calendar');
    spot.bookId = idOf(bookId);
    setSpotStep('person');
  }

  /* ---------- Libros que no están en casa (biblioteca pública, digitales…) ---------- */
  async function runDayOutsideSearch(e) {
    e?.preventDefault();
    const title = $('#dayExtTitle').value.trim();
    const author = $('#dayExtAuthor').value.trim();
    $('#dayExtManual').hidden = true;
    if (!title) { $('#dayExtError').textContent = 'Escribe al menos el título.'; $('#dayExtTitle').focus(); return; }
    $('#dayExtError').textContent = '';
    S.searchCtx = { purpose: 'day', person: S.cal.person, results: [], stack: [] };
    const res = await Loader.run({ gif: GIF.search, messages: MSG.search }, async () => verifyCovers(await searchByTitle(title, author)));
    if (!res.ok) { $('#dayExtError').textContent = res.error ? explainError(res.error) : ''; $('#dayExtManual').hidden = false; return; }
    if (!res.value.length) {
      $('#dayExtError').textContent = 'No se encontraron coincidencias en Open Library ni Google Books.';
      $('#dayExtManual').hidden = false;
      $('#dayExtManual').textContent = `Apuntar «${title}» sin más datos`;
      return;
    }
    showEditions(res.value, { title: 'Elige el libro que estás leyendo', hint: 'No se añadirá a la biblioteca de casa: solo a tu ruta de lectura.' });
  }

  /** Crea (o reutiliza) un libro fuera de casa y lo abre en el formulario del día. */
  async function useOutsideBookForDay(r) {
    if (!r?.title) { $('#dayExtError').textContent = 'Escribe al menos el título.'; return; }
    closeModal($('#editionModal'));
    let b = (r.isbn13 && S.books.find((x) => x.isbn13 === r.isbn13))
      || S.books.find((x) => !inHome(x) && norm(x.title) === norm(r.title) && norm(x.authors[0] || '') === norm(r.authors?.[0] || ''));
    if (!b) {
      const row = {
        ...newId(), title: r.title, subtitle: r.subtitle || null, authors: normalizeAuthors(r.authors || []),
        isbn13: r.isbn13 || null, isbn10: r.isbn10 || null, publisher: r.publisher || null, published_year: r.year || null,
        published_date: r.published_date || null, edition: r.edition || null, pages: r.pages || null, genres: r.genres || [],
        language: r.language || null, cover_url: r.cover || null, openlibrary_work_id: r.olWork || null,
        openlibrary_edition_id: r.olEdition || null, google_books_id: r.googleId || null,
        owners: [], location: null, physical_format: null, in_collection: false
      };
      const res = await Loader.run({ gif: GIF.save, messages: ['Hermione está apuntando el libro en tu ruta…', 'Guardándolo como lectura de fuera de casa…', 'Colocando cada dato en su lugar…'] }, () => db.insert(T.books, row));
      if (!res.ok) return;
      b = setBookLocal(res.value);
      refreshViews();
    }
    if (!$('#dayModal').classList.contains('open')) openModal($('#dayModal'));
    $('#dayExtTitle').value = '';
    $('#dayExtAuthor').value = '';
    selectDayBook(b.id);
  }

  function openCalendarFor(person, bookId) {
    S.cal.person = person;
    const now = new Date();
    S.cal.year = now.getFullYear();
    S.cal.month = now.getMonth();
    showPage('calendar');
    openDay(todayISO(), { bookId });
  }

  function bindCalendar() {
    $('#calendarPeople').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cal-person]');
      if (!b) return;
      S.cal.person = b.dataset.calPerson;
      renderCalendar();
      if (spot.step === 'person') setSpotStep('day');
    });
    $('#calPrev').addEventListener('click', () => moveMonth(-1));
    $('#calNext').addEventListener('click', () => moveMonth(1));
    $('#calToday').addEventListener('click', () => { const n = new Date(); S.cal.year = n.getFullYear(); S.cal.month = n.getMonth(); renderCalendar(); });
    $('#calGrid').addEventListener('click', (e) => {
      const d = e.target.closest('[data-date]');
      if (!d) return;
      if (spot.step === 'day') { const bookId = spot.bookId; setSpotStep(null); openDay(d.dataset.date, { bookId }); return; }
      openDay(d.dataset.date);
    });
    $('#spotDim').addEventListener('click', () => setSpotStep(null));
    $('#spotCancel').addEventListener('click', () => setSpotStep(null));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && spot.step) setSpotStep(null); });
    $('#dayClose').addEventListener('click', () => closeModal($('#dayModal')));
    $('#dayGoLibrary').addEventListener('click', () => {
      closeModal($('#dayModal'));
      showPage('search');
      toast('Abre el libro y pulsa 📅 en su ficha para apuntarlo en tu ruta.', 4200);
    });
    $('#dayModal').addEventListener('click', (e) => {
      const pick = e.target.closest('[data-daybook]');
      if (pick) return selectDayBook(pick.dataset.daybook);
      const ed = e.target.closest('[data-edit-session]');
      if (ed) { const s = S.sessions.find((x) => idOf(x.id) === ed.dataset.editSession); if (s) selectDayBook(s.book_id, { sessionId: s.id }); return; }
      const del = e.target.closest('[data-del-session]');
      if (del) deleteSession(del.dataset.delSession);
    });
    $('#dBack').addEventListener('click', () => { S.cal.ctx = null; showDayChoose(); });
    // Página = total → se marca «terminado»; marcar «terminado» pone el total de páginas.
    $('#dPage').addEventListener('input', () => {
      const b = bookById(S.cal.ctx?.bookId);
      const fin = $('#dFinished');
      const page = Number($('#dPage').value);
      if (b?.pages && $('#dPage').value !== '') {
        if (page === b.pages && !fin.checked) { fin.checked = true; fin.dataset.auto = '1'; }
        else if (page !== b.pages && fin.checked && fin.dataset.auto === '1') { fin.checked = false; fin.dataset.auto = ''; }
      }
      updateDayProgress();
    });
    $('#dFinished').addEventListener('change', () => {
      const b = bookById(S.cal.ctx?.bookId);
      const fin = $('#dFinished');
      fin.dataset.auto = '';
      if (fin.checked && b?.pages) $('#dPage').value = b.pages;
      updateDayProgress();
    });
    $('#dayExtForm').addEventListener('submit', runDayOutsideSearch);
    $('#dayExtManual').addEventListener('click', () => useOutsideBookForDay({ title: $('#dayExtTitle').value.trim(), authors: normalizeAuthors([$('#dayExtAuthor').value]), genres: [] }));
    $('#dayForm').addEventListener('submit', saveDaySession);
  }

  /* =================================================================
     16. PRÓXIMAS PARADAS
     ================================================================= */
  function renderPending() {
    const grid = $('#pendingGrid');
    if (S.missing.has(T.pending)) { grid.innerHTML = missingNotice(T.pending); return; }
    grid.innerHTML = FAMILY.map((person) => {
      const list = S.pending.filter((p) => p.person === person).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const items = list.map((p) => {
        const b = bookById(p.book_id);
        if (!b) return '';
        return `<div class="item-card">
          ${thumbHtml(b.cover_url, b.title)}
          <button type="button" class="ic-body" data-pend-open="${esc(b.id)}"><b>${esc(b.title)}</b><span>${esc(b.authors.join(', ') || 'Autor desconocido')}</span><small>🔖 ${esc(person)} · añadido el ${esc(fmtDate(p.created_at))}</small></button>
          <div class="ic-actions">
            <button type="button" class="go-cal" data-pend-cal="${esc(p.id)}" aria-label="Empezar a leer: abrir Mi ruta de lectura" title="Empezar a leer">📅</button>
            <button type="button" class="rm" data-pend-rm="${esc(p.id)}" aria-label="Eliminar de Próximas paradas" title="Eliminar">🗑</button>
          </div>
        </div>`;
      }).join('');
      return personCard(person, items || '<div class="empty-note">Sin próximas paradas por ahora.</div>', 'Añadir', 'data-addpend');
    }).join('');
  }

  function openPick(person) {
    S.pick.person = person;
    $('#pickTitle').textContent = `Próxima parada para ${person}`;
    $('#pickHint').textContent = 'Busca por título o autor dentro de la biblioteca familiar.';
    $('#pickQuery').value = '';
    renderPick();
    openModal($('#pickModal'));
    setTimeout(() => $('#pickQuery').focus(), 80);
  }
  function renderPick() {
    const qv = $('#pickQuery').value.trim();
    const list = qv ? libraryMatches(qv, 40) : homeBooks().sort((a, b) => collator.compare(a.title, b.title)).slice(0, 30);
    $('#pickResults').innerHTML = list.length ? list.map((b) => {
      const already = S.pending.some((p) => idOf(p.book_id) === idOf(b.id) && p.person === S.pick.person);
      return libraryItem(b, 'data-pick-book', already ? '<span class="ri-tags"><span class="ri-tag exact">Ya está en su lista</span></span>' : '');
    }).join('') : `<div class="empty-note">${S.books.length ? 'No hay ningún libro de casa con ese título o autor.' : 'La biblioteca todavía está vacía.'}</div>`;
  }
  async function addPending(bookId, person) {
    if (S.pending.some((p) => idOf(p.book_id) === idOf(bookId) && p.person === person)) { toast(`Ya estaba en las próximas paradas de ${person}`); return; }
    try {
      const row = await db.upsert(T.pending, { book_id: bookId, person }, 'book_id,person');
      upsertLocal(S.pending, row);
      closeModal($('#pickModal'));
      renderPending();
      saveCache();
      const reading = openJourneyFor(bookId, person);
      toast(reading && !reading.empty ? `Añadido. Ojo: ${person} ya lo está leyendo.` : `Añadido a las próximas paradas de ${person}`);
    } catch (e) { toast(explainError(e), 4000); }
  }
  async function removePending(id) {
    const p = S.pending.find((x) => idOf(x.id) === idOf(id));
    if (!p) return;
    const b = bookById(p.book_id);
    if (!(await confirmDialog('Quitar de Próximas paradas', `¿Quitar «${b?.title || 'este libro'}» de la lista de ${p.person}?`, 'Quitar', 'danger'))) return;
    try {
      await db.remove(T.pending, p.id);
      removeLocal(S.pending, p.id);
      renderPending();
      saveCache();
      toast('Quitado de Próximas paradas');
    } catch (e) { toast(explainError(e), 4000); }
  }

  function bindPending() {
    $('#pendingGrid').addEventListener('click', (e) => {
      const t = e.target;
      const add = t.closest('[data-addpend]');
      if (add) return openPick(add.dataset.addpend);
      const cal = t.closest('[data-pend-cal]');
      if (cal) { const p = S.pending.find((x) => idOf(x.id) === cal.dataset.pendCal); if (p) openCalendarFor(p.person, p.book_id); return; }
      const rm = t.closest('[data-pend-rm]');
      if (rm) return removePending(rm.dataset.pendRm);
      const open = t.closest('[data-pend-open]');
      if (open) openBookDetail(open.dataset.pendOpen);
    });
    $('#pickClose').addEventListener('click', () => closeModal($('#pickModal')));
    $('#pickQuery').addEventListener('input', renderPick);
    $('#pickResults').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick-book]');
      if (b) addPending(b.dataset.pickBook, S.pick.person);
    });
  }

  /* =================================================================
     17. EL RINCÓN DE LOS NÚMEROS
     ================================================================= */
  function donut(parts, total, label) {
    let off = 0;
    const r = 52;
    const c = 2 * Math.PI * r;
    const segs = parts.map((p) => {
      const f = total ? p.value / total : 0;
      const d = f * c;
      const rot = -90 + off * 360;
      off += f;
      return `<circle class="seg" cx="70" cy="70" r="${r}" stroke="${p.color}" stroke-dasharray="${d} ${c - d}" transform="rotate(${rot} 70 70)"/>`;
    }).join('');
    return `<svg class="donut" viewBox="0 0 140 140" role="img" aria-label="${esc(`${total} ${label}`)}"><circle class="bg" cx="70" cy="70" r="${r}"/>${segs}<text class="dt" x="70" y="68" text-anchor="middle">${total}</text><text class="dl" x="70" y="82" text-anchor="middle">${esc(label)}</text></svg>`;
  }
  function legend(parts, total, clickable = false) {
    const top = parts[0]?.value || 0;
    return `<div class="legend">${parts.map((p) => {
      const isBtn = clickable && !p.other;
      const tag = isBtn ? 'button' : 'div';
      const pct = total ? `${(p.value / total * 100).toFixed(1).replace('.', ',')} %` : '0 %';
      return `<${tag} class="leg${isBtn && p.value === top ? ' winner' : ''}"${isBtn ? ` type="button" data-author="${esc(p.name)}" aria-label="Buscar libros de ${esc(p.name)}"` : ''}><i class="lc" style="background:${p.color}"></i><span class="ln">${esc(p.name)}</span><span class="lv">${p.value} · ${pct}</span></${tag}>`;
    }).join('')}</div>`;
  }

  /** Lecturas terminadas por año y mes. Usa la demostración solo si no hay ninguna lectura real. */
  function finishedData(person) {
    const anyReal = S.sessions.some((s) => s.finished) || S.journeys.some((j) => j.status === 'finished');
    const data = {};
    for (const j of journeysFor(person)) {
      if (!j.finishedOn) continue;
      const d = parseISODate(j.finishedOn);
      const y = d.getFullYear();
      (data[y] ||= Array(12).fill(0))[d.getMonth()]++;
    }
    if (!anyReal && SHOW_DEMO_STATS && DEMO_FINISHED_BY_MONTH[person]) {
      const demo = {};
      Object.entries(DEMO_FINISHED_BY_MONTH[person]).forEach(([y, m]) => { demo[y] = [...m]; });
      return { data: demo, demo: true };
    }
    return { data, demo: false };
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);

  function renderStats() {
    $('#statsPeople').innerHTML = personTabs(S.stats.person, 'data-stats-person');
    const person = S.stats.person;
    const owned = S.books.filter((b) => b.owners.includes(person));
    const body = $('#statsBody');

    // A. Formatos
    const fmtParts = [...FORMATS, 'Sin formato'].map((name) => ({
      name, color: FORMAT_COLORS[name],
      value: owned.filter((b) => (name === 'Sin formato' ? !FORMATS.includes(b.physical_format) : b.physical_format === name)).length
    })).filter((p) => p.value).sort((a, b) => b.value - a.value || collator.compare(a.name, b.name));

    // B. Top 7 autores/as (cada autor cuenta por separado)
    const counts = new Map();
    owned.forEach((b) => b.authors.forEach((a) => {
      const k = norm(a);
      const cur = counts.get(k) || { name: a, value: 0 };
      cur.value++;
      counts.set(k, cur);
    }));
    const allAuthors = [...counts.values()].sort((a, b) => b.value - a.value || collator.compare(a.name, b.name));
    const considered = sum(allAuthors.map((a) => a.value));
    const top = allAuthors.slice(0, 7).map((a, i) => ({ ...a, color: AUTHOR_COLORS[i] }));
    const rest = considered - sum(top.map((a) => a.value));
    if (rest) top.push({ name: 'Otros', value: rest, color: AUTHOR_COLORS[7], other: true });

    const collection = owned.length
      ? `<div class="stats-two">
          <div><h3>Formatos</h3><div class="chart-layout">${donut(fmtParts, owned.length, owned.length === 1 ? 'libro' : 'libros')}${legend(fmtParts, owned.length)}</div></div>
          <div><h3>Top 7 autores/as</h3><div class="chart-layout">${donut(top, considered || 1, 'autorías')}${legend(top, considered || 1, true)}</div></div>
        </div>`
      : '<div class="nodata">Todavía no hay libros de esta persona en la biblioteca.</div>';

    // C y D. Lecturas terminadas por año y por mes
    const reading = finishedData(person);
    const readYM = yearMonthHtml(reading.data, 'read', {
      demo: reading.demo,
      emptyYear: `<div class="nodata">Cuando ${esc(person)} marque un libro como terminado en Mi ruta de lectura, aparecerá aquí.</div>`,
      emptyMonth: '<div class="nodata">Sin lecturas terminadas todavía.</div>'
    });

    // E. Últimas adquisiciones (según created_at, que nunca cambia al editar)
    const latest = [...owned].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 3);
    const acqHtml = latest.length
      ? `<div class="acq-list">${latest.map((b) => `<button type="button" class="acq-item" data-acq="${esc(b.id)}">${thumbHtml(b.cover_url, b.title)}<span><b>${esc(b.title)}</b><small>${esc(b.authors.join(', ') || 'Autor desconocido')}</small><em>${esc(b.owners.join(' y '))} · ${esc(fmtDate(b.created_at))}</em></span></button>`).join('')}</div>`
      : '<div class="nodata">Las nuevas altas aparecerán aquí automáticamente.</div>';

    // F y G. Libros comprados (añadidos a la biblioteca) por año y por mes
    const buyYM = yearMonthHtml(purchasesData(owned), 'buy', {
      emptyYear: '<div class="nodata">Los libros que se sumen a la biblioteca aparecerán aquí por año.</div>',
      emptyMonth: '<div class="nodata">Sin libros sumados todavía.</div>'
    });

    // H. Valoraciones de la persona, de 5 a 0 estrellas
    const buckets = ratingBuckets(person);
    const rateHtml = `<div class="rate-buckets">${buckets.map((r) => `<button type="button" class="rate-bucket" data-rbucket="${r.value}" ${r.books.length ? '' : 'disabled'} aria-label="${esc(fmtRating(r.value))}: ${plural(r.books.length, 'libro', 'libros')}">${starsHtml(r.value)}<b>${r.books.length}</b></button>`).join('')}</div>`;

    body.innerHTML = `
      <article class="stats-card"><h3>La biblioteca de ${pickChip(person)} <small>${plural(owned.length, 'libro', 'libros')}</small></h3>${collection}</article>
      <article class="stats-card"><h3>Libros leídos por año</h3>${readYM.year}</article>
      <article class="stats-card"><h3>Libros terminados por mes <small>${S.stats.year != null ? `en ${S.stats.year}` : 'todos los años'}</small></h3>${readYM.month}</article>
      <article class="stats-card"><h3>Últimas adquisiciones</h3>${acqHtml}</article>
      <article class="stats-card"><h3>Libros comprados por año</h3>${buyYM.year}</article>
      <article class="stats-card"><h3>Libros comprados por mes <small>${S.stats.buyYear != null ? `en ${S.stats.buyYear}` : 'todos los años'}</small></h3>${buyYM.month}</article>
      <article class="stats-card"><h3>Valoraciones de ${esc(person)} <small>${plural(sum(buckets.map((r) => r.books.length)), 'libro valorado', 'libros valorados')}</small></h3>${rateHtml}</article>`;
  }

  const YEAR_STATE = { read: 'year', buy: 'buyYear' };

  /** Barras por año (4 más recientes + «Otros») y meses ordenados de mayor a menor. */
  function yearMonthHtml(data, kind, { demo = false, emptyYear, emptyMonth }) {
    const key = YEAR_STATE[kind];
    const years = Object.keys(data).map(Number).sort((a, b) => a - b);
    if (S.stats[key] != null && !years.includes(S.stats[key])) S.stats[key] = null;
    const sel = S.stats[key];
    if (!years.length) return { year: emptyYear, month: emptyMonth };
    const recent = years.slice(-4);
    const older = years.slice(0, -4);
    const bars = [];
    if (older.length) bars.push({ label: 'Otros', value: sum(older.map((y) => sum(data[y]))), others: true, active: older.includes(sel) });
    recent.forEach((y) => bars.push({ label: String(y), value: sum(data[y]), year: y, active: sel === y }));
    const maxBar = Math.max(1, ...bars.map((b) => b.value));
    const year = `${demo ? '<span class="demo-note">Datos de demostración · desaparecen con la primera lectura real</span>' : ''}
      <div class="year-bars${sel != null ? ' has-active' : ''}">${bars.map((b) => `<button type="button" class="year-bar${b.others ? ' others' : ''}${b.active ? ' active' : ''}" data-kind="${kind}" ${b.others ? 'data-others' : `data-year="${b.year}"`} aria-pressed="${b.active}" aria-label="${esc(b.label)}: ${b.value} libros"><span class="yb-val">${b.value}</span><span class="yb-col" style="height:${Math.max(4, Math.round((b.value / maxBar) * 140))}px"></span><span class="yb-label">${esc(b.label)}</span></button>`).join('')}</div>
      ${sel != null ? `<div class="year-filter-note"><span>Meses de ${sel}</span><button type="button" data-clear-year data-kind="${kind}">Quitar selección · ver total</button></div>` : ''}`;
    const months = Array(12).fill(0);
    (sel != null ? [sel] : years).forEach((y) => data[y].forEach((v, i) => { months[i] += v; }));
    const maxMonth = Math.max(1, ...months);
    const rows = months.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
    const month = `<div class="month-bars">${rows.map(({ v, i }) => `<div class="month-row${v ? '' : ' zero'}"><span class="mr-name">${MONTHS[i]}</span><span class="mr-track"><span class="mr-fill" style="display:block;width:${(v / maxMonth) * 100}%"></span></span><span class="mr-val">${v}</span></div>`).join('')}</div>`;
    return { year, month };
  }

  function purchasesData(owned) {
    const data = {};
    owned.forEach((b) => {
      const d = new Date(b.created_at);
      if (Number.isNaN(d.getTime())) return;
      (data[d.getFullYear()] ||= Array(12).fill(0))[d.getMonth()]++;
    });
    return data;
  }

  const RATING_STEPS = [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];
  function ratingBuckets(person) {
    return RATING_STEPS.map((value) => ({
      value,
      books: S.ratings.filter((r) => r.person === person && Number(r.rating) === value).map((r) => bookById(r.book_id)).filter(Boolean)
        .sort((a, b) => collator.compare(a.title, b.title))
    }));
  }
  function openRatingList(value) {
    const person = S.stats.person;
    const list = ratingBuckets(person).find((r) => r.value === value)?.books || [];
    $('#listTitle').textContent = `${person} · ${fmtRating(value)}`;
    $('#listResults').innerHTML = list.length
      ? list.map((b) => libraryItem(b, 'data-list-book', `<span class="ri-line">${starsHtml(value)}</span>`)).join('')
      : '<div class="empty-note">No hay libros con esta puntuación.</div>';
    openModal($('#listModal'));
  }

  function yearsDataFor(kind) {
    if (kind === 'buy') return purchasesData(S.books.filter((b) => b.owners.includes(S.stats.person)));
    return finishedData(S.stats.person).data;
  }
  function openOtherYears(kind) {
    const data = yearsDataFor(kind);
    const key = YEAR_STATE[kind];
    const years = Object.keys(data).map(Number).sort((a, b) => b - a).slice(4);
    $('#yearsModal').dataset.kind = kind;
    $('#yearsList').innerHTML = years.map((y) => `<button type="button" data-pick-year="${y}"${S.stats[key] === y ? ' class="active"' : ''}>${y}<small>${plural(sum(data[y]), 'libro', 'libros')}</small></button>`).join('');
    openModal($('#yearsModal'));
  }

  function bindStats() {
    $('#statsPeople').addEventListener('click', (e) => {
      const b = e.target.closest('[data-stats-person]');
      if (b) { S.stats.person = b.dataset.statsPerson; S.stats.year = null; S.stats.buyYear = null; renderStats(); }
    });
    $('#statsBody').addEventListener('click', (e) => {
      const t = e.target;
      const author = t.closest('[data-author]');
      if (author) return searchFor(author.dataset.author);
      const y = t.closest('[data-year]');
      if (y) { const key = YEAR_STATE[y.dataset.kind]; const v = +y.dataset.year; S.stats[key] = S.stats[key] === v ? null : v; return renderStats(); }
      const others = t.closest('[data-others]');
      if (others) return openOtherYears(others.dataset.kind);
      const clr = t.closest('[data-clear-year]');
      if (clr) { S.stats[YEAR_STATE[clr.dataset.kind]] = null; return renderStats(); }
      const bucket = t.closest('[data-rbucket]');
      if (bucket) return openRatingList(Number(bucket.dataset.rbucket));
      const acq = t.closest('[data-acq]');
      if (acq) openBookDetail(acq.dataset.acq);
    });
    $('#yearsClose').addEventListener('click', () => closeModal($('#yearsModal')));
    $('#yearsList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick-year]');
      if (!b) return;
      S.stats[YEAR_STATE[$('#yearsModal').dataset.kind || 'read']] = +b.dataset.pickYear;
      closeModal($('#yearsModal'));
      renderStats();
    });
    $('#listClose').addEventListener('click', () => closeModal($('#listModal')));
    $('#listResults').addEventListener('click', (e) => {
      const b = e.target.closest('[data-list-book]');
      if (b) { closeModal($('#listModal')); openBookDetail(b.dataset.listBook); }
    });
  }

  /* =================================================================
     18. CARGA, SINCRONIZACIÓN EN TIEMPO REAL Y ARRANQUE
     ================================================================= */
  const LIST_OF = { [T.wishes]: 'wishes', [T.ratings]: 'ratings', [T.journeys]: 'journeys', [T.sessions]: 'sessions', [T.pending]: 'pending' };

  async function loadAll() {
    const books = await db.all(T.books);
    const optional = [T.wishes, T.ratings, T.journeys, T.sessions, T.pending];
    const results = await Promise.allSettled(optional.map((t) => db.all(t)));
    S.books = books.map(prepBook);
    S.idIsUuid = books.every((b) => isUuid(b.id));
    sortBooks();
    rebuildIndex();
    results.forEach((r, i) => {
      const t = optional[i];
      if (r.status === 'fulfilled') { S.missing.delete(t); S[LIST_OF[t]] = r.value; }
      else if (isMissingTable(r.reason)) { S.missing.add(t); S[LIST_OF[t]] = []; }
      else { console.warn(`No se pudo leer ${t}`, r.reason); }
    });
    S.lastSync = Date.now();
    writeCache();
  }

  function applyRemote(table, payload) {
    const key = LIST_OF[table];
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id;
      if (id == null) return;
      if (table === T.books) removeBookLocal(id); else removeLocal(S[key], id);
    } else if (payload.new) {
      if (table === T.books) setBookLocal(payload.new); else upsertLocal(S[key], payload.new);
    }
    refreshViews();
  }

  let channel = null;
  function subscribeRealtime() {
    if (channel || !S.db?.channel) return;
    try {
      channel = S.db.channel('biblioteca-hogar-familia');
      Object.values(T).forEach((table) => {
        if (!S.missing.has(table)) channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => applyRemote(table, p));
      });
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') setSync('Compartido', 'online');
      });
    } catch (e) { console.warn('Tiempo real no disponible; se sincroniza al volver a la aplicación', e); }
  }

  async function silentRefresh() {
    if (!S.db || !navigator.onLine) return;
    try {
      await withTimeout(loadAll(), 20000);
      S.ready = true;
      setSync('Compartido', 'online');
      subscribeRealtime();
      refreshViews();
    } catch (e) { console.warn('Sincronización silenciosa fallida', e); }
  }

  function publicKeyProblem(key) {
    if (!key) return 'Falta la publishable key en libros/supabase-config.js.';
    if (/^sb_secret_/i.test(key)) return 'La clave de libros/supabase-config.js es SECRETA. Sustitúyela por la publishable key (sb_publishable_…).';
    if (key.split('.').length === 3) {
      try { if (/service_role/.test(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))) return 'La clave de libros/supabase-config.js es service_role. Usa solo la clave pública.'; } catch { /* no es JWT */ }
    }
    return '';
  }

  async function connect() {
    const cfg = window.LIBRERIA_SUPABASE || {};
    const key = cfg.publishableKey || cfg.anonKey;
    const problem = !cfg.url ? 'Falta la Project URL en libros/supabase-config.js.' : publicKeyProblem(key);
    Loader.show({ gif: GIF.boot, messages: ['Abriendo las puertas de la biblioteca…', 'Desempolvando el catálogo familiar…', 'Los libros vuelven volando a sus estantes…'] });
    if (problem) { setSync('Sin configurar', 'error'); await Loader.fail(problem, false); return; }
    await loadLib('supabase');
    if (!window.supabase?.createClient) {
      setSync(S.books.length ? 'Sin conexión · copia local' : 'Sin conexión', 'error');
      if (S.books.length && !navigator.onLine) {
        await Loader.hide();
        toast('Sin conexión: mostrando la última copia guardada. Se sincronizará al volver la red.', 4500);
        refreshViews();
        return;
      }
      const retry = await Loader.fail('No se ha podido cargar la conexión con Supabase. Comprueba la red.', true);
      if (retry) location.reload();
      return;
    }
    S.db = window.supabase.createClient(cfg.url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    await Loader.hide();
    if (!navigator.onLine) {
      // Sin red: se abre con la copia local y se sincroniza al recuperar la conexión.
      setSync(S.books.length ? 'Sin conexión · copia local' : 'Sin conexión', 'error');
      toast(S.books.length ? 'Sin conexión: mostrando la última copia guardada. Los cambios necesitan red.' : 'Sin conexión: la biblioteca se cargará al recuperar la red.', 4500);
      applySearch(true);
      refreshViews();
      return;
    }
    const res = await Loader.run({ gif: GIF.boot, messages: ['Desempolvando el catálogo familiar…', 'Los libros vuelven volando a sus estantes…', 'Comprobando que ningún libro se haya escondido…'] }, loadAll);
    if (!res.ok) {
      setSync(S.books.length ? 'Copia local' : 'Sin conexión', 'error');
      if (S.books.length) toast('Mostrando la última copia guardada en este móvil. Los cambios necesitan conexión.', 4500);
    } else {
      S.ready = true;
      setSync('Compartido', 'online');
      subscribeRealtime();
      // El lector de códigos se prepara en segundo plano, sin retrasar la entrada.
      setTimeout(() => loadLib('zxing'), 2500);
      if (S.missing.size) toast('Faltan tablas en Supabase: ejecuta libros/sql/biblioteca_migracion.sql.', 5000);
    }
    applySearch(true);
    refreshViews();
  }

  function bindShell() {
    $('#open').addEventListener('click', () => setMenu(true));
    $('#close').addEventListener('click', () => setMenu(false));
    drawer.addEventListener('click', (e) => { if (e.target === drawer) setMenu(false); });
    $$('.drawer-nav .navbtn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.page === 'add') resetForm();
      if (b.dataset.page === 'recommend') resetRecommend();
      showPage(b.dataset.page);
    }));
    $('#switchHome').addEventListener('click', () => { setMenu(false); location.href = '../index.html'; });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('#loadingScreen').classList.contains('open')) return;
      if (dialogResolve) { dialogResolve({ value: null, input: '' }); return; }
      if ($('#recommendResult').classList.contains('open')) { closeRecommendResult(); return; }
      const top = openModals[openModals.length - 1];
      if (top) { closeModal(top); return; }
      if (drawer.classList.contains('open')) setMenu(false);
    });
    // Mantiene los paneles dentro de la zona visible cuando se abre el teclado del móvil.
    const vv = window.visualViewport;
    const setVvh = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    setVvh();
    (vv || window).addEventListener('resize', setVvh);
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (el.matches?.('input, textarea, select') && el.closest('.edition-box, .scan-box, .modalbox, .dialog-box')) {
        setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
      }
    });
    window.addEventListener('online', () => {
      setSync('Reconectando…', 'saving');
      if (!S.db) location.reload(); else silentRefresh();
    });
    window.addEventListener('offline', () => setSync('Sin conexión', 'error'));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && S.db && Date.now() - S.lastSync > 60000) silentRefresh();
    });
    window.addEventListener('storage', (e) => { if (e.key === 'ownerColors' || e.key === LIBRARY_COLORS_KEY) { loadOwnerColors(); refreshViews(); } });
    bindColorPalette();
  }

  /* ---------- Paleta para cambiar el color de cada persona (solo en este dispositivo) ---------- */
  function closePalette() {
    const p = $('#colorPalette');
    if (!p.hidden) { p.hidden = true; p.dataset.owner = ''; }
  }
  function openPalette(chip) {
    const p = $('#colorPalette');
    const name = chip.dataset.ownerChip;
    if (!p.hidden && p.dataset.owner === name) { closePalette(); return; }
    p.dataset.owner = name;
    p.innerHTML = `<strong>Color de ${esc(name)}</strong><div class="swatches">${OWNER_PALETTE.map((c) => `<button type="button" class="sw${colorOf(name).toLowerCase() === c ? ' current' : ''}" data-swatch="${c}" style="background:${c}" aria-label="Color ${c}"></button>`).join('')}</div>`;
    p.hidden = false;
    const r = chip.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const below = r.bottom + 8 + h <= window.innerHeight;
    p.style.left = `${left}px`;
    p.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - h - 8)}px`;
    $('[data-swatch]', p)?.focus({ preventScroll: true });
  }
  function bindColorPalette() {
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('.owner-pick');
      if (chip) { openPalette(chip); return; }
      const sw = e.target.closest('[data-swatch]');
      if (sw) {
        const name = $('#colorPalette').dataset.owner;
        saveOwnerColor(name, sw.dataset.swatch);
        $$(`[data-owner-chip="${CSS.escape(name)}"]`).forEach((x) => { x.style.background = sw.dataset.swatch; });
        closePalette();
        refreshViews();
        return;
      }
      if (!e.target.closest('#colorPalette')) closePalette();
    });
    window.addEventListener('scroll', closePalette, { passive: true });
    window.addEventListener('resize', closePalette);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePalette(); });
  }

  function boot() {
    window.__bibliotecaArrancada = true;
    loadOwnerColors();
    bindShell();
    bindExplore();
    bindDetail();
    bindForm();
    bindSearch();
    bindScanner();
    bindRecommend();
    bindWishlist();
    bindRatings();
    bindCalendar();
    bindPending();
    bindStats();
    resetForm();
    if (loadCache()) applySearch();
    else renderTable();
    connect();
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => navigator.serviceWorker.register('../service-worker.js', { scope: '../' })
        .then((reg) => reg.update().catch(() => {}))
        .catch((e) => console.warn('Service worker no registrado', e)));
      // Cuando se activa una versión nueva de Hogar, se ofrece recargar (sin perder lo que se esté escribiendo).
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#updateBar').hidden = false; });
      $('#updateNow').addEventListener('click', () => location.reload());
    }
  }

  boot();
})();
