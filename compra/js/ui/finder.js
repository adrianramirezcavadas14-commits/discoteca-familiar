/* =====================================================================
   Buscador universal de productos (todo el súper, no solo una zona).
   · Sin distinguir mayúsculas ni tildes, con coincidencias parciales.
   · Cada resultado muestra la zona en la que está ahora.
   · Al escribir solo se repintan los resultados (el teclado del móvil no se cierra).
   modo 'mapa'  → al elegir un producto se abre su ficha para ver o cambiar la zona.
   modo 'lista' → botones para añadir a la lista principal, a «Pendientes no urgentes»
                  o marcar «Pendiente de revisar».
   ===================================================================== */
import { S, zoneById, zoneIdOf, selectable, draftQty } from '../data/store.js';
import { backlogQty, isFlagged } from '../data/plans.js';
import { productImg } from './dom.js';
import { priceHtml } from './cards.js';
import { esc, norm, plural, debounce } from '../core/text.js';
import { findProducts as findIn } from '../core/catalog-view.js';

const LIMIT = 60;
const state = new WeakMap();
const queries = {};   // lo escrito se conserva aunque la página se vuelva a pintar

/** Coincidencias en todo el súper (solo productos visibles y activos). */
export const findProducts = (q, products = [...S.products.values()]) => findIn(q, products, selectable);

export function zoneLabel(pid) {
  const z = zoneById(zoneIdOf(pid));
  return z ? `<span class="zone-pill" style="--zc:${esc(z.color)}"><b>${esc(z.route_order)}</b>${esc(z.name)}</span>` : '<span class="zone-pill none"><b>?</b>Sin clasificar</span>';
}

function rowHtml(p, mode) {
  const inList = draftQty(p.id), later = backlogQty(p.id), flagged = isFlagged(p.id);
  const status = [inList ? `<span class="pill ok">En la lista · ${inList}</span>` : '', later ? `<span class="pill grey">No urgente · ${later}</span>` : '', flagged ? '<span class="pill warn">Pendiente de revisar</span>' : ''].join('');
  const actions = mode === 'mapa'
    ? `<button type="button" class="btn small ghost" data-fd-open="${esc(p.id)}">Ver o cambiar la zona</button>`
    : `<button type="button" class="btn small primary" data-fd-main="${esc(p.id)}" aria-label="Añadir ${esc(p.name)} a la lista principal">＋ Lista</button>
       <button type="button" class="btn small ghost" data-fd-later="${esc(p.id)}" aria-label="Añadir ${esc(p.name)} a Pendientes no urgentes">🕰️ No urgente</button>
       <button type="button" class="btn small ${flagged ? 'yellow' : 'ghost'} flag-toggle" data-fd-flag="${esc(p.id)}" aria-pressed="${flagged}" aria-label="${flagged ? 'Quitar la marca de pendiente de revisar' : 'Marcar como pendiente de revisar'}: ${esc(p.name)}">🚩<span class="bl"> ${flagged ? 'Revisar ✓' : 'Revisar'}</span></button>`;
  return `<div class="fd-row" data-pid="${esc(p.id)}">
    <button type="button" class="fd-img" data-fd-open="${esc(p.id)}" aria-label="Ver ficha de ${esc(p.name)}">${productImg(p)}</button>
    <div class="fd-main">
      <button type="button" class="fd-name" data-fd-open="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.format_label || '')}</small></button>
      <div class="fd-meta">${zoneLabel(p.id)}${priceHtml(p, { unit: false })}${status}</div>
    </div>
    <div class="fd-actions">${actions}</div>
  </div>`;
}

/**
 * Pinta el buscador en `host`. Solo la primera vez crea la caja de texto; después
 * repaint() actualiza los resultados sin tocarla.
 * opts: { mode: 'mapa' | 'lista', title, placeholder, onOpen(pid), onMain(pid), onLater(pid), onFlag(pid) }
 */
export function mountFinder(host, opts) {
  let st = state.get(host);
  if (!st || !host.querySelector('[data-fd-q]')) {
    st = { q: queries[opts.mode] || '', opts };
    state.set(host, st);
    host.innerHTML = `<div class="card finder" role="search">
      <div class="card-head"><h3>${esc(opts.title || 'Buscar un producto en todo el súper')}</h3></div>
      <div class="finder-box">
        <input class="input" type="search" data-fd-q value="${esc(st.q)}" placeholder="${esc(opts.placeholder || '🔎 Escribe el nombre de un producto…')}" aria-label="${esc(opts.title || 'Buscar un producto en todo el súper')}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
        <button type="button" class="finder-clear" data-fd-clear aria-label="Borrar la búsqueda" ${st.q ? '' : 'hidden'}>×</button>
      </div>
      <div class="finder-results" data-fd-results aria-live="polite"></div>
    </div>`;
    const input = host.querySelector('[data-fd-q]');
    const run = debounce(() => { st.q = input.value; queries[opts.mode] = st.q; paintResults(host); }, 200);
    input.addEventListener('input', () => { host.querySelector('[data-fd-clear]').hidden = !input.value; run(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });
    host.addEventListener('click', async (e) => {
      const t = e.target;
      const o = st.opts;
      if (t.closest('[data-fd-clear]')) { input.value = ''; st.q = ''; queries[opts.mode] = ''; t.closest('[data-fd-clear]').hidden = true; paintResults(host); return; }
      const open = t.closest('[data-fd-open]');
      if (open) { o.onOpen?.(open.dataset.fdOpen); return; }
      const main = t.closest('[data-fd-main]');
      if (main) { await o.onMain?.(main.dataset.fdMain); paintResults(host); return; }
      const later = t.closest('[data-fd-later]');
      if (later) { await o.onLater?.(later.dataset.fdLater); paintResults(host); return; }
      const flag = t.closest('[data-fd-flag]');
      if (flag) { await o.onFlag?.(flag.dataset.fdFlag); paintResults(host); }
    });
  }
  st.opts = opts;
  paintResults(host);
}

export function paintResults(host) {
  const st = state.get(host);
  const box = host.querySelector('[data-fd-results]');
  if (!st || !box) return;
  const q = st.q.trim();
  if (norm(q).length < 2) { box.innerHTML = '<p class="muted finder-hint">Escribe al menos dos letras. Busca en todos los productos, estén en la zona que estén.</p>'; return; }
  const found = findProducts(q);
  box.innerHTML = found.length
    ? `<p class="muted finder-hint">${plural(found.length, 'resultado', 'resultados')}${found.length > LIMIT ? ` (se muestran los ${LIMIT} primeros; escribe más letras para afinar)` : ''}</p><div class="fd-list">${found.slice(0, LIMIT).map((p) => rowHtml(p, st.opts.mode)).join('')}</div>`
    : '<div class="empty-note">No hay ningún producto con ese nombre.</div>';
}
