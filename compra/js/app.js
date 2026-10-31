/* =====================================================================
   HOGAR · NUESTRA DESPENSA FAMILIAR · Arranque, menú y navegación
   ===================================================================== */
import { APP_VERSION, SHOPPERS } from './config.js';
import { api, loadSupabaseLib, configProblem, explainError, isNetworkError } from './data/api.js';
import { S, thumbFor, initDevice, loadLocal, loadRemote, familyKey, setFamilyKey, setMe, processQueue, flushDraft, flushOnExit, onChange, refreshLists, refreshOverrides, refreshFrequency, refreshProducts, recomputeZones, queueInfo } from './data/store.js';
import { $, $$, Loader, dialog, toast, setSync, topModal, closeModal, cancelDialog, setImageResolver } from './ui/dom.js';
import { watchOrientation } from './ui/map.js';
import { esc } from './core/text.js';
import { runEntrySync, renderSyncPill } from './ui/sync.js';
import { go, setNavHooks } from './ui/nav.js';
import { runEntryReviews, refreshNewsBadge } from './ui/review.js';
import * as home from './pages/home.js';
import * as mapPage from './pages/map-page.js';
import * as prepare from './pages/prepare.js';
import * as shop from './pages/shop.js';
import * as tickets from './pages/tickets.js';
import * as stats from './pages/stats.js';
import * as changes from './pages/changes.js';
import * as settings from './pages/settings.js';

const PAGES = { inicio: home, mapa: mapPage, lista: prepare, compra: shop, tickets, numeros: stats, novedades: changes, ajustes: settings };
const route = { page: null, params: [] };

/* ---------- Navegación por #hash (funciona con el botón «atrás») ---------- */
function parseHash() {
  const [page, ...params] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/').filter(Boolean);
  return { page: PAGES[page] ? page : 'inicio', params };
}


async function renderRoute() {
  const next = parseHash();
  if (route.page && route.page !== next.page) {
    try { await PAGES[route.page].leave?.(); } catch (e) { console.warn(e); }
  }
  const changed = route.page !== next.page;
  route.page = next.page;
  route.params = next.params;
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${next.page}`));
  $$('.drawer-nav .navbtn').forEach((b) => { const on = b.dataset.page === next.page; b.classList.toggle('active', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  setMenu(false);
  const el = $(`#page-${next.page}`);
  try { PAGES[next.page].render(el, next.params); } catch (e) { console.error(e); el.innerHTML = `<div class="card"><h2>Algo no ha ido bien</h2><p>${esc(explainError(e))}</p></div>`; }
  if (changed) { window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); }
}
export const currentRoute = () => route;

/** Vuelve a pintar la página visible cuando cambian los datos. */
let rerenderTimer = null;
function rerender(what) {
  if (!route.page) return;
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    const mod = PAGES[route.page];
    if (mod.update) mod.update($(`#page-${route.page}`), route.params, what);
    else mod.render($(`#page-${route.page}`), route.params);
  }, 40);
}

/* ---------- Menú lateral ---------- */
const drawer = () => $('#drawer');
function setMenu(open) {
  drawer().classList.toggle('open', open);
  $('#open').setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => $('#close').focus(), 50);
}

function bindShell() {
  $('#appVersion').textContent = `Versión ${APP_VERSION}`;
  $('#open').addEventListener('click', () => setMenu(true));
  $('#close').addEventListener('click', () => setMenu(false));
  drawer().addEventListener('click', (e) => { if (e.target === drawer()) setMenu(false); if (e.target.closest('.navbtn[href]')) setMenu(false); });
  $('#switchHome').addEventListener('click', async () => {
    setMenu(false);
    await PAGES[route.page]?.leave?.();
    location.href = '../index.html';
  });
  window.addEventListener('hashchange', renderRoute);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (Loader.isOpen()) return;
    if ($('#dialogModal').classList.contains('open')) { cancelDialog(); return; }
    const top = topModal();
    if (top) { closeModal(top); return; }
    if (drawer().classList.contains('open')) setMenu(false);
  });
  // Mantiene los paneles dentro de la zona visible cuando se abre el teclado del móvil.
  const vv = window.visualViewport;
  const setVvh = () => document.documentElement.style.setProperty('--vvh', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
  setVvh();
  (vv || window).addEventListener('resize', setVvh);

  window.addEventListener('online', () => { S.online = true; updateNet(); processQueue(); if (api.ready && !S.remoteLoaded) connect(true); else silentRefresh(); });
  window.addEventListener('offline', () => { S.online = false; updateNet(); });
  // Al salir de la pestaña se guarda todo y se intenta enviar lo pendiente.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { PAGES[route.page]?.hidden?.(); flushOnExit(); }
    else if (api.ready && S.remoteLoaded && Date.now() - lastRefresh > 60000) silentRefresh();
  });
  window.addEventListener('pagehide', () => { PAGES[route.page]?.hidden?.(); flushOnExit(); });

  onChange((what) => {
    if (typeof what === 'object' && what?.type === 'op-failed') {
      dialog({ title: 'Un cambio no se ha podido guardar', message: `${what.message} Puedes revisarlo en Ajustes › Datos de este dispositivo.` });
    }
    if (typeof what === 'object' && what?.type === 'finished') { toast('Compra sincronizada: estadísticas actualizadas.'); }
    if (what === 'queue') updateNet();
    if (what === 'sync') renderSyncPill();
    if (what === 'lists' || what === 'session' || what === 'draft' || what === 'queue') pingSoon(what);
    rerender(what);
  });
  watchOrientation(() => rerender('orientation'));
  $('#syncPill').addEventListener('click', () => go('ajustes'));
}

function updateNet() {
  const q = queueInfo();
  if (!navigator.onLine) setSync(q.pending ? `Sin conexión · ${q.pending} sin enviar` : 'Sin conexión', 'error');
  else if (!S.serverOk) setSync('Sin servidor · copia local', 'error');
  else if (q.failed.length) setSync('Revisa cambios', 'error');
  else if (q.pending) setSync(`Enviando ${q.pending}…`, 'saving');
  else setSync('', '');
}

/* ---------- Avisos entre dispositivos (Realtime broadcast) ---------- */
let channel = null;
let lastRefresh = Date.now();
const pending = new Set();
let pingTimer = null;
function pingSoon(what) {
  if (!channel) return;
  pending.add(typeof what === 'string' ? what : 'lists');
  clearTimeout(pingTimer);
  pingTimer = setTimeout(() => {
    // Solo se avisa cuando lo local ya está en el servidor
    if (queueInfo().pending) { pingSoon('queue'); return; }
    pending.forEach((w) => channel.ping(w === 'draft' || w === 'queue' ? 'lists' : w));
    pending.clear();
  }, 1500);
}
function startRealtime() {
  if (channel || !S.household?.id) return;
  let t = null;
  const todo = new Set();
  channel = api.channel(`despensa-${S.household.id}`, (p) => {
    todo.add(p.what || 'lists');
    clearTimeout(t);
    t = setTimeout(async () => {
      const w = [...todo]; todo.clear();
      try {
        if (w.some((x) => ['lists', 'session'].includes(x))) await refreshLists();
        if (w.includes('zones')) { await refreshOverrides(); }
        if (w.includes('catalog')) { await refreshProducts(); recomputeZones(); rerender('catalog'); }
        if (w.includes('receipts')) rerender('receipts');
      } catch (e) { console.warn('Aviso de otro dispositivo no aplicado', e); }
    }, 600);
  });
}
const broadcast = (what) => channel?.ping(what);

async function silentRefresh() {
  if (!api.ready || !navigator.onLine) return;
  lastRefresh = Date.now();
  try {
    await processQueue();
    await refreshLists();
    await refreshFrequency();
    S.serverOk = true;
    updateNet();
  } catch (e) {
    if (isNetworkError(e)) { S.serverOk = false; updateNet(); }
  }
}

/* ---------- Clave familiar y persona del dispositivo ---------- */
async function askKey(reason = '') {
  const r = await dialog({
    title: 'Clave familiar',
    html: true,
    message: `${reason ? `<p><b>${esc(reason)}</b></p>` : ''}<p>Escribe la clave de la despensa. Solo hace falta una vez en cada dispositivo.</p><p class="muted" style="font-size:13px">La configura un adulto en Supabase (ver <i>compra/docs/INSTALACION.md</i>).</p>`,
    input: { type: 'password', placeholder: 'Clave familiar', label: 'Clave familiar', autocomplete: 'current-password' },
    buttons: [{ label: 'Volver a Hogar', value: 'home' }, { label: 'Entrar', value: true, kind: 'primary' }]
  });
  if (r.value === 'home') { location.href = '../index.html'; return null; }
  const k = String(r.input || '').trim();
  if (k.length < 8) return askKey('La clave tiene al menos 8 caracteres.');
  setFamilyKey(k);
  return k;
}

async function askWho(force = false) {
  if (S.me && !force) return S.me;
  const r = await dialog({
    title: '¿Quién usa este dispositivo?',
    message: 'Sirve para saber quién hizo cada cambio. Se puede cambiar en Ajustes.',
    buttons: [...SHOPPERS.map((s) => ({ label: s.name, value: s.code, kind: S.me === s.code ? 'primary' : '' })), { label: 'Ahora no', value: null }]
  });
  if (r.value) { setMe(r.value); toast(`Hola, ${SHOPPERS.find((s) => s.code === r.value).name}`); }
  return S.me;
}

/* ---------- Conexión ---------- */
let connecting = false;
async function connect(silent = false) {
  if (connecting) return;
  connecting = true;
  const hasLocal = S.products.size > 0;
  try {
    if (!silent) Loader.show({ asset: 'startup', title: 'Abriendo la despensa…', text: 'Conectando con la base de datos familiar', progress: 8 });
    const cfg = window.DESPENSA_SUPABASE || {};
    const problem = configProblem(cfg);
    if (problem) { setSync('Sin configurar', 'error'); await Loader.fail(problem, { canRetry: false, closeLabel: 'Entendido' }); return finishBoot(); }
    if (!(await loadSupabaseLib())) throw Object.assign(new Error('Sin librería'), { code: 'NETWORK' });
    // Sin clave por defecto (como la discoteca y la biblioteca); solo se pide si en Supabase se ha puesto una.
    let key = familyKey();
    api.configure(cfg, key);
    for (;;) {
      try {
        await loadRemote((text, pct) => Loader.setProgress(pct, text));
        break;
      } catch (e) {
        if (e.who && !e.who.ok) {
          await Loader.hide(0);
          const reason = e.who.reason === 'missing_key' ? 'En Supabase se ha activado una clave familiar.' : 'La clave no es correcta.';
          key = await askKey(reason);
          if (!key) return;
          api.configure(cfg, key);
          Loader.show({ asset: 'startup', title: 'Abriendo la despensa…', progress: 10 });
          continue;
        }
        throw e;
      }
    }
    S.serverOk = true;
    lastRefresh = Date.now();
    updateNet();
    startRealtime();
    // Lo que quedó sin enviar en una sesión anterior (pestaña cerrada) se envía ahora.
    if (S.draft.dirty.size) flushDraft().catch(() => {}); else processQueue();
    await runEntrySync();            // comprobación del catálogo en cada entrada (con progreso)
    if (Loader.isOpen()) await Loader.hide();
    await finishBoot();
    if (!S.me) await askWho();
    await runEntryReviews();
  } catch (e) {
    (isNetworkError(e) ? console.warn : console.error)(e);
    S.serverOk = false;
    updateNet();
    if (hasLocal) {
      // Dentro del súper sin cobertura se abre directamente con lo guardado.
      if (Loader.isOpen() && navigator.onLine) {
        const retry = await Loader.fail(`${explainError(e)} Mientras tanto puedes usar lo guardado en este dispositivo.`, { closeLabel: 'Usar datos guardados', title: 'Sin conexión con Supabase' });
        if (retry) { connecting = false; return connect(); }
      }
      toast('Usando los datos guardados en este dispositivo. Se sincronizará al volver la conexión.', 4500);
      await finishBoot();
    } else {
      const retry = await Loader.fail(explainError(e), { closeLabel: 'Volver a Hogar', title: 'No se puede abrir la despensa' });
      if (retry) { connecting = false; return connect(); }
      location.href = '../index.html';
    }
  } finally {
    connecting = false;
  }
}

let booted = false;
async function finishBoot() {
  if (booted) { renderRoute(); return; }
  booted = true;
  if (Loader.isOpen()) await Loader.hide();
  renderRoute();
  refreshNewsBadge();
}

async function boot() {
  window.__despensaArrancada = true;
  setNavHooks({ broadcast, askWho });
  setImageResolver(thumbFor);
  initDevice();
  bindShell();
  try { await loadLocal(); } catch (e) { console.warn('Sin caché local', e); }
  updateNet();
  connect();
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('../service-worker.js', { scope: '../' })
      .then((reg) => reg.update().catch(() => {}))
      .catch((e) => console.warn('Service worker no registrado', e)));
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#updateBar').hidden = false; });
    $('#updateNow').addEventListener('click', () => location.reload());
  }
}

boot();
