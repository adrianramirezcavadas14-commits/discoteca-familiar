/* =====================================================================
   Tarjetas de producto y ficha ampliada
   ===================================================================== */
import { esc, fmtEur, fmtDateTime, plural } from '../core/text.js';
import { priceState, unitPriceText, isNewProduct, itemSubtotal } from '../core/pricing.js';
import { productImg, $, openModal, closeModal } from './dom.js';
import { S, zoneById, zoneIdOf, profileName } from '../data/store.js';

const AVAIL = {
  available: null,
  temporarily_unavailable: { cls: 'warn', text: 'No disponible ahora' },
  possibly_removed: { cls: 'bad', text: 'Posiblemente retirado' },
  removed: { cls: 'bad', text: 'Retirado del catálogo' }
};
export const availabilityPill = (p) => {
  const a = AVAIL[p?.availability];
  return a ? `<span class="pill ${a.cls}">${a.text}</span>` : '';
};

/** Precio en verde, o en rojo con el anterior tachado si hay promoción o bajada. */
export function priceHtml(p, { unit = true } = {}) {
  const st = priceState(p);
  if (st.kind === 'unknown') return '<span class="price"><b>—</b></span>';
  const tag = st.kind === 'promo' ? 'Promoción' : st.kind === 'drop' ? 'Bajada' : '';
  const u = unit ? unitPriceText(p) : '';
  return `<span class="price ${st.kind}"><b>${fmtEur(st.price)}</b>${st.previous ? `<s aria-label="antes ${esc(fmtEur(st.previous))}">${fmtEur(st.previous)}</s>` : ''}${tag ? `<em class="price-tag">${tag}</em>` : ''}</span>${u ? `<small class="uprice">${esc(u)}</small>` : ''}`;
}

export const newBadge = (p) => (isNewProduct(p) ? '<span class="pill new">Nuevo</span>' : '');

export function stepperHtml(pid, qty, { label = '' } = {}) {
  return `<span class="stepper" role="group" aria-label="Cantidad${label ? ` de ${esc(label)}` : ''}">
    <button type="button" data-dec="${esc(pid)}" aria-label="${qty <= 1 ? 'Quitar de la lista' : 'Una unidad menos'}">${qty <= 1 ? '<span aria-hidden="true">🗑</span>' : '−'}</button>
    <output aria-live="polite">${qty}</output>
    <button type="button" data-inc="${esc(pid)}" aria-label="Una unidad más" ${qty >= 99 ? 'disabled' : ''}>+</button>
  </span>`;
}

/** Tarjeta de «Los de siempre» y «Más productos». */
export function prepCard(p, qty, freq = 0) {
  const sub = p.subsubcategory_name || p.subcategory_name || p.category_name || '';
  return `<article class="pcard${qty ? ' in' : ''}" data-pid="${esc(p.id)}">
    <div class="badges">${newBadge(p)}${availabilityPill(p)}</div>
    <button type="button" class="pcard-img" data-detail="${esc(p.id)}" aria-label="Ver ficha de ${esc(p.name)}">${productImg(p)}</button>
    <div class="pcard-body">
      <h4>${esc(p.name)}</h4>
      <small class="pcat">${esc(sub)}${freq ? ` · ${plural(freq, 'lista', 'listas')}` : ''}</small>
      ${p.format_label ? `<small class="pfmt">${esc(p.format_label)}</small>` : ''}
      <div>${priceHtml(p)}</div>
      <div class="qty">${qty ? stepperHtml(p.id, qty, { label: p.name }) : `<button type="button" class="add-btn" data-inc="${esc(p.id)}" aria-label="Añadir ${esc(p.name)} a la lista">+ Añadir</button>`}</div>
    </div>
  </article>`;
}

/** Fila de «Ya está en la lista»: sumar, restar, eliminar, subtotal y detalle. */
export function listRow(p, qty) {
  const warn = p && p.availability !== 'available';
  return `<div class="li-row${warn ? ' warn' : ''}" data-pid="${esc(p.id)}">
    <button type="button" class="li-img" data-detail="${esc(p.id)}" aria-label="Ver ficha de ${esc(p.name)}">${productImg(p)}</button>
    <button type="button" class="li-name" data-detail="${esc(p.id)}"><b>${esc(p.name)}</b><small>${esc(p.format_label || '')} · ${fmtEur(p.price)}/ud.${warn ? ` · ${esc(AVAIL[p.availability]?.text || '')}` : ''}</small></button>
    <span class="li-sub" aria-label="Subtotal">${fmtEur(itemSubtotal(qty, p.price))}</span>
    ${stepperHtml(p.id, qty, { label: p.name })}
  </div>`;
}

/** Foto cuadrada sin texto (editor de zonas). El nombre está en alt, title y al enfocar. */
export function tileHtml(p, { selected = false, selecting = false } = {}) {
  const manual = S.overrides.has(p.id);
  return `<button type="button" class="tile${selected ? ' selected' : ''}" data-tile="${esc(p.id)}" title="${esc(p.name)}" aria-label="${esc(p.name)}${manual ? ' (zona puesta a mano)' : ''}" ${selecting ? `aria-pressed="${selected}"` : ''}>
    ${productImg(p, { alt: p.name })}
    ${selecting ? `<span class="tile-check" aria-hidden="true">${selected ? '✓' : ''}</span>` : ''}
    ${manual ? '<span class="tile-flag pill grey" aria-hidden="true">✋</span>' : ''}
    <span class="tile-name" aria-hidden="true">${esc(p.name)}</span>
  </button>`;
}

const SOURCE_TEXT = { manual: 'puesta a mano', subcategory: 'por su subcategoría', category: 'por su categoría', auto: 'regla automática (sin confirmar)', unclassified: 'sin clasificar' };

/** Ficha ampliada del producto. extra = HTML adicional (p. ej. controles de zona o de recogida). */
export function openProductDetail(p, { extra = '', requested = null, zoneLine = true } = {}) {
  if (!p) return;
  const z = zoneById(zoneIdOf(p.id));
  const src = S.zoneOf.get(p.id)?.source || 'unclassified';
  const meta = S.overrideMeta.get(p.id);
  $('#pmBody').innerHTML = `
    <div class="grid-2" style="align-items:start">
      <div class="pd-photo">${productImg(p, { size: 'large', eager: true })}</div>
      <div class="pd-info">
        <div class="row">${newBadge(p)}${availabilityPill(p)}</div>
        <h2 id="pmTitle">${esc(p.name)}</h2>
        <div>${priceHtml(p)}</div>
        <div class="kv">
          ${requested != null ? `<div><small>Unidades pedidas</small><b>${requested}</b></div>` : ''}
          <div><small>Formato</small><b>${esc(p.format_label || p.packaging || '—')}</b></div>
          ${p.brand ? `<div><small>Marca</small><b>${esc(p.brand)}</b></div>` : ''}
          <div class="wide"><small>Categoría</small><b>${esc([p.category_name, p.subcategory_name, p.subsubcategory_name].filter(Boolean).join(' › ') || '—')}</b></div>
          ${zoneLine ? `<div class="wide"><small>Zona</small><b>${z ? `${z.route_order} · ${esc(z.name)}` : 'Sin clasificar'} <span class="muted" style="font-size:13px">(${SOURCE_TEXT[src]}${meta && src === 'manual' ? ` por ${esc(profileName(meta.updated_by))} el ${esc(fmtDateTime(meta.updated_at))}` : ''})</span></b></div>` : ''}
        </div>
        ${extra}
        ${p.share_url ? `<p><a href="${esc(p.share_url)}" target="_blank" rel="noopener noreferrer">Ver en la tienda online ↗</a></p>` : ''}
      </div>
    </div>`;
  const modal = $('#productModal');
  modal.querySelector('[data-close]').onclick = () => closeModal(modal);
  modal.onclick = (e) => { if (e.target === modal) closeModal(modal); };
  openModal(modal);
  return modal;
}

/** Panel genérico (resúmenes, formularios). */
export function openPanel(title, html, { onClose } = {}) {
  const modal = $('#panelModal');
  $('#panelTitle').textContent = title;
  $('#panelBody').innerHTML = html;
  modal.querySelector('[data-close]').onclick = () => closeModal(modal);
  modal.onclick = (e) => { if (e.target === modal) closeModal(modal); };
  openModal(modal, { onClose });
  return $('#panelBody');
}
export const closePanel = () => closeModal($('#panelModal'));
