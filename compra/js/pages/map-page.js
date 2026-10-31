/* =====================================================================
   «El mapa del súper» · Zonas y productos asignados (edición)
   ===================================================================== */
import { S, zonesByRoute, zoneById, productsInZone, unclassifiedProducts, productById, zoneIdOf, setZones, profileName, selectable } from '../data/store.js';
import { explainError } from '../data/api.js';
import { renderMap } from '../ui/map.js';
import { tileHtml, openProductDetail } from '../ui/cards.js';
import { toast, dialog, confirmDialog, closeModal } from '../ui/dom.js';
import { go, broadcast } from '../ui/nav.js';
import { circularNeighbors, arrowLabel } from '../core/zones.js';
import { filterProducts, sortProducts, subcategoriesOf, pageSlice } from '../core/catalog-view.js';
import { esc, plural, debounce, fmtDateTime } from '../core/text.js';

const NONE = 'sin-zona';
const TILE_PAGE = 60;
const ui = { zoneId: null, q: '', sub: '', page: 1, selecting: false, selected: new Set(), lastMove: null, globalQ: '' };

const zoneOptions = (sel = '') => zonesByRoute().map((z) => `<option value="${esc(z.id)}"${z.id === sel ? ' selected' : ''}>${z.route_order} · ${esc(z.name)}${z.active === false ? ' (desactivada)' : ''}</option>`).join('');

export function render(el, params = []) {
  const zid = params[0] || null;
  if (zid !== ui.zoneId) Object.assign(ui, { zoneId: zid, q: '', sub: '', page: 1, selecting: false, selected: new Set() });
  el.innerHTML = `<div class="hero"><div><h2 id="h-mapa">El mapa del súper</h2><p>${zid ? 'Toca una foto para ver el producto o moverlo de zona.' : 'Nuestro supermercado de siempre. Los números son el orden recomendado del recorrido.'}</p></div></div><div data-body></div>`;
  bind(el);
  paint(el);
}
export function update(el, params, what) {
  if (['zones', 'catalog', 'draft', 'lists', 'orientation', 'all'].includes(what)) paint(el);
}

function paint(el) {
  const body = el.querySelector('[data-body]');
  if (!ui.zoneId) return paintMap(body);
  return paintZone(body);
}

function paintMap(body) {
  const counts = new Map();
  for (const [pid, it] of S.draft.items) if (it.quantity > 0) { const z = zoneIdOf(pid); if (z) counts.set(z, (counts.get(z) || 0) + 1); }
  const none = unclassifiedProducts().length;
  body.innerHTML = `
    <div class="card map-card" style="margin-top:16px"><div data-map-host></div></div>
    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3>Buscar un producto en todo el súper</h3></div>
      <input class="input" type="search" data-global value="${esc(ui.globalQ)}" placeholder="🔎 Nombre, marca o categoría…" aria-label="Buscar en todo el catálogo" autocomplete="off">
      <div data-global-results style="margin-top:12px"></div>
    </div>`;
  renderMap(body.querySelector('[data-map-host]'), {
    zones: S.zones, counts, countLabel: ['producto pendiente en la lista', 'productos pendientes en la lista'],
    legend: 'El número rojo indica los productos de la lista pendientes en cada zona.',
    extraButtons: none ? [{ id: NONE, label: '❔ Sin clasificar', count: none }] : [],
    onSelect: (id) => go('mapa', id), onExtra: (id) => go('mapa', id)
  });
  paintGlobal(body);
}

function paintGlobal(body) {
  const host = body.querySelector('[data-global-results]');
  if (!host) return;
  const q = ui.globalQ.trim();
  if (q.length < 2) { host.innerHTML = '<p class="muted">Escribe al menos dos letras.</p>'; return; }
  const found = sortProducts(filterProducts([...S.products.values()].filter(selectable), { q }), 'alpha');
  host.innerHTML = found.length ? `<p class="muted">${plural(found.length, 'resultado', 'resultados')}${found.length > 60 ? ' (se muestran 60)' : ''}</p><div class="tiles">${found.slice(0, 60).map((p) => tileHtml(p)).join('')}</div>` : '<div class="empty-note">No hay productos con ese nombre.</div>';
}

function zoneList() {
  return ui.zoneId === NONE ? unclassifiedProducts() : productsInZone(ui.zoneId);
}

function paintZone(body) {
  const isNone = ui.zoneId === NONE;
  const zone = isNone ? { id: NONE, route_order: '?', name: 'Productos sin clasificar', color: '#8a8f9c', summary: 'Sin zona asignada' } : zoneById(ui.zoneId);
  if (!zone) { go('mapa'); return; }
  const nav = isNone ? { prev: zonesByRoute().at(-1), next: zonesByRoute()[0] } : circularNeighbors(S.zones, zone.id, { onlyActive: false });
  const all = zoneList();
  const subs = subcategoriesOf(all);
  const list = sortProducts(filterProducts(all, { q: ui.q, subcategory: ui.sub || null }), 'alpha');
  const shown = pageSlice(list, ui.page, TILE_PAGE);
  const cats = isNone ? '' : S.rules.filter((r) => r.zone_id === zone.id && r.source !== 'auto').map((r) => r.category_name);
  body.innerHTML = `
    <nav class="zone-nav" aria-label="Cambiar de zona" style="--zc:${esc(zone.color)}">
      <button type="button" class="zn-arrow prev" data-goto="${esc(nav.prev?.id || '')}" aria-label="Zona anterior: ${esc(nav.prev?.name || '')}"><b aria-hidden="true">‹</b><span><strong>${nav.prev ? `${nav.prev.route_order} · ${esc(nav.prev.name)}` : ''}</strong><small>${esc(arrowLabel(nav.prev))}</small></span></button>
      <div class="zn-current"><span class="zn-num">${esc(zone.route_order)}</span><strong>${esc(zone.name)}</strong><button type="button" class="btn small ghost" data-map>🗺️ Mapa</button></div>
      <button type="button" class="zn-arrow next" data-goto="${esc(nav.next?.id || '')}" aria-label="Zona siguiente: ${esc(nav.next?.name || '')}"><span><strong>${nav.next ? `${nav.next.route_order} · ${esc(nav.next.name)}` : ''}</strong><small>${esc(arrowLabel(nav.next))}</small></span><b aria-hidden="true">›</b></button>
    </nav>
    ${cats && cats.length ? `<p class="muted" style="margin:0 0 10px"><b>Categorías:</b> ${esc(cats.join(' · '))}</p>` : ''}
    ${!isNone && zone.notes ? `<p class="muted" style="margin:0 0 10px"><b>Observaciones:</b> ${esc(zone.notes)}</p>` : ''}
    <div class="toolbar">
      <input class="input search-input" type="search" data-q value="${esc(ui.q)}" placeholder="🔎 Buscar en esta zona…" aria-label="Buscar productos en esta zona" autocomplete="off">
      <select class="input" data-sub aria-label="Filtrar por categoría"><option value="">Todas las categorías</option>${subs.map((s) => `<option value="${s.id}"${String(s.id) === String(ui.sub) ? ' selected' : ''}>${esc(s.name)} (${s.count})</option>`).join('')}</select>
      <button type="button" class="btn small ${ui.selecting ? 'yellow' : 'ghost'}" data-select aria-pressed="${ui.selecting}">${ui.selecting ? 'Terminar selección' : '☑️ Seleccionar varios'}</button>
      ${ui.lastMove ? '<button type="button" class="btn small ghost" data-undo>↶ Deshacer el último movimiento</button>' : ''}
    </div>
    <p class="muted" style="margin:0 0 8px">${plural(list.length, 'producto', 'productos')}${ui.selecting ? ' · toca las fotos para seleccionarlas' : ''}</p>
    ${shown.length ? `<div class="tiles" role="list">${shown.map((p) => tileHtml(p, { selecting: ui.selecting, selected: ui.selected.has(p.id) })).join('')}</div>` : '<div class="empty-note">No hay productos aquí con esos filtros.</div>'}
    ${shown.length < list.length ? `<button type="button" class="load-more" data-more>Ver más (${list.length - shown.length} restantes)</button>` : ''}
    ${ui.selecting ? `<div class="select-bar" role="region" aria-label="Acciones con la selección">
      <b>${plural(ui.selected.size, 'seleccionado', 'seleccionados')}</b>
      <select data-target aria-label="Zona de destino"><option value="">Mover a…</option>${zoneOptions()}</select>
      <button type="button" class="btn small yellow" data-move ${ui.selected.size ? '' : 'disabled'}>Mover</button>
      <button type="button" class="btn small ghost" data-restore ${ui.selected.size ? '' : 'disabled'}>Restaurar zona automática</button>
      <button type="button" class="btn small ghost" data-all>Seleccionar todo lo visible</button>
    </div>` : ''}`;
}

const bound = new WeakSet();
function bind(el) {
  if (bound.has(el)) return;
  bound.add(el);
  const onQ = debounce((v) => { ui.q = v; ui.page = 1; repaintKeep(el, '[data-q]'); }, 250);
  const onG = debounce((v) => { ui.globalQ = v; paintGlobal(el.querySelector('[data-body]')); }, 250);
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) onQ(e.target.value);
    if (e.target.matches('[data-global]')) onG(e.target.value);
  });
  el.addEventListener('change', (e) => { if (e.target.matches('[data-sub]')) { ui.sub = e.target.value; ui.page = 1; paint(el); } });
  el.addEventListener('click', async (e) => {
    const t = e.target;
    const tile = t.closest('[data-tile]');
    if (tile) {
      if (ui.selecting) { const id = tile.dataset.tile; if (ui.selected.has(id)) ui.selected.delete(id); else ui.selected.add(id); repaintKeep(el, `[data-tile="${CSS.escape(id)}"]`); }
      else showProduct(tile.dataset.tile, el);
      return;
    }
    const g = t.closest('[data-goto]');
    if (g?.dataset.goto) { go('mapa', g.dataset.goto); return; }
    if (t.closest('[data-map]')) { go('mapa'); return; }
    if (t.closest('[data-more]')) { ui.page++; paint(el); return; }
    if (t.closest('[data-select]')) { ui.selecting = !ui.selecting; ui.selected = new Set(); paint(el); return; }
    if (t.closest('[data-all]')) { pageSlice(sortProducts(filterProducts(zoneList(), { q: ui.q, subcategory: ui.sub || null }), 'alpha'), ui.page, TILE_PAGE).forEach((p) => ui.selected.add(p.id)); paint(el); return; }
    if (t.closest('[data-move]')) {
      const target = el.querySelector('[data-target]').value;
      if (!target) { toast('Elige la zona de destino.'); return; }
      await move([...ui.selected].map((id) => ({ product_id: id, zone_id: target })), el, `Movidos a la zona ${zoneById(target)?.route_order}`);
      return;
    }
    if (t.closest('[data-restore]')) {
      if (!(await confirmDialog('Restaurar zona automática', `Los ${ui.selected.size} productos volverán a la zona que les corresponde por su categoría.`, 'Restaurar'))) return;
      await move([...ui.selected].map((id) => ({ product_id: id, zone_id: null })), el, 'Zona automática restaurada');
      return;
    }
    if (t.closest('[data-undo]')) {
      await move(ui.lastMove, el, 'Movimiento deshecho', true);
    }
  });
}

function repaintKeep(el, selector) {
  const active = document.activeElement;
  const pos = active?.selectionStart;
  paint(el);
  const again = el.querySelector(selector);
  if (again) { again.focus({ preventScroll: true }); if (pos != null) try { again.setSelectionRange(pos, pos); } catch { /* nada */ } }
}

async function move(assignments, el, msg, isUndo = false) {
  if (!assignments?.length) return;
  if (!navigator.onLine) { dialog({ title: 'Sin conexión', message: 'Mover productos de zona necesita conexión para que lo vea toda la familia.' }); return; }
  try {
    const previous = await setZones(assignments, isUndo ? 'Deshacer' : null);
    ui.lastMove = isUndo ? null : previous;
    ui.selected = new Set();
    broadcast('zones');
    toast(`${msg} (${plural(assignments.length, 'producto', 'productos')}).`);
    paint(el);
  } catch (e) {
    dialog({ title: 'No se ha podido mover', message: explainError(e) });
  }
}

function showProduct(pid, el) {
  const p = productById(pid);
  const manual = S.overrides.has(pid);
  const meta = S.overrideMeta.get(pid);
  const modal = openProductDetail(p, {
    extra: `<div class="card" style="margin-top:12px;padding:12px">
      <label class="field"><span>Mover a la zona</span><select data-to aria-label="Mover a la zona">${zoneOptions(zoneIdOf(pid) || '')}</select></label>
      <div class="row" style="margin-top:10px">
        <button type="button" class="btn small primary" data-do-move>Mover</button>
        ${manual ? '<button type="button" class="btn small ghost" data-do-restore>Restaurar zona automática</button>' : ''}
      </div>
      ${manual && meta ? `<p class="muted" style="font-size:13px;margin:8px 0 0">Cambiado por ${esc(profileName(meta.updated_by))} el ${esc(fmtDateTime(meta.updated_at))}.</p>` : ''}
    </div>`
  });
  modal.querySelector('#pmBody').onclick = async (e) => {
    if (e.target.closest('[data-do-move]')) {
      const to = modal.querySelector('[data-to]').value;
      closeModal(modal);
      await move([{ product_id: pid, zone_id: to }], el, `Movido a la zona ${zoneById(to)?.route_order}`);
    } else if (e.target.closest('[data-do-restore]')) {
      closeModal(modal);
      await move([{ product_id: pid, zone_id: null }], el, 'Zona automática restaurada');
    }
  };
}
