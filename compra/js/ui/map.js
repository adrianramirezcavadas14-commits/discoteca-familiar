/* =====================================================================
   Mapa conceptual del supermercado en HTML + CSS Grid (sin imagen fija)
   · Cada zona es un botón accesible con número, nombre y pendientes.
   · En móviles en vertical el plano se gira para que quepa a lo alto.
   · Lupa (− / +) para verlo más grande y vista alternativa en lista.
   · Modo «Cambiar tamaños» (solo en El mapa del súper): agrandar, reducir
     y mover zonas con tiradores o con botones; se guarda para toda la familia.
   ===================================================================== */
import { esc, plural } from '../core/text.js';
import { byRoute } from '../core/zones.js';
import {
  WALLS, CHECKOUT, DEFAULT_SHAPES, rectStyle, mainShapeIndex, isTall, gridFor, validShapes,
  resizeShape, growShape, cleanShape, shapeFits
} from '../core/map-layout.js';
import { STORAGE_KEYS } from '../config.js';
import { confirmDialog } from './dom.js';

const ZOOMS = [1, 1.35, 1.7, 2.1];
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } };
const getView = () => lsGet(STORAGE_KEYS.mapView, 'map');
const getZoom = () => { const n = Math.round(Number(lsGet(STORAGE_KEYS.mapZoom, 0)) || 0); return Math.min(Math.max(0, n), ZOOMS.length - 1); };

/**
 * Móvil en vertical. Se mira la PANTALLA y no la ventana: al abrir el teclado la
 * ventana se vuelve «apaisada» y no queremos que el mapa se gire (ni que se repinte
 * la página y se cierre el teclado).
 */
export function portraitPhone() {
  const w = Math.min(window.innerWidth || 0, (window.screen && window.screen.width) || Infinity);
  if (w > 700) return false;
  const type = window.screen?.orientation?.type;
  if (type) return type.startsWith('portrait');
  return (window.screen?.height || window.innerHeight) >= (window.screen?.width || window.innerWidth);
}

/**
 * opts: { zones, counts: Map, done: Set, activeId, onSelect(zoneId), countLabel: ['producto','productos'],
 *         legend, extraButtons: [{ id, label, count }], onExtra(id),
 *         editable: bool, editHolder: {} (conserva la edición aunque se repinte la página),
 *         onShapesSave: async ([{ zone, shapes }]) }
 */
export function renderMap(container, opts) {
  container._mapOpts = opts;
  const view = getView();
  const rotated = portraitPhone();
  const zones = byRoute(opts.zones || []);
  const counts = opts.counts || new Map();
  const done = opts.done || new Set();
  const [one, many] = opts.countLabel || ['pendiente', 'pendientes'];
  const g = gridFor(rotated);
  const holder = opts.editHolder || container;
  const ed = opts.editable ? holder._edit || null : null;
  const zoomIdx = getZoom();
  const shapesOf = (z) => (ed ? ed.shapes.get(z.id) : null) || (validShapes(z.map_shapes) ? z.map_shapes : []);

  const label = (z) => {
    const n = counts.get(z.id) || 0;
    const state = done.has(z.id) ? ' · completa' : '';
    return `Zona ${z.route_order}: ${z.name}${n ? ` · ${plural(n, one, many)}` : ''}${state}${z.active === false ? ' · desactivada' : ''}`;
  };

  const handles = '<span class="rh rh-n" data-h="n" aria-hidden="true"></span><span class="rh rh-s" data-h="s" aria-hidden="true"></span><span class="rh rh-w" data-h="w" aria-hidden="true"></span><span class="rh rh-e" data-h="e" aria-hidden="true"></span><span class="rh rh-se" data-h="se" aria-hidden="true"></span>';

  const shapes = zones.map((z) => {
    const list = shapesOf(z);
    const mi = mainShapeIndex(list);
    const n = ed ? 0 : counts.get(z.id) || 0;
    const cls = `${z.id === opts.activeId ? ' active' : ''}${done.has(z.id) ? ' done' : ''}${n ? ' has' : ''}${z.active === false ? ' off' : ''}`;
    return list.map((s, i) => {
      const sel = ed && ed.sel && ed.sel.zoneId === z.id && ed.sel.idx === i;
      const style = `${rectStyle(s, rotated)}--zc:${esc(z.color)};`;
      const common = `data-zone="${esc(z.id)}" data-idx="${i}" style="${style}"`;
      const extra = `${s.r ? ' tilted' : ''}${sel ? ' selected' : ''}${ed && ed.sel?.zoneId === z.id ? ' same' : ''}`;
      if (i !== mi) {
        return `<button type="button" class="zone-shape part${cls}${extra}" ${common} tabindex="${ed ? 0 : -1}" ${ed ? `aria-label="${esc(`Zona ${z.route_order}, pieza ${i + 1}`)}"` : 'aria-hidden="true"'} title="${esc(label(z))}">${sel ? handles : ''}</button>`;
      }
      const lp = s.lp === 'end' ? (rotated ? ' lp-start' : ' lp-end') : '';
      return `<button type="button" class="zone-shape main${cls}${extra}${isTall(s, rotated) ? ' tall' : ''}${lp}" ${common} aria-pressed="${ed ? sel : z.id === opts.activeId}" aria-label="${esc(label(z))}" title="${esc(label(z))}">
        <span class="zbody"><span class="zhead">${done.has(z.id) ? '<span class="zdone" aria-hidden="true">✓</span>' : ''}<span class="zn">${z.route_order}</span>${n ? `<span class="zcount" aria-hidden="true">${n}</span>` : ''}</span><span class="zname">${esc(z.name)}</span></span>${sel ? handles : ''}
      </button>`;
    }).join('');
  }).join('');

  const walls = WALLS.map((w) => `<span class="map-wall" style="${rectStyle(w, rotated)}" aria-hidden="true"></span>`).join('');
  const checkout = `<span class="map-checkout" style="${rectStyle(CHECKOUT, rotated)}" aria-hidden="true"><b>Cajas</b></span>`;

  const listView = `<ol class="zone-list" aria-label="Zonas en orden de recorrido">${zones.map((z) => {
    const n = counts.get(z.id) || 0;
    return `<li><button type="button" class="zone-row${z.id === opts.activeId ? ' active' : ''}${done.has(z.id) ? ' done' : ''}${z.active === false ? ' off' : ''}" data-zone="${esc(z.id)}" style="--zc:${esc(z.color)}" aria-label="${esc(label(z))}">
      <span class="zn">${z.route_order}</span><span class="zr-text"><b>${esc(z.name)}</b><small>${esc(z.summary || '')}</small></span>
      ${done.has(z.id) ? '<span class="zr-state ok">✓ Completa</span>' : n ? `<span class="zr-state">${plural(n, one, many)}</span>` : '<span class="zr-state none">—</span>'}
    </button></li>`;
  }).join('')}</ol>`;

  const extras = ed ? '' : (opts.extraButtons || []).map((b) => `<button type="button" class="map-extra" data-extra="${esc(b.id)}">${esc(b.label)}${b.count != null ? ` <b>${b.count}</b>` : ''}</button>`).join('');
  const zoomCtl = view === 'map' ? `<div class="seg zoom" role="group" aria-label="Tamaño del mapa">
      <button type="button" data-zoom="-1" aria-label="Ver el mapa más pequeño" ${zoomIdx === 0 ? 'disabled' : ''}>−</button>
      <button type="button" data-zoom="1" aria-label="Ver el mapa más grande" ${zoomIdx === ZOOMS.length - 1 ? 'disabled' : ''}>+</button>
    </div>` : '';
  const editBtn = opts.editable && view === 'map' && !ed ? '<button type="button" class="map-extra" data-edit>✏️ Cambiar tamaños</button>' : '';

  container.innerHTML = `
    <div class="map-tools">
      ${ed ? '' : `<div class="seg" role="group" aria-label="Cómo ver las zonas">
        <button type="button" data-view="map" aria-pressed="${view === 'map'}">🗺️ Mapa</button>
        <button type="button" data-view="list" aria-pressed="${view === 'list'}">☰ Lista</button>
      </div>`}
      ${zoomCtl}
      ${opts.legend && !ed ? `<span class="map-legend">${opts.legend}</span>` : ''}
      ${extras}${editBtn}
    </div>
    ${ed ? editHelp(rotated) : ''}
    ${view === 'map' || ed ? `<div class="map-scroll"><div class="store-map${rotated ? ' rotated' : ''}${ed ? ' editing' : ''}" style="--cols:${g.cols};--rows:${g.rows};--zoom:${ZOOMS[zoomIdx]}" role="group" aria-label="Mapa de nuestro supermercado. Los números marcan el orden recomendado del recorrido.">
      ${walls}${checkout}${shapes}
    </div></div>` : listView}
    ${ed ? editPanel(ed, zones) : ''}`;

  bindMap(container);
}

function editHelp(rotated) {
  return `<p class="mep-help"><b>Toca una zona</b> y agrándala, redúcela o muévela con los botones de abajo, o arrastrando los tiradores blancos de sus bordes.${rotated ? ' En el móvil el plano se ve girado: los botones funcionan tal y como lo ves.' : ''} Nada se guarda hasta pulsar «Guardar».</p>`;
}

function editPanel(ed, zones) {
  const z = ed.sel ? zones.find((x) => x.id === ed.sel.zoneId) : null;
  const pieces = z ? (ed.shapes.get(z.id) || z.map_shapes || []).length : 0;
  return `<div class="map-edit-panel" role="region" aria-label="Cambiar el tamaño de las zonas">
    ${z ? `<div class="mep-title" style="--zc:${esc(z.color)}"><span class="zn">${z.route_order}</span><b>${esc(z.name)}</b>${pieces > 1 ? `<button type="button" class="btn small ghost" data-piece>Pieza ${ed.sel.idx + 1} de ${pieces} ›</button>` : ''}</div>
      <div class="mep-grid">
        <span class="mep-group"><span class="mep-label">Ancho</span><button type="button" class="btn small ghost" data-grow="w:-1" aria-label="Más estrecha">−</button><button type="button" class="btn small ghost" data-grow="w:1" aria-label="Más ancha">+</button></span>
        <span class="mep-group"><span class="mep-label">Alto</span><button type="button" class="btn small ghost" data-grow="h:-1" aria-label="Más baja">−</button><button type="button" class="btn small ghost" data-grow="h:1" aria-label="Más alta">+</button></span>
        <span class="mep-group"><span class="mep-label">Mover</span><button type="button" class="btn small ghost" data-nudge="-1:0" aria-label="Mover a la izquierda">←</button><button type="button" class="btn small ghost" data-nudge="0:-1" aria-label="Mover arriba">↑</button><button type="button" class="btn small ghost" data-nudge="0:1" aria-label="Mover abajo">↓</button><button type="button" class="btn small ghost" data-nudge="1:0" aria-label="Mover a la derecha">→</button></span>
        ${DEFAULT_SHAPES[z.code] ? '<button type="button" class="btn small ghost mep-reset" data-reset>↺ Forma original</button>' : ''}
      </div>` : '<p class="mep-help" style="margin:0">Toca una zona del plano para elegirla.</p>'}
    <div class="row mep-actions">
      <button type="button" class="btn small primary" data-save-shapes ${ed.dirty.size ? '' : 'disabled'}>💾 Guardar${ed.dirty.size ? ` (${plural(ed.dirty.size, 'zona', 'zonas')})` : ''}</button>
      <button type="button" class="btn small ghost" data-cancel-edit>Salir sin guardar</button>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
function bindMap(container) {
  if (container._mapBound) return;
  container._mapBound = true;
  const opts = () => container._mapOpts;
  const rerender = () => renderMap(container, opts());
  const zoneObj = (id) => (opts().zones || []).find((z) => z.id === id);
  const holder = () => container._mapOpts.editHolder || container;
  const edit = () => holder()._edit;
  const currentShapes = (z) => edit().shapes.get(z.id) || (validShapes(z.map_shapes) ? z.map_shapes.map((s) => ({ ...s })) : []);
  const changeSel = (fn) => {
    const ed = edit();
    if (!ed?.sel) return;
    const z = zoneObj(ed.sel.zoneId);
    const list = currentShapes(z).map((s) => ({ ...s }));
    const next = fn(list[ed.sel.idx], portraitPhone());
    if (!shapeFits(next)) return;
    list[ed.sel.idx] = next;
    ed.shapes.set(z.id, list);
    ed.dirty.add(z.id);
    rerender();
  };

  container.addEventListener('click', async (e) => {
    if (container._justDragged) { container._justDragged = false; e.preventDefault(); return; }
    const t = e.target;
    const v = t.closest('[data-view]');
    if (v) { lsSet(STORAGE_KEYS.mapView, v.dataset.view); rerender(); return; }
    const zb = t.closest('[data-zoom]');
    if (zb) { lsSet(STORAGE_KEYS.mapZoom, String(Math.min(Math.max(0, getZoom() + Number(zb.dataset.zoom)), ZOOMS.length - 1))); rerender(); return; }
    if (t.closest('[data-edit]')) { holder()._edit = { shapes: new Map(), dirty: new Set(), sel: null }; lsSet(STORAGE_KEYS.mapView, 'map'); rerender(); return; }
    const ed = edit();
    if (ed) {
      if (t.closest('[data-cancel-edit]')) {
        if (ed.dirty.size && !(await confirmDialog('Salir sin guardar', 'Se perderán los cambios del plano que no has guardado.', 'Salir sin guardar', 'danger'))) return;
        holder()._edit = null; rerender(); return;
      }
      if (t.closest('[data-save-shapes]')) {
        const changes = [...ed.dirty].map((id) => ({ zone: zoneObj(id), shapes: ed.shapes.get(id).map(cleanShape) }));
        const btn = t.closest('[data-save-shapes]');
        btn.disabled = true;
        try { await opts().onShapesSave?.(changes); holder()._edit = null; rerender(); } catch { btn.disabled = false; }
        return;
      }
      const g = t.closest('[data-grow]');
      if (g) { const [axis, d] = g.dataset.grow.split(':'); changeSel((s, rot) => growShape(s, axis, Number(d), rot)); return; }
      const nd = t.closest('[data-nudge]');
      if (nd) { const [dc, dr] = nd.dataset.nudge.split(':').map(Number); changeSel((s, rot) => resizeShape(s, 'move', dc, dr, rot)); return; }
      if (t.closest('[data-piece]')) { const z = zoneObj(ed.sel.zoneId); ed.sel.idx = (ed.sel.idx + 1) % currentShapes(z).length; rerender(); return; }
      if (t.closest('[data-reset]')) {
        const z = zoneObj(ed.sel.zoneId);
        ed.shapes.set(z.id, DEFAULT_SHAPES[z.code].map((s) => ({ ...s })));
        ed.dirty.add(z.id);
        ed.sel.idx = 0;
        rerender();
        return;
      }
      const shape = t.closest('.zone-shape');
      if (shape) { ed.sel = { zoneId: shape.dataset.zone, idx: Number(shape.dataset.idx) || 0 }; rerender(); }
      return;
    }
    const x = t.closest('[data-extra]');
    if (x) { opts().onExtra?.(x.dataset.extra); return; }
    const b = t.closest('[data-zone]');
    if (b) opts().onSelect?.(b.dataset.zone);
  });

  // Al pasar por una parte de la zona se resaltan todas sus partes (congelados son tres arcones).
  container.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.zone-shape');
    container.querySelectorAll('.zone-shape.hover').forEach((x) => x.classList.remove('hover'));
    if (b) container.querySelectorAll(`.zone-shape[data-zone="${CSS.escape(b.dataset.zone)}"]`).forEach((x) => x.classList.add('hover'));
  });
  container.addEventListener('pointerleave', () => container.querySelectorAll('.zone-shape.hover').forEach((x) => x.classList.remove('hover')));

  // Arrastrar tiradores (cambiar tamaño) o la zona elegida (mover).
  container.addEventListener('pointerdown', (e) => {
    const ed = edit();
    if (!ed?.sel) return;
    const el = e.target.closest('.zone-shape.selected');
    if (!el) return;
    const handle = e.target.closest('[data-h]')?.dataset.h || 'move';
    const map = container.querySelector('.store-map');
    const cs = getComputedStyle(map);
    const rotated = portraitPhone();
    const g = gridFor(rotated);
    const cw = (map.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / g.cols;
    const ch = (map.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / g.rows;
    const z = zoneObj(ed.sel.zoneId);
    const start = { ...currentShapes(z)[ed.sel.idx] };
    const sx = e.clientX, sy = e.clientY;
    let moved = false, last = start;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    const onMove = (ev) => {
      const dc = Math.round((ev.clientX - sx) / cw), dr = Math.round((ev.clientY - sy) / ch);
      if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 6) return;
      moved = true;
      const next = resizeShape(start, handle, dc, dr, rotated);
      if (!shapeFits(next)) return;
      last = next;
      el.setAttribute('style', `${rectStyle(next, rotated)}--zc:${z.color};`);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      container._justDragged = true;
      setTimeout(() => { container._justDragged = false; }, 50);
      const list = currentShapes(z).map((s) => ({ ...s }));
      list[ed.sel.idx] = last;
      ed.shapes.set(z.id, list);
      ed.dirty.add(z.id);
      rerender();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });
}

/** Vuelve a pintar los mapas visibles SOLO cuando el móvil cambia de vertical a horizontal (no al abrir el teclado). */
export function watchOrientation(rerender) {
  let was = portraitPhone();
  const check = () => { const now = portraitPhone(); if (now !== was) { was = now; rerender(); } };
  window.screen?.orientation?.addEventListener?.('change', () => setTimeout(check, 120));
  window.addEventListener('orientationchange', () => setTimeout(check, 120));
  window.addEventListener('resize', check);
}
