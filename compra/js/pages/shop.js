/* =====================================================================
   «¡A por la compra!» · Hacer la compra con la lista cerrada
   ===================================================================== */
import { S, zonesByRoute, zoneById, productById, profileName, zoneIdOf, startShopping, setResult, flushResults, finishShopping, cancelShopping, reopenPending, loadCachedThumbs, queueInfo } from '../data/store.js';
import { explainError } from '../data/api.js';
import { renderMap } from '../ui/map.js';
import { openProductDetail, openPanel, closePanel } from '../ui/cards.js';
import { withLoader, confirmDialog, dialog, toast, productImg } from '../ui/dom.js';
import { go, broadcast } from '../ui/nav.js';
import { circularNeighbors, arrowLabel, nextZoneWithPending, firstZoneWithPending } from '../core/zones.js';
import { listTotals, shoppingTotals } from '../core/pricing.js';
import { deviationText } from '../core/stats.js';
import { esc, fmtEur, plural, fmtDateTime, fmtClock, fmtDuration, collator } from '../core/text.js';
import { SHOPPERS } from '../config.js';

const NONE = 'sin-zona';
const ui = { zoneId: null, showMap: false, autoAdvance: true };
let timer = null;

const itemById = () => new Map((S.pending.items || []).map((i) => [i.id, i]));
const zoneOfItem = (it) => it.zone_id_snapshot || zoneIdOf(it.product_id) || NONE;

/** Pendientes por zona durante la compra. */
function pendingByZone() {
  const items = itemById();
  const m = new Map();
  for (const r of S.session.results.values()) {
    if (r.status !== 'pending') continue;
    const z = zoneOfItem(items.get(r.list_item_id) || { product_id: r.product_id });
    m.set(z, (m.get(z) || 0) + 1);
  }
  return m;
}
function zonesWithItems() {
  const items = itemById();
  const set = new Set();
  for (const r of S.session.results.values()) set.add(zoneOfItem(items.get(r.list_item_id) || { product_id: r.product_id }));
  return set;
}

let thumbsLoaded = false;
export function render(el, params = []) {
  stopTimer();
  // Miniaturas guardadas en el dispositivo para usar sin cobertura
  if (!thumbsLoaded && (S.pending.items || []).length) {
    thumbsLoaded = true;
    loadCachedThumbs().then((n) => { if (n && el.classList.contains('active')) update(el, params, 'thumbs'); });
  }
  if (S.session?.session && S.session.session.status !== 'completed') return renderSession(el, params);
  if (S.lastSummary && !S.pending.list) return renderSummary(el);
  if (!S.pending.list) {
    el.innerHTML = `<div class="hero"><div><h2 id="h-compra">¡A por la compra!</h2><p>Aquí aparece la lista cuando se cierra.</p></div></div>
      <div class="card" style="margin-top:18px;text-align:center"><p style="font-size:20px;font-weight:900;margin:8px 0">No hay ninguna compra pendiente.</p>
      <p class="muted">Prepara la lista en «Apunta lo que falta» y ciérrala para empezar.</p><a class="btn primary" href="#lista">Ir a la lista</a></div>`;
    return;
  }
  renderPending(el);
}

export function update(el, params, what) {
  if (S.session?.session && ['session', 'queue', 'thumbs'].includes(what) && el.querySelector('.shop-head')) { paintSession(el); return; }
  render(el, params);
}

/* ---------- Lista cerrada pendiente ---------- */
function renderPending(el) {
  const l = S.pending.list;
  const items = S.pending.items || [];
  const t = listTotals(items, S.products);
  const zones = new Set(items.map(zoneOfItem));
  const otherDevice = l.status === 'shopping' && !S.session;
  el.innerHTML = `
    <div class="hero"><div><h2 id="h-compra">¡A por la compra!</h2><p>La lista está cerrada y lista para el súper.</p></div></div>
    <article class="card" style="margin-top:18px">
      <div class="card-head"><h3>🛒 Compra de la semana</h3><span class="pill">${l.status === 'shopping' ? 'En curso' : 'Pendiente'}</span></div>
      <div class="kv">
        <div><small>Creada</small><b>${esc(fmtDateTime(l.created_at))}</b></div>
        <div><small>Cerrada</small><b>${esc(fmtDateTime(l.closed_at))}</b></div>
        <div><small>Productos</small><b>${t.products}</b></div>
        <div><small>Unidades</small><b>${t.units}</b></div>
        <div><small>Zonas</small><b>${zones.size}</b></div>
        <div><small>Precio estimado</small><b>${fmtEur(l.estimated_total ?? t.total)}</b></div>
      </div>
      ${otherDevice ? '<p class="offline-banner" style="margin-top:12px">📱 Esta compra ya se está haciendo en otro dispositivo.</p>' : ''}
      <div class="row" style="margin-top:14px">
        <button type="button" class="btn ghost" data-summary>Ver resumen</button>
        ${l.status === 'ready_to_shop' ? '<button type="button" class="btn ghost" data-reopen>Reabrir la lista</button>' : ''}
        ${l.status === 'ready_to_shop' ? '<button type="button" class="btn primary big-btn" data-start>▶ Iniciar compra</button>' : ''}
      </div>
    </article>`;
  el.onclick = async (e) => {
    if (e.target.closest('[data-summary]')) showListSummary();
    else if (e.target.closest('[data-reopen]')) reopen();
    else if (e.target.closest('[data-start]')) chooseShopper(el);
  };
}

function showListSummary() {
  const items = [...(S.pending.items || [])];
  const zones = zonesByRoute();
  const byZone = new Map();
  for (const it of items) { const z = zoneOfItem(it); if (!byZone.has(z)) byZone.set(z, []); byZone.get(z).push(it); }
  const ordered = [...zones.filter((z) => byZone.has(z.id)), ...(byZone.has(NONE) ? [{ id: NONE, route_order: '?', name: 'Sin zona', color: '#8a8f9c' }] : [])];
  openPanel('Resumen de la lista', ordered.map((z) => `<h3 style="margin:12px 0 6px;display:flex;gap:8px;align-items:center"><span class="pill" style="background:${esc(z.color)};color:#fff">${esc(z.route_order)}</span>${esc(z.name)}</h3>
    <div class="change-list">${byZone.get(z.id).map((it) => { const p = productById(it.product_id); return `<div class="change">${productImg(p || {})}<div class="ch-main"><b>${esc(p?.name || 'Producto')}</b><small>${it.quantity} ud. · ${esc(p?.format_label || '')}</small></div><div class="ch-side">${fmtEur((it.unit_price_snapshot ?? p?.price ?? 0) * it.quantity)}</div></div>`; }).join('')}</div>`).join(''));
}

async function reopen() {
  if (!(await confirmDialog('Reabrir la lista', 'La lista volverá a «Apunta lo que falta» para poder cambiarla. ¿Seguimos?', 'Reabrir'))) return;
  try { await reopenPending(); broadcast('lists'); toast('Lista reabierta.'); go('lista'); } catch (e) { dialog({ title: 'No se puede reabrir', message: explainError(e) }); }
}

/** Solo Papá, Mamá o Adrián (se guarda su identificador estable). */
async function chooseShopper(el) {
  const body = openPanel('¿Quién va a comprar?', `<p class="muted">El temporizador empieza en cuanto elijas.</p>
    <div class="shopper-pick">${SHOPPERS.map((s) => `<button type="button" data-shopper="${s.code}" style="--pc:${s.color}"><i aria-hidden="true"></i>${esc(s.name)}</button>`).join('')}</div>`);
  body.onclick = async (e) => {
    const b = e.target.closest('[data-shopper]');
    if (!b) return;
    closePanel();
    if (!navigator.onLine) { dialog({ title: 'Hace falta conexión para empezar', message: 'Para que nadie más empiece la misma compra a la vez, el inicio necesita conexión. Una vez empezada, la compra funciona sin cobertura.' }); return; }
    try {
      await startShopping(b.dataset.shopper);
      broadcast('session');
      ui.zoneId = null;
      render(el, []);
    } catch (err) {
      dialog({ title: 'No se ha podido iniciar', message: explainError(err) });
    }
  };
}

/* ---------- Compra en curso ---------- */
function renderSession(el, params) {
  if (S.session.session.device_id && S.session.session.device_id !== S.deviceId) {
    el.innerHTML = `<div class="hero"><div><h2 id="h-compra">¡A por la compra!</h2></div></div>
      <div class="card" style="margin-top:18px"><p style="font-size:18px;font-weight:900">📱 ${esc(profileName(S.session.session.shopper_profile_id))} está haciendo la compra en otro dispositivo.</p>
      <p class="muted">Empezó el ${esc(fmtDateTime(S.session.session.started_at))}. Cuando termine, aquí aparecerá la siguiente lista.</p></div>`;
    return;
  }
  const pend = pendingByZone();
  if (params[0]) ui.zoneId = params[0];
  if (!ui.zoneId || !zonesWithItems().has(ui.zoneId)) {
    const z = firstZoneWithPending(S.zones, pend) || zonesByRoute().find((zz) => zonesWithItems().has(zz.id));
    ui.zoneId = z?.id || (pend.get(NONE) ? NONE : null);
  }
  el.innerHTML = `
    <h2 id="h-compra" class="sr-only">Compra en curso</h2>
    <div class="shop-head" role="region" aria-label="Temporizador y progreso">
      <span class="timer" id="shopTimer" role="timer" aria-live="off">00:00</span>
      <div class="sh-info"><b>${esc(profileName(S.session.session.shopper_profile_id))} está comprando</b><span data-progress-text></span><div class="shop-progress" aria-hidden="true"><i data-progress-bar></i></div></div>
      <button type="button" class="btn small ghost" data-map style="background:#ffffff1c;color:#fff;border-color:#ffffff33">🗺️ Mapa</button>
    </div>
    <div data-body></div>`;
  bindSession(el);
  paintSession(el);
  startTimer();
}

function paintSession(el) {
  const body = el.querySelector('[data-body]');
  if (!body) return;
  const items = itemById();
  const results = [...S.session.results.values()];
  const totals = shoppingTotals(results, (r) => items.get(r.list_item_id)?.unit_price_snapshot ?? productById(r.product_id)?.price);
  const resolved = results.length - totals.count.pending;
  el.querySelector('[data-progress-text]').textContent = `${resolved} de ${results.length} resueltos · ${fmtEur(totals.confirmed)} confirmados${totals.pending ? ` · ${fmtEur(totals.pending)} por confirmar` : ''}${queueInfo().pending ? ' · 📴 pendiente de enviar' : ''}`;
  el.querySelector('[data-progress-bar]').style.width = `${results.length ? Math.round((resolved / results.length) * 100) : 0}%`;

  const pend = pendingByZone();
  const withItems = zonesWithItems();
  const done = new Set([...withItems].filter((z) => !pend.get(z)));
  if (ui.showMap) {
    body.innerHTML = '<div class="card map-card"><div data-map-host></div></div>';
    const zonesShown = S.zones.filter((z) => withItems.has(z.id) || z.active !== false);
    renderMap(body.querySelector('[data-map-host]'), {
      zones: zonesShown, counts: pend, done, activeId: ui.zoneId, countLabel: ['pendiente', 'pendientes'],
      legend: 'Rojo: pendientes · ✓: zona completa',
      extraButtons: withItems.has(NONE) ? [{ id: NONE, label: '❔ Sin zona', count: pend.get(NONE) || null }] : [],
      onSelect: (id) => { ui.zoneId = id; ui.showMap = false; paintSession(el); window.scrollTo(0, 0); },
      onExtra: (id) => { ui.zoneId = id; ui.showMap = false; paintSession(el); }
    });
    return;
  }

  if (totals.done) {
    body.innerHTML = `<div class="all-done" role="status"><h3>🎉 Ya está todo. Puedes ir a caja.</h3>
      <p>${plural(totals.count.collected, 'recogido', 'recogidos')} · ${plural(totals.count.partial, 'parcial', 'parciales')} · ${plural(totals.count.out_of_stock, 'sin existencias', 'sin existencias')}</p>
      <p style="font-size:22px;font-weight:950">${fmtEur(totals.confirmed)} <small class="muted" style="font-size:14px">precio final estimado</small></p>
      <button type="button" class="btn primary big-btn" data-finish>🏁 Finalizar compra</button></div>
      ${zoneSection(el, items, pend, done)}`;
    return;
  }
  body.innerHTML = zoneSection(el, items, pend, done);
}

function zoneSection(el, items, pend, done) {
  const withItems = zonesWithItems();
  const routeZones = zonesByRoute().filter((z) => withItems.has(z.id));
  const zone = ui.zoneId === NONE ? { id: NONE, route_order: '?', name: 'Sin zona', color: '#8a8f9c', summary: '' } : zoneById(ui.zoneId);
  if (!zone) return '<div class="empty-note">No hay productos en la lista.</div>';
  const nav = routeZones.length ? circularNeighbors(routeZones, zone.id, { onlyActive: false }) : { prev: null, next: null };
  const results = [...S.session.results.values()].filter((r) => zoneOfItem(items.get(r.list_item_id) || { product_id: r.product_id }) === zone.id)
    .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || collator.compare(productById(a.product_id)?.name || '', productById(b.product_id)?.name || ''));
  const chips = routeZones.map((z) => `<button type="button" class="pill ${pend.get(z.id) ? 'bad' : 'grey'}" data-zone-chip="${esc(z.id)}" aria-label="Zona ${z.route_order}: ${pend.get(z.id) ? `${pend.get(z.id)} pendientes` : 'completa'}" style="border:0;min-height:36px;cursor:pointer${z.id === zone.id ? ';outline:3px solid var(--ink)' : ''}">${z.route_order} ${pend.get(z.id) ? `· ${pend.get(z.id)}` : '✓'}</button>`).join(' ');
  return `
    <nav class="zone-nav" aria-label="Cambiar de zona" style="--zc:${esc(zone.color)}">
      <button type="button" class="zn-arrow prev" data-goto="${esc(nav.prev?.id || '')}" ${nav.prev ? '' : 'disabled'} aria-label="Zona anterior">
        <b aria-hidden="true">‹</b><span><strong>${nav.prev ? `${nav.prev.route_order} · ${esc(nav.prev.name)}` : ''}</strong><small>${esc(arrowLabel(nav.prev))}${nav.prev && pend.get(nav.prev.id) ? ` · ${pend.get(nav.prev.id)} pend.` : ''}</small></span></button>
      <div class="zn-current"><span class="zn-num">${esc(zone.route_order)}</span><strong>${esc(zone.name)}</strong><span class="pill ${pend.get(zone.id) ? 'warn' : ''}">${pend.get(zone.id) ? plural(pend.get(zone.id), 'pendiente', 'pendientes') : '✓ Completa'}</span></div>
      <button type="button" class="zn-arrow next" data-goto="${esc(nav.next?.id || '')}" ${nav.next ? '' : 'disabled'} aria-label="Zona siguiente">
        <span><strong>${nav.next ? `${nav.next.route_order} · ${esc(nav.next.name)}` : ''}</strong><small>${esc(arrowLabel(nav.next))}${nav.next && pend.get(nav.next.id) ? ` · ${pend.get(nav.next.id)} pend.` : ''}</small></span><b aria-hidden="true">›</b></button>
    </nav>
    <div class="row" style="margin-bottom:10px" aria-label="Zonas de la compra">${chips}</div>
    <div class="collect-grid">${results.map((r) => collectCard(r)).join('')}</div>
    <div class="row end" style="margin-top:18px"><button type="button" class="btn small ghost" data-cancel>Cancelar la compra</button>${done.size === withItems.size ? '' : '<button type="button" class="btn small ghost" data-finish-force>Terminar con pendientes</button>'}</div>`;
}

const STATE_TEXT = { pending: '⏳ Pendiente', collected: '✓ Recogido', partial: '◐ Parcial', out_of_stock: '✗ Sin existencias' };

function collectCard(r) {
  const p = productById(r.product_id) || { id: r.product_id, name: 'Producto' };
  const multi = r.requested_qty > 1;
  const resolved = r.status !== 'pending';
  return `<article class="ccard ${r.status}${resolved ? ' resolved' : ''}" data-item="${esc(r.list_item_id)}">
    <button type="button" class="c-photo" data-enlarge="${esc(r.list_item_id)}" aria-label="Ampliar ${esc(p.name)}">${productImg(p, { eager: true })}<span class="c-qty" aria-label="${r.requested_qty} unidades">×${r.requested_qty}</span></button>
    <span class="sr-only">${esc(p.name)}</span>
    <div class="c-state" role="status">${STATE_TEXT[r.status]}${r.status === 'partial' ? ` (${r.collected_qty}/${r.requested_qty})` : ''}</div>
    ${multi && r.status !== 'out_of_stock' ? `<div class="c-units"><span>Recogidas:</span><span class="stepper"><button type="button" data-units="-1" aria-label="Una menos de ${esc(p.name)}">−</button><output>${r.status === 'pending' ? r.requested_qty : r.collected_qty}</output><button type="button" data-units="1" aria-label="Una más de ${esc(p.name)}" ${r.status === 'collected' ? 'disabled' : ''}>+</button></span></div>` : ''}
    <div class="c-actions">
      <button type="button" class="c-ok" data-ok aria-label="Recogido: ${esc(p.name)}" title="Recogido">✓</button>
      <button type="button" class="c-no" data-no aria-label="No queda: ${esc(p.name)}" title="No queda">✗</button>
    </div>
  </article>`;
}

function bindSession(el) {
  el.onclick = async (e) => {
    const t = e.target;
    const card = t.closest('[data-item]');
    if (t.closest('[data-enlarge]')) { enlarge(t.closest('[data-enlarge]').dataset.enlarge); return; }
    if (card && t.closest('[data-ok]')) { mark(el, card.dataset.item, 'collected'); return; }
    if (card && t.closest('[data-no]')) { mark(el, card.dataset.item, 'out_of_stock'); return; }
    if (card && t.closest('[data-units]')) {
      const r = S.session.results.get(card.dataset.item);
      const cur = r.status === 'pending' ? r.requested_qty : r.collected_qty;
      const next = Math.max(0, Math.min(r.requested_qty, cur + Number(t.closest('[data-units]').dataset.units)));
      mark(el, card.dataset.item, next >= r.requested_qty ? 'collected' : next <= 0 ? 'out_of_stock' : 'partial', next);
      return;
    }
    const g = t.closest('[data-goto]');
    if (g && g.dataset.goto) { ui.zoneId = g.dataset.goto; paintSession(el); flushResults(); window.scrollTo(0, 0); return; }
    const chip = t.closest('[data-zone-chip]');
    if (chip) { ui.zoneId = chip.dataset.zoneChip; paintSession(el); flushResults(); return; }
    if (t.closest('[data-map]')) { ui.showMap = !ui.showMap; paintSession(el); return; }
    if (t.closest('[data-finish]')) { finish(el, false); return; }
    if (t.closest('[data-finish-force]')) { finish(el, true); return; }
    if (t.closest('[data-cancel]')) cancel(el);
  };
}

function mark(el, listItemId, status, qty = 0) {
  const before = pendingByZone().get(ui.zoneId) || 0;
  setResult(listItemId, status, qty);
  const after = pendingByZone().get(ui.zoneId) || 0;
  // Zona completa: se pasa sola a la siguiente con productos pendientes
  if (before > 0 && after === 0 && ui.autoAdvance) {
    const next = nextZoneWithPending(zonesByRoute().filter((z) => zonesWithItems().has(z.id)), ui.zoneId, pendingByZone());
    flushResults();
    if (next) {
      toast(`Zona ${zoneById(ui.zoneId)?.route_order ?? ''} completa. Vamos a la zona ${next.route_order}.`);
      ui.zoneId = next.id;
      paintSession(el);
      window.scrollTo(0, 0);
      return;
    }
  }
  paintSession(el);
}

function enlarge(listItemId) {
  const r = S.session.results.get(listItemId);
  const it = itemById().get(listItemId);
  const p = productById(r.product_id);
  const z = zoneById(zoneOfItem(it || { product_id: r.product_id }));
  openProductDetail(p, {
    requested: r.requested_qty, zoneLine: false,
    extra: `<div class="kv" style="margin-top:8px"><div><small>Zona</small><b>${z ? `${z.route_order} · ${esc(z.name)}` : 'Sin zona'}</b></div><div><small>Estado</small><b>${STATE_TEXT[r.status]}</b></div>${z?.notes ? `<div class="wide"><small>Observaciones</small><b>${esc(z.notes)}</b></div>` : ''}${it?.notes ? `<div class="wide"><small>Nota</small><b>${esc(it.notes)}</b></div>` : ''}</div>`
  });
}

async function finish(el, force) {
  if (force && !(await confirmDialog('Terminar con productos pendientes', 'Los productos que sigan pendientes no contarán como recogidos. ¿Terminamos igualmente?', 'Terminar', 'danger'))) return;
  stopTimer();
  const res = await withLoader({ asset: 'completedPurchase', title: '¡Compra terminada!', text: 'Guardando lo recogido y actualizando las estadísticas…' },
    async (progress) => {
      progress(20, 'Enviando los últimos productos…');
      await flushResults();
      progress(55, 'Calculando tiempos, frecuencias y precio final…');
      const s = await finishShopping({ force });
      progress(100, s?.offline ? 'Guardado en este dispositivo: se enviará con conexión' : 'Estadísticas actualizadas');
      return s;
    }, explainError);
  if (!res.ok) { startTimer(); return; }
  S.lastSummary = res.value;
  broadcast('session');
  renderSummary(el);
}

async function cancel(el) {
  if (!(await confirmDialog('Cancelar la compra', 'Se perderá lo marcado en esta compra y la lista volverá a estar pendiente. ¿Seguro?', 'Cancelar compra', 'danger'))) return;
  try { await cancelShopping(); broadcast('session'); render(el, []); } catch (e) { dialog({ title: 'No se ha podido cancelar', message: explainError(e) }); }
}

/* ---------- Resumen final ---------- */
function renderSummary(el) {
  stopTimer();
  const s = S.lastSummary;
  const diff = (Number(s.final_estimated_total) || 0) - (Number(s.initial_estimated_total) || 0);
  el.innerHTML = `
    <div class="hero"><div><h2 id="h-compra">🎉 ¡Compra hecha!</h2><p>${s.synced === false ? 'Guardada en este dispositivo: se enviará en cuanto haya conexión.' : 'Todo guardado y las estadísticas actualizadas.'}</p></div></div>
    <article class="card" style="margin-top:18px">
      <div class="kv">
        <div><small>Tiempo total</small><b>${fmtDuration(s.duration_seconds)}</b></div>
        <div><small>Comprador</small><b>${esc(s.shopper || '—')}</b></div>
        <div><small>Productos previstos</small><b>${s.planned_items ?? '—'}</b></div>
        <div><small>Productos recogidos</small><b>${(s.collected_items ?? 0) + (s.partial_items ?? 0)}</b></div>
        <div><small>Sin existencias</small><b>${s.missing_items ?? 0}</b></div>
        <div><small>Unidades parciales</small><b>${s.partial_items ?? 0}</b></div>
        <div><small>Precio inicial estimado</small><b>${fmtEur(s.initial_estimated_total)}</b></div>
        <div><small>Precio final estimado</small><b>${fmtEur(s.final_estimated_total)}</b></div>
        <div><small>Diferencia</small><b>${diff > 0 ? '+' : ''}${fmtEur(diff)}</b></div>
        <div><small>Frente a su media</small><b>${esc(deviationText(s.deviation_pct == null ? null : Number(s.deviation_pct)))}</b></div>
      </div>
      <div class="row" style="margin-top:14px"><a class="btn ghost" href="#tickets">🧾 Subir el ticket</a><a class="btn ghost" href="#numeros">🏆 Ver los números</a><button type="button" class="btn primary" data-ok-summary>Hecho</button></div>
    </article>`;
  el.onclick = (e) => { if (e.target.closest('[data-ok-summary]')) { S.lastSummary = null; render(el, []); } };
}

/* ---------- Temporizador (sigue aunque se cambie de sección o se recargue) ---------- */
function startTimer() {
  stopTimer();
  const tick = async () => {
    const t = document.getElementById('shopTimer');
    if (!t || !S.session?.session) { stopTimer(); return; }
    const sec = (Date.now() - new Date(S.session.session.started_at).getTime()) / 1000;
    t.textContent = fmtClock(sec);
    t.setAttribute('aria-label', `Tiempo de compra: ${fmtDuration(sec)}`);
  };
  tick();
  timer = setInterval(tick, 1000);
}
function stopTimer() { clearInterval(timer); timer = null; }

export function leave() { stopTimer(); return flushResults().catch(() => {}); }
export function hidden() { /* flushOnExit global */ }

