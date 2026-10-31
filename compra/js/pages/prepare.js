/* =====================================================================
   «Apunta lo que falta» · Preparar la lista de la compra
   ===================================================================== */
import { S, zonesByRoute, zoneById, productsInZone, unclassifiedProducts, draftQty, setDraftQty, flushDraft, hasUnsavedDraft, productById, zoneIdOf, closeDraft, queueInfo } from '../data/store.js';
import { explainError } from '../data/api.js';
import { renderMap } from '../ui/map.js';
import { prepCard, listRow, openProductDetail, openPanel } from '../ui/cards.js';
import { $, toast, withLoader, confirmDialog } from '../ui/dom.js';
import { go, broadcast } from '../ui/nav.js';
import { circularNeighbors, arrowLabel } from '../core/zones.js';
import { listTotals } from '../core/pricing.js';
import { splitZoneBlocks, filterProducts, sortProducts, subcategoriesOf, pageSlice } from '../core/catalog-view.js';
import { esc, fmtEur, plural, fmtDateTime, debounce } from '../core/text.js';
import { PAGE_SIZE, FREQUENT_LIMIT } from '../config.js';

const NONE = 'sin-zona';
const ui = { zoneId: null, q: '', sub: '', sort: 'alpha', promo: false, page: 1 };

const draftItems = () => [...S.draft.items].map(([product_id, it]) => ({ product_id, quantity: it.quantity }));
function countsByZone() {
  const m = new Map();
  for (const [pid, it] of S.draft.items) {
    const z = zoneIdOf(pid) || NONE;
    m.set(z, (m.get(z) || 0) + (it.quantity > 0 ? 1 : 0));
  }
  return m;
}

function basketBar(zoneOpen) {
  const t = listTotals(draftItems(), S.products);
  const unsaved = hasUnsavedDraft();
  const offline = !navigator.onLine || !S.serverOk;
  const state = offline ? (unsaved ? '📴 Guardado en este dispositivo · se enviará con conexión' : '📴 Sin conexión') : unsaved ? '● Cambios sin enviar' : S.draft.list ? '✓ Guardado' : '';
  return `<div class="basket-bar" role="region" aria-label="Cesta">
    <span class="b-icon" aria-hidden="true">🧺</span>
    <div class="b-main"><span class="b-total" aria-live="polite">${fmtEur(t.total)}</span><span class="b-meta">${plural(t.products, 'producto', 'productos')} · ${plural(t.units, 'ud.', 'uds.')}</span><span class="b-state">${state}</span></div>
    ${zoneOpen ? '<button type="button" class="btn small ghost" data-map aria-label="Ver el mapa">🗺️<span class="bl"> Mapa</span></button>' : ''}
    <button type="button" class="btn small ghost" data-all aria-label="Ver toda la lista">📋<span class="bl"> Ver lista</span></button>
    <button type="button" class="btn small yellow" data-save aria-label="Guardar la lista" ${unsaved ? '' : 'disabled'}>💾<span class="bl"> Guardar</span></button>
  </div>`;
}

export function render(el, params = []) {
  const zid = params[0] || null;
  if (zid !== ui.zoneId) Object.assign(ui, { zoneId: zid, q: '', sub: '', sort: 'alpha', promo: false, page: 1 });
  if (S.pending.list && !S.draft.items.size && !zid) {
    // Hay compra pendiente y ninguna lista nueva: se avisa, pero se puede empezar otra.
  }
  el.innerHTML = `
    <div class="hero"><div><h2 id="h-lista">Apunta lo que falta</h2><p>Elige una zona del mapa y añade lo que hace falta esta semana.</p></div></div>
    ${S.pending.list ? `<div class="offline-banner" style="background:#e3f4ea;color:#0a6b3f">🛒 Ya hay una lista cerrada pendiente de compra. Puedes ir preparando la siguiente, pero no se podrá cerrar hasta terminar esa compra.</div>` : ''}
    <div data-basket></div>
    <div data-body></div>`;
  bind(el);
  paint(el);
}

export function update(el, params, what) {
  if (['draft', 'lists', 'zones', 'freq', 'catalog', 'queue', 'orientation', 'all', 'settings'].includes(typeof what === 'string' ? what : '')) paint(el, { keepFocus: true });
}

function paint(el, { keepFocus = false } = {}) {
  const active = keepFocus ? document.activeElement : null;
  const focusKey = active && (active.dataset.inc ? `[data-inc="${active.dataset.inc}"]` : active.dataset.dec ? `[data-dec="${active.dataset.dec}"]` : null);
  const anchor = active?.closest?.('[data-pid]');
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : null;
  const anchorPid = anchor?.dataset.pid;

  el.querySelector('[data-basket]').innerHTML = basketBar(!!ui.zoneId);
  const body = el.querySelector('[data-body]');
  if (!ui.zoneId) paintMap(body);
  else paintZone(body);

  if (focusKey) {
    const target = el.querySelector(focusKey) || (anchorPid && (el.querySelector(`[data-pid="${CSS.escape(anchorPid)}"] [data-inc]`)));
    if (target) {
      target.focus({ preventScroll: true });
      const now = target.closest('[data-pid]');
      if (now && anchorTop != null) window.scrollBy(0, now.getBoundingClientRect().top - anchorTop);
    }
  }
}

function paintMap(body) {
  const counts = countsByZone();
  const t = listTotals(draftItems(), S.products);
  const none = unclassifiedProducts().length;
  body.innerHTML = `
    <div class="card map-card"><div data-map-host></div></div>
    <div class="row" style="justify-content:space-between;margin-top:12px">
      <span class="muted">Precio estimado actual: <b style="color:var(--ink)">${fmtEur(t.total)}</b>${S.sync.last?.finished_at ? ` · precios del ${esc(fmtDateTime(S.sync.last.finished_at))}` : ''}</span>
    </div>
    <div class="close-list-bar"><button type="button" class="btn primary big-btn" data-close-list ${t.products ? '' : 'disabled'}>✅ Cerrar lista</button></div>`;
  renderMap(body.querySelector('[data-map-host]'), {
    zones: S.zones, counts, activeId: null, countLabel: ['producto en la lista', 'productos en la lista'],
    legend: 'El número rojo indica cuántos productos de la zona hay ya en la lista.',
    extraButtons: none ? [{ id: NONE, label: '❔ Productos sin zona', count: counts.get(NONE) || null }] : [],
    onSelect: (id) => go('lista', id),
    onExtra: (id) => go('lista', id)
  });
}

function zoneProducts() {
  return ui.zoneId === NONE ? unclassifiedProducts() : productsInZone(ui.zoneId);
}

function paintZone(body) {
  const zone = ui.zoneId === NONE ? { id: NONE, route_order: '?', name: 'Productos sin zona', summary: 'Sin clasificar', color: '#8a8f9c' } : zoneById(ui.zoneId);
  if (!zone) { go('lista'); return; }
  const nav = ui.zoneId === NONE ? { prev: zonesByRoute().at(-1), next: zonesByRoute()[0] } : circularNeighbors(S.zones, zone.id);
  const all = zoneProducts();
  // Los productos de la lista que ya no están activos siguen apareciendo en «Ya está en la lista».
  const inListIds = new Set([...S.draft.items.keys()].filter((pid) => (zoneIdOf(pid) || NONE) === zone.id));
  const listedExtra = [...inListIds].map(productById).filter((p) => p && !all.includes(p));
  const inList = new Map([...S.draft.items].map(([pid, it]) => [pid, it.quantity]));
  const blocks = splitZoneBlocks([...all, ...listedExtra], inList, S.freq, { frequentLimit: FREQUENT_LIMIT });
  const moreBase = blocks.more.filter((p) => all.includes(p));
  const filtered = sortProducts(filterProducts(moreBase, { q: ui.q, subcategory: ui.sub || null, promo: ui.promo }), ui.sort);
  const shown = pageSlice(filtered, ui.page, PAGE_SIZE);
  const subs = subcategoriesOf(moreBase);
  const listedTotal = listTotals(blocks.inList.map((p) => ({ product_id: p.id, quantity: inList.get(p.id) })), S.products);

  body.innerHTML = `
    <nav class="zone-nav" aria-label="Cambiar de zona" style="--zc:${esc(zone.color)}">
      <button type="button" class="zn-arrow prev" data-goto="${esc(nav.prev?.id || '')}" aria-label="Zona anterior: ${esc(nav.prev ? `${nav.prev.route_order} ${nav.prev.name}` : '')}">
        <b aria-hidden="true">‹</b><span><strong>${nav.prev ? `${nav.prev.route_order} · ${esc(nav.prev.name)}` : ''}</strong><small>${esc(arrowLabel(nav.prev))}</small></span></button>
      <div class="zn-current"><span class="zn-num">${esc(zone.route_order)}</span><strong>${esc(zone.name)}</strong><button type="button" class="btn small ghost" data-map>🗺️ Mapa</button></div>
      <button type="button" class="zn-arrow next" data-goto="${esc(nav.next?.id || '')}" aria-label="Zona siguiente: ${esc(nav.next ? `${nav.next.route_order} ${nav.next.name}` : '')}">
        <span><strong>${nav.next ? `${nav.next.route_order} · ${esc(nav.next.name)}` : ''}</strong><small>${esc(arrowLabel(nav.next))}</small></span><b aria-hidden="true">›</b></button>
    </nav>

    <section class="block" aria-labelledby="b1">
      <div class="block-head"><h3 id="b1">1. Ya está en la lista</h3><small>${blocks.inList.length ? `${plural(blocks.inList.length, 'producto', 'productos')} · ${fmtEur(listedTotal.total)}` : ''}</small></div>
      ${blocks.inList.length ? `<div class="in-list">${blocks.inList.map((p) => listRow(p, inList.get(p.id))).join('')}</div>` : '<div class="empty-note">Todavía no hay nada de esta zona en la lista.</div>'}
    </section>

    <section class="block" aria-labelledby="b2">
      <div class="block-head"><h3 id="b2">2. Los de siempre</h3><small>Ordenados por el número de listas en las que han aparecido</small></div>
      ${blocks.frequent.length ? `<div class="cards">${blocks.frequent.map((p) => prepCard(p, inList.get(p.id) || 0, S.freq.get(p.id))).join('')}</div>` : '<div class="empty-note">Cuando terminemos compras, aquí aparecerán los productos habituales de esta zona.</div>'}
    </section>

    <section class="block" aria-labelledby="b3">
      <div class="block-head"><h3 id="b3">3. Más productos</h3><small>${plural(filtered.length, 'producto', 'productos')}</small></div>
      <div class="toolbar">
        <input class="input search-input" type="search" data-q value="${esc(ui.q)}" placeholder="🔎 Buscar en esta zona…" aria-label="Buscar en esta zona" autocomplete="off" enterkeyhint="search">
        <select class="input" data-sub aria-label="Filtrar por subcategoría"><option value="">Todas las subcategorías</option>${subs.map((s) => `<option value="${s.id}"${String(s.id) === String(ui.sub) ? ' selected' : ''}>${esc(s.name)} (${s.count})</option>`).join('')}</select>
        <select class="input" data-sort aria-label="Ordenar"><option value="alpha"${ui.sort === 'alpha' ? ' selected' : ''}>Orden alfabético</option><option value="price"${ui.sort === 'price' ? ' selected' : ''}>Precio: de menor a mayor</option><option value="price-desc"${ui.sort === 'price-desc' ? ' selected' : ''}>Precio: de mayor a menor</option><option value="new"${ui.sort === 'new' ? ' selected' : ''}>Novedades primero</option></select>
        <label class="check"><input type="checkbox" data-promo ${ui.promo ? 'checked' : ''}> Solo promociones y bajadas</label>
      </div>
      ${shown.length ? `<div class="cards">${shown.map((p) => prepCard(p, inList.get(p.id) || 0)).join('')}</div>` : `<div class="empty-note">${ui.q || ui.sub || ui.promo ? 'No hay productos con esos filtros.' : 'No hay más productos en esta zona.'}</div>`}
      ${shown.length < filtered.length ? `<button type="button" class="load-more" data-more>Ver más productos (${filtered.length - shown.length} restantes)</button>` : ''}
    </section>`;
}

const bound = new WeakSet();
function bind(el) {
  if (bound.has(el)) return;
  bound.add(el);
  const onSearch = debounce((v) => { ui.q = v; ui.page = 1; paintKeepingInput(el); }, 250);
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) onSearch(e.target.value);
  });
  el.addEventListener('change', (e) => {
    if (e.target.matches('[data-sub]')) { ui.sub = e.target.value; ui.page = 1; paint(el); }
    else if (e.target.matches('[data-sort]')) { ui.sort = e.target.value; ui.page = 1; paint(el); }
    else if (e.target.matches('[data-promo]')) { ui.promo = e.target.checked; ui.page = 1; paint(el); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target;
    const inc = t.closest('[data-inc]');
    if (inc) { setDraftQty(inc.dataset.inc, draftQty(inc.dataset.inc) + 1); return; }
    const dec = t.closest('[data-dec]');
    if (dec) { setDraftQty(dec.dataset.dec, draftQty(dec.dataset.dec) - 1); return; }
    const det = t.closest('[data-detail]');
    if (det) { showDetail(det.dataset.detail); return; }
    const gz = t.closest('[data-goto]');
    if (gz && gz.dataset.goto) { await flushDraft().catch(() => {}); go('lista', gz.dataset.goto); return; }
    if (t.closest('[data-map]')) { await flushDraft().catch(() => {}); go('lista'); return; }
    if (t.closest('[data-more]')) { ui.page++; paint(el); return; }
    if (t.closest('[data-save]')) { await save(); return; }
    if (t.closest('[data-all]')) { showWholeList(); return; }
    if (t.closest('[data-close-list]')) { await closeListFlow(); }
  });
}

function paintKeepingInput(el) {
  const pos = el.querySelector('[data-q]')?.selectionStart;
  paint(el);
  const inp = el.querySelector('[data-q]');
  if (inp) { inp.focus({ preventScroll: true }); try { inp.setSelectionRange(pos, pos); } catch { /* nada */ } }
}

/** «Guardar»: con conexión muestra la pantalla de guardado (carro); sin conexión queda en el dispositivo. */
async function save() {
  if (!navigator.onLine || !S.serverOk) {
    await flushDraft().catch(() => {});
    toast('Guardado en este dispositivo. Se enviará en cuanto haya conexión.');
    return;
  }
  const res = await withLoader({ asset: 'saving', title: 'Guardando la lista…', text: 'Enviando los cambios para toda la familia', doneTitle: 'Lista guardada', doneText: 'Ya la ve toda la familia.' },
    async (progress) => {
      progress(40);
      await flushDraft();
      const q = queueInfo();
      const failed = q.failed.find((o) => o.kind === 'draft');
      if (failed) { const e = new Error(failed.lastError); e.userMessage = failed.lastError; throw e; }
      if (q.pending) { const e = new Error('pendiente'); e.userMessage = 'No se ha podido enviar ahora. Los cambios están guardados en este dispositivo y se enviarán solos.'; throw e; }
    }, explainError);
  if (res.ok) broadcast('lists');
}

function showDetail(pid) {
  const p = productById(pid);
  const qty = draftQty(pid);
  const modal = openProductDetail(p, { extra: `<div class="row" style="margin-top:12px"><span class="muted">En la lista:</span> <span data-detail-qty>${qty ? `<span class="stepper"><button type="button" data-dq="-1" aria-label="Una unidad menos">−</button><output>${qty}</output><button type="button" data-dq="1" aria-label="Una unidad más">+</button></span>` : '<button type="button" class="add-btn" data-dq="1">+ Añadir a la lista</button>'}</span></div>` });
  modal.querySelector('#pmBody').onclick = (e) => {
    const b = e.target.closest('[data-dq]');
    if (!b) return;
    setDraftQty(pid, draftQty(pid) + Number(b.dataset.dq));
    showDetail(pid);
  };
}

/** Toda la lista agrupada por zonas (para revisarla de un vistazo). */
function showWholeList() {
  const byZone = new Map();
  for (const [pid, it] of S.draft.items) {
    const z = zoneIdOf(pid) || NONE;
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z).push({ p: productById(pid), qty: it.quantity });
  }
  const zones = [...zonesByRoute().filter((z) => byZone.has(z.id)), ...(byZone.has(NONE) ? [{ id: NONE, route_order: '?', name: 'Sin zona', color: '#8a8f9c' }] : [])];
  const t = listTotals(draftItems(), S.products);
  const body = openPanel('La lista de esta semana', zones.length ? `
    <p class="muted">${plural(t.products, 'producto', 'productos')} · ${plural(t.units, 'unidad', 'unidades')} · <b>${fmtEur(t.total)}</b> estimados</p>
    ${zones.map((z) => `<h3 style="margin:14px 0 6px;display:flex;gap:8px;align-items:center"><span class="pill" style="background:${esc(z.color)};color:#fff">${esc(z.route_order)}</span>${esc(z.name)}</h3>
      <div class="in-list">${byZone.get(z.id).filter((x) => x.p).map((x) => listRow(x.p, x.qty)).join('')}</div>`).join('')}` : '<div class="empty-note">La lista está vacía.</div>');
  body.onclick = (e) => {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]');
    if (inc) setDraftQty(inc.dataset.inc, draftQty(inc.dataset.inc) + 1);
    else if (dec) setDraftQty(dec.dataset.dec, draftQty(dec.dataset.dec) - 1);
    else return;
    showWholeList();
  };
}

/** Resumen y cierre de la lista (necesita conexión). */
async function closeListFlow() {
  if (S.pending.list) {
    await confirmDialog('Ya hay una compra pendiente', 'No se puede cerrar una lista nueva mientras haya otra cerrada pendiente de compra. Termina primero esa compra.', 'Entendido');
    return;
  }
  const items = draftItems();
  const t = listTotals(items, S.products);
  const zones = new Set(items.map((i) => zoneIdOf(i.product_id) || NONE));
  const unavailable = items.map((i) => productById(i.product_id)).filter((p) => p && p.availability !== 'available');
  const ok = await confirmDialog('¿Cerramos la lista?', `
    <div class="kv">
      <div><small>Productos diferentes</small><b>${t.products}</b></div>
      <div><small>Unidades en total</small><b>${t.units}</b></div>
      <div><small>Zonas</small><b>${zones.size}</b></div>
      <div><small>No disponibles</small><b>${unavailable.length}</b></div>
      <div class="wide"><small>Precio estimado</small><b>${fmtEur(t.total)}</b></div>
      <div class="wide"><small>Precios actualizados</small><b>${S.sync.last?.finished_at ? esc(fmtDateTime(S.sync.last.finished_at)) : 'sin datos'}</b></div>
    </div>
    ${unavailable.length ? `<p>⚠️ ${unavailable.map((p) => esc(p.name)).join(', ')} ${unavailable.length === 1 ? 'no está disponible' : 'no están disponibles'} ahora mismo.</p>` : ''}
    <p>Al cerrarla pasa a «¡A por la compra!» y ya no se podrá editar (salvo reabriéndola antes de empezar).</p>`, 'Cerrar lista', 'primary', true);
  if (!ok) return;
  const res = await withLoader({ asset: 'saving', title: 'Llenando el carro…', text: 'Guardando la lista completa para toda la familia', doneTitle: '¡Lista cerrada!', doneText: 'Ya está lista para ir a comprar.' },
    async (progress) => { progress(30, 'Enviando los últimos cambios…'); const s = await closeDraft(); progress(90, 'Lista guardada'); return s; }, explainError);
  if (res.ok) { broadcast('lists'); go('compra'); }
}

/** Al salir de la sección se envía el borrador. */
export async function leave() {
  await flushDraft().catch(() => {});
}
export function hidden() { /* flushOnExit global */ }

