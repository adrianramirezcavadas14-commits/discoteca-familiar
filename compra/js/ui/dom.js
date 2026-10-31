/* =====================================================================
   Piezas de interfaz comunes: avisos, diálogos con foco controlado,
   modales y la pantalla de carga con GIF (mismo estilo que la biblioteca).
   ===================================================================== */
import { esc } from '../core/text.js';
import { LOADING_ASSETS, LOADING_ALT } from '../config.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Aviso breve ---------- */
let toastTimer;
export function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- Estado de conexión en la cabecera ---------- */
export function setSync(text, state = '') {
  const el = $('#syncStatus');
  el.textContent = text;
  el.className = `sync-status ${state}`;
  el.hidden = !text;
}

/* ---------- Modales con foco controlado ---------- */
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function openModal(el, { onClose } = {}) {
  if (!el.classList.contains('open')) {
    el.classList.add('open');
    stack.push({ el, returnTo: document.activeElement, onClose });
  }
  document.body.classList.add('locked');
  setTimeout(() => {
    const first = el.querySelector('[autofocus]') || el.querySelector(FOCUSABLE);
    first?.focus({ preventScroll: true });
  }, 40);
}
export function closeModal(el) {
  if (!el) return;
  el.classList.remove('open');
  const i = stack.findIndex((s) => s.el === el);
  if (i >= 0) {
    const [entry] = stack.splice(i, 1);
    entry.onClose?.();
    if (entry.returnTo?.isConnected) entry.returnTo.focus({ preventScroll: true });
  }
  if (!stack.length && !$('#loadingScreen').classList.contains('open')) document.body.classList.remove('locked');
}
export const topModal = () => stack[stack.length - 1]?.el || null;

/** Mantiene el tabulador dentro del modal superior. */
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const top = $('#loadingScreen').classList.contains('open') ? $('#loadingScreen') : topModal();
  if (!top) return;
  const items = [...top.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------- Diálogo genérico ---------- */
let dialogResolve = null;
export function dialog({ title, message = '', html = false, buttons = [{ label: 'Aceptar', value: true, kind: 'primary' }], input = null, wide = false }) {
  if (dialogResolve) dialogResolve({ value: null });
  return new Promise((resolve) => {
    const modal = $('#dialogModal');
    modal.querySelector('.dialog-box').classList.toggle('wide', !!wide);
    $('#dlgTitle').textContent = title;
    const msg = $('#dlgMessage');
    if (html) msg.innerHTML = message; else msg.textContent = message;
    const inp = $('#dlgInput');
    inp.hidden = !input;
    inp.value = input?.value || '';
    if (input) {
      inp.type = input.type || 'text';
      inp.placeholder = input.placeholder || '';
      inp.setAttribute('aria-label', input.label || title);
      inp.autocomplete = input.autocomplete || 'off';
    }
    $('#dlgActions').innerHTML = buttons.map((b, i) => `<button type="button" class="${esc(b.kind || '')}" data-i="${i}">${esc(b.label)}</button>`).join('');
    dialogResolve = (r) => { dialogResolve = null; closeModal(modal); resolve(r); };
    $('#dlgActions').onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (b) dialogResolve?.({ value: buttons[+b.dataset.i].value, input: inp.value, root: msg });
    };
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const primary = buttons.find((b) => b.kind === 'primary' || b.kind === 'danger');
        dialogResolve?.({ value: primary ? primary.value : true, input: inp.value, root: msg });
      }
    };
    openModal(modal, { onClose: () => { if (dialogResolve) { const r = dialogResolve; dialogResolve = null; resolve({ value: null }); void r; } } });
    setTimeout(() => (input ? inp : $('#dlgActions button:last-child'))?.focus(), 60);
  });
}
export const cancelDialog = () => { if (dialogResolve) dialogResolve({ value: null }); };
export async function confirmDialog(title, message, okLabel = 'Aceptar', kind = 'primary', html = false) {
  const r = await dialog({ title, message, html, buttons: [{ label: 'Cancelar', value: false }, { label: okLabel, value: true, kind }] });
  return r.value === true;
}

/* ---------- Pantalla de carga ----------
   · GIF configurable en config.js (LOADING_ASSETS)
   · Mensaje, progreso REAL (setProgress) y estado de conexión
   · Si algo falla muestra el error y «Reintentar»: nunca finge haber terminado */
export const Loader = (() => {
  const el = () => $('#loadingScreen');
  let msgTimer = null;
  function setProgress(n, text) {
    const v = Math.max(0, Math.min(100, Math.round(n)));
    $('#loadingProgress').style.width = `${v}%`;
    $('#loadingPercent').textContent = `${v} %`;
    $('#loadingBar').setAttribute('aria-valuenow', String(v));
    if (text) $('#loadingText').textContent = text;
  }
  function setNet(text) {
    const n = $('#loadingNet');
    n.textContent = text || (navigator.onLine ? 'Conectado a Internet' : 'Sin conexión a Internet');
    n.className = `loading-net ${navigator.onLine ? 'on' : 'off'}`;
  }
  function show({ asset = 'saving', title, text = 'No cierres ni recargues la aplicación.', messages = [], progress = 0 }) {
    clearInterval(msgTimer);
    const root = el();
    root.classList.remove('error', 'done');
    $('#loadingActions').hidden = true;
    $('#loadingContinue').hidden = true;
    const img = $('#loadingCharacter');
    const src = LOADING_ASSETS[asset] || LOADING_ASSETS.saving;
    if (img.getAttribute('src') !== src) img.src = src;
    img.alt = LOADING_ALT[asset] || '';
    $('#loadingTitle').textContent = title || messages[0] || 'Un momento…';
    $('#loadingText').textContent = text;
    if (messages.length > 1 && !title) {
      let i = 0;
      msgTimer = setInterval(() => { i = (i + 1) % messages.length; $('#loadingTitle').textContent = messages[i]; }, 2200);
    }
    setProgress(progress);
    setNet();
    root.setAttribute('aria-busy', 'true');
    root.classList.add('open');
    document.body.classList.add('locked');
  }
  async function hide(delay = 160) {
    clearInterval(msgTimer);
    await sleep(delay);
    el().classList.remove('open', 'error', 'done');
    el().setAttribute('aria-busy', 'false');
    if (!topModal()) document.body.classList.remove('locked');
  }
  /** Resultado final visible (éxito). */
  async function done(title, text, ms = 900) {
    clearInterval(msgTimer);
    setProgress(100);
    el().classList.add('done');
    $('#loadingTitle').textContent = title;
    if (text) $('#loadingText').textContent = text;
    await sleep(ms);
    await hide(0);
  }
  /** Error con opción de reintentar. Devuelve true si se pide reintentar. */
  function fail(message, { canRetry = true, closeLabel = 'Cerrar', title = 'No se ha podido completar' } = {}) {
    clearInterval(msgTimer);
    el().classList.add('error');
    el().setAttribute('aria-busy', 'false');
    $('#loadingTitle').textContent = title;
    $('#loadingText').textContent = message;
    setNet();
    $('#loadingActions').hidden = false;
    $('#loadingRetry').hidden = !canRetry;
    $('#loadingClose').textContent = closeLabel;
    return new Promise((resolve) => {
      const finish = (v) => {
        $('#loadingRetry').onclick = null; $('#loadingClose').onclick = null;
        if (!v) hide(0);
        resolve(v);
      };
      $('#loadingRetry').onclick = () => finish(true);
      $('#loadingClose').onclick = () => finish(false);
      setTimeout(() => (canRetry ? $('#loadingRetry') : $('#loadingClose')).focus(), 50);
    });
  }
  /** Botón para seguir usando la aplicación mientras termina un proceso largo. */
  function offerContinue(label, onClick) {
    const b = $('#loadingContinue');
    b.textContent = label;
    b.hidden = false;
    b.onclick = () => { b.hidden = true; onClick(); };
  }
  const isOpen = () => el().classList.contains('open');
  return { show, hide, done, fail, setProgress, setNet, offerContinue, isOpen };
})();

/** Ejecuta una tarea con la pantalla de carga; si falla, ofrece reintentar. */
export async function withLoader(opts, task, explain = (e) => String(e?.message || e)) {
  for (;;) {
    Loader.show(opts);
    try {
      const value = await task((pct, text) => Loader.setProgress(pct, text));
      if (opts.doneTitle) await Loader.done(opts.doneTitle, opts.doneText);
      else await Loader.hide();
      return { ok: true, value };
    } catch (e) {
      console.error(e);
      const retry = await Loader.fail(explain(e), { canRetry: opts.retry !== false });
      if (!retry) return { ok: false, error: e };
    }
  }
}

let imageResolver = () => null;
/** Permite usar las miniaturas guardadas en el dispositivo (sin conexión). */
export const setImageResolver = (fn) => { imageResolver = fn; };

/** Imagen de producto con carga diferida y sustituto si falla. */
export function productImg(p, { size = 'thumb', eager = false, cls = 'pimg', alt } = {}) {
  const raw = size === 'large' ? (p?.image_url || p?.thumbnail_url) : p?.thumbnail_url;
  const url = (size !== 'large' && raw && imageResolver(raw)) || raw;
  const name = alt ?? p?.name ?? 'Producto';
  if (!url) return `<span class="${cls} img-missing" role="img" aria-label="${esc(name)}"><span aria-hidden="true">🛒</span></span>`;
  return `<img class="${cls}" src="${esc(url)}" alt="${esc(name)}" ${eager ? '' : 'loading="lazy"'} decoding="async" referrerpolicy="no-referrer" data-pid="${esc(p?.id || '')}">`;
}
// Si una imagen externa falla, se cambia por el marcador.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img instanceof HTMLImageElement && img.classList.contains('pimg') && !img.dataset.failed) {
    img.dataset.failed = '1';
    const span = document.createElement('span');
    span.className = `${img.className} img-missing`;
    span.setAttribute('role', 'img');
    span.setAttribute('aria-label', img.alt);
    span.innerHTML = '<span aria-hidden="true">🛒</span>';
    img.replaceWith(span);
  }
}, true);
