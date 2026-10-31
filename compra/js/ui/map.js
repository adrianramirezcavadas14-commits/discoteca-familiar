/* =====================================================================
   Mapa conceptual del supermercado en HTML + CSS Grid (sin imagen fija)
   · Cada zona es un botón accesible con número, nombre y pendientes.
   · En móviles en vertical el plano se gira para que quepa a lo alto.
   · Vista alternativa en lista (siempre disponible).
   ===================================================================== */
import { esc, plural } from '../core/text.js';
import { byRoute } from '../core/zones.js';
import { WALLS, CHECKOUT, rectStyle, mainShapeIndex, isTall, gridFor, validShapes } from '../core/map-layout.js';
import { STORAGE_KEYS } from '../config.js';

const portraitPhone = () => window.matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
const getView = () => { try { return localStorage.getItem(STORAGE_KEYS.mapView) || 'map'; } catch { return 'map'; } };
const setView = (v) => { try { localStorage.setItem(STORAGE_KEYS.mapView, v); } catch { /* nada */ } };

/**
 * opts: { zones, counts: Map, done: Set, activeId, onSelect(zoneId), countLabel: ['producto','productos'],
 *         emptyText, legend, extraButtons: [{ id, label, count }] }
 */
export function renderMap(container, opts) {
  const view = getView();
  const rotated = portraitPhone();
  const zones = byRoute(opts.zones || []);
  const counts = opts.counts || new Map();
  const done = opts.done || new Set();
  const [one, many] = opts.countLabel || ['pendiente', 'pendientes'];
  const g = gridFor(rotated);

  const label = (z) => {
    const n = counts.get(z.id) || 0;
    const state = done.has(z.id) ? ' · completa' : '';
    return `Zona ${z.route_order}: ${z.name}${n ? ` · ${plural(n, one, many)}` : ''}${state}${z.active === false ? ' · desactivada' : ''}`;
  };

  const shapes = zones.map((z) => {
    const list = validShapes(z.map_shapes) ? z.map_shapes : [];
    const mi = mainShapeIndex(list);
    const n = counts.get(z.id) || 0;
    const cls = `${z.id === opts.activeId ? ' active' : ''}${done.has(z.id) ? ' done' : ''}${n ? ' has' : ''}${z.active === false ? ' off' : ''}`;
    return list.map((s, i) => {
      const style = `${rectStyle(s, rotated)}--zc:${esc(z.color)};`;
      if (i !== mi) return `<button type="button" class="zone-shape part${cls}${s.r ? ' tilted' : ''}" data-zone="${esc(z.id)}" style="${style}" tabindex="-1" aria-hidden="true" title="${esc(label(z))}"></button>`;
      return `<button type="button" class="zone-shape main${cls}${isTall(s, rotated) ? ' tall' : ''}${s.r ? ' tilted' : ''}${s.lp === 'end' ? ' lp-end' : ''}" data-zone="${esc(z.id)}" style="${style}" aria-pressed="${z.id === opts.activeId}" aria-label="${esc(label(z))}" title="${esc(label(z))}">
        <span class="zn">${z.route_order}</span><span class="zname">${esc(z.name)}</span>${n ? `<span class="zcount" aria-hidden="true">${n}</span>` : ''}${done.has(z.id) ? '<span class="zdone" aria-hidden="true">✓</span>' : ''}
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

  const extras = (opts.extraButtons || []).map((b) => `<button type="button" class="map-extra" data-extra="${esc(b.id)}">${esc(b.label)}${b.count != null ? ` <b>${b.count}</b>` : ''}</button>`).join('');

  container.innerHTML = `
    <div class="map-tools">
      <div class="seg" role="group" aria-label="Cómo ver las zonas">
        <button type="button" data-view="map" aria-pressed="${view === 'map'}">🗺️ Mapa</button>
        <button type="button" data-view="list" aria-pressed="${view === 'list'}">☰ Lista</button>
      </div>
      ${opts.legend ? `<span class="map-legend">${opts.legend}</span>` : ''}
      ${extras}
    </div>
    ${view === 'map' ? `<div class="store-map${rotated ? ' rotated' : ''}" style="--cols:${g.cols};--rows:${g.rows}" role="group" aria-label="Mapa de nuestro supermercado. Los números marcan el orden recomendado del recorrido.">
      ${walls}${checkout}${shapes}
    </div>` : listView}`;

  container.onclick = (e) => {
    const v = e.target.closest('[data-view]');
    if (v) { setView(v.dataset.view); renderMap(container, opts); return; }
    const x = e.target.closest('[data-extra]');
    if (x) { opts.onExtra?.(x.dataset.extra); return; }
    const b = e.target.closest('[data-zone]');
    if (b) opts.onSelect?.(b.dataset.zone);
  };
  // Al pasar por una parte de la zona se resaltan todas sus partes (congelados son tres arcones).
  container.onpointerover = (e) => {
    const b = e.target.closest('.zone-shape');
    container.querySelectorAll('.zone-shape.hover').forEach((x) => x.classList.remove('hover'));
    if (b) container.querySelectorAll(`.zone-shape[data-zone="${CSS.escape(b.dataset.zone)}"]`).forEach((x) => x.classList.add('hover'));
  };
  container.onpointerleave = () => container.querySelectorAll('.zone-shape.hover').forEach((x) => x.classList.remove('hover'));
}

/** Vuelve a pintar los mapas visibles al girar el móvil. */
export function watchOrientation(rerender) {
  const mq = window.matchMedia('(max-width: 700px) and (orientation: portrait)');
  const fn = () => rerender();
  mq.addEventListener ? mq.addEventListener('change', fn) : mq.addListener(fn);
}
