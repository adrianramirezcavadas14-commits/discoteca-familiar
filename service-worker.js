/* Hogar · service worker único para la discoteca, la biblioteca y la despensa.
   - Solo guarda en caché archivos propios de Hogar (mismo origen) con respuesta correcta.
   - No toca las peticiones a Supabase (ni a sus funciones), Open Library, Google Books, imágenes de Mercadona ni CDN: van siempre a la red.
   - Al cambiar CACHE se eliminan solo las cachés antiguas de Hogar. */
const CACHE = 'hogar-v8b-pendientes-20261031';
const NETWORK_WAIT = 3500; // ms antes de usar la copia guardada si la red va muy lenta
const CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './supabase-config.js',
  './camera-controls.js',
  './scanner-core.js',
  './libros/',
  './libros/index.html',
  './libros/styles.css',
  './libros/app.js',
  './libros/supabase-config.js',
  './libros/organizando-libreria.gif',
  // Nuestra despensa familiar (compra/): lo necesario para abrirla sin cobertura dentro del súper
  './compra/',
  './compra/index.html',
  './compra/styles.css',
  './compra/supabase-config.js',
  './compra/img/icono-despensa.svg',
  './compra/js/app.js',
  './compra/js/config.js',
  './compra/js/core/text.js',
  './compra/js/core/zones.js',
  './compra/js/core/pricing.js',
  './compra/js/core/catalog-view.js',
  './compra/js/core/stats.js',
  './compra/js/core/queue.js',
  './compra/js/core/map-layout.js',
  './compra/js/data/idb.js',
  './compra/js/data/api.js',
  './compra/js/data/store.js',
  './compra/js/ui/dom.js',
  './compra/js/ui/nav.js',
  './compra/js/ui/map.js',
  './compra/js/ui/cards.js',
  './compra/js/ui/sync.js',
  './compra/js/ui/review.js',
  './compra/js/pages/home.js',
  './compra/js/pages/map-page.js',
  './compra/js/pages/prepare.js',
  './compra/js/pages/shop.js',
  './compra/js/pages/tickets.js',
  './compra/js/pages/stats.js',
  './compra/js/pages/changes.js',
  './compra/js/pages/settings.js',
  './compra/coyote.gif'
];
const OWN_CACHE = /^(hogar|discohogar|discoteca)/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(CORE.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && OWN_CACHE.test(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheIfOk(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

function offlineFallback(request) {
  return caches.match(request, { ignoreSearch: true }).then((hit) => {
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const path = new URL(request.url).pathname;
      const inLibrary = path.includes('/libros/');
      const inPantry = path.includes('/compra/');
      return caches.match(inLibrary ? './libros/index.html' : inPantry ? './compra/index.html' : './index.html');
    }
    return Response.error();
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Supabase, APIs de libros, portadas externas y CDN: sin intervenir.
  if (url.origin !== self.location.origin) return;

  // GIF grandes: se guardan la primera vez que se usan y luego se sirven desde caché.
  if (url.pathname.endsWith('.gif')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => cacheIfOk(request, res)))
    );
    return;
  }

  // HTML, CSS y JavaScript: primero la red (para recibir actualizaciones). Si la red no contesta
  // en NETWORK_WAIT ms y hay copia guardada, se usa la copia (la red sigue y actualiza la caché).
  event.respondWith(networkFirst(request));
});

function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => { if (!settled) { settled = true; resolve(response); } };
    const timer = setTimeout(() => {
      caches.match(request).then((hit) => { if (hit) finish(hit); });
    }, NETWORK_WAIT);
    // cache: 'no-cache' obliga a comprobar con GitHub Pages si hay versión nueva (si no, responde 304 y es rápido).
    fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => { clearTimeout(timer); finish(cacheIfOk(request, res)); })
      .catch(() => { clearTimeout(timer); offlineFallback(request).then(finish); });
  });
}
