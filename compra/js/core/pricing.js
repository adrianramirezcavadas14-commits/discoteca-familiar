/* =====================================================================
   Precios: estado (normal, promoción declarada, bajada detectada),
   totales de la lista y precio final estimado de la compra.
   ===================================================================== */
import { DROP_BADGE_DAYS, NEW_BADGE_DAYS } from '../config.js';

const n = (v) => (v == null || v === '' ? null : Number(v));
const DAY = 86400000;

/**
 * kind:
 *  · 'promo'  → la fuente declara una bajada (price_decreased + precio anterior)
 *  · 'drop'   → bajada detectada por nuestra sincronización (sin promoción declarada)
 *  · 'normal' → precio normal
 * No se asume que toda bajada sea una promoción.
 */
export function priceState(p, now = Date.now()) {
  const price = n(p?.price);
  if (price == null) return { kind: 'unknown', price: null, previous: null, label: 'Sin precio' };
  const prev = n(p.previous_price);
  if (p.price_decreased && prev != null && prev > price) {
    return { kind: 'promo', price, previous: prev, label: 'Promoción', diff: price - prev, pct: ((price - prev) / prev) * 100 };
  }
  const before = n(p.price_before_change);
  const at = p.price_changed_at ? new Date(p.price_changed_at).getTime() : NaN;
  if (p.price_change_kind === 'decrease' && before != null && before > price && !Number.isNaN(at) && now - at <= DROP_BADGE_DAYS * DAY) {
    return { kind: 'drop', price, previous: before, label: 'Bajada de precio', diff: price - before, pct: ((price - before) / before) * 100 };
  }
  return { kind: 'normal', price, previous: null, label: 'Precio normal' };
}

export const isNewProduct = (p, now = Date.now()) => {
  if (!p) return false;
  if (p.new_until) return new Date(p.new_until).getTime() > now;
  return false;
};
export const isOnOffer = (p, now = Date.now()) => ['promo', 'drop'].includes(priceState(p, now).kind);

/** Precio por unidad de medida: «3,45 €/L» */
export function unitPriceText(p) {
  const v = n(p?.unit_price);
  if (v == null || !p.unit_of_measure) return '';
  return `${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €/${p.unit_of_measure}`;
}

/** Totales del borrador o de la lista: items = [{product_id, quantity}], precio actual del catálogo local. */
export function listTotals(items, productsById) {
  let units = 0, total = 0, unknown = 0;
  for (const it of items) {
    const q = Math.max(0, Number(it.quantity) || 0);
    if (!q) continue;
    units += q;
    const price = n(it.unit_price_snapshot) ?? n(productsById.get(it.product_id)?.price);
    if (price == null) unknown++;
    else total += q * price;
  }
  return { products: items.filter((i) => Number(i.quantity) > 0).length, units, total: round2(total), unknown };
}

export const itemSubtotal = (quantity, price) => round2((Number(quantity) || 0) * (n(price) ?? 0));

/**
 * Precio final estimado durante la compra:
 *  · recogido completo → unidades recogidas
 *  · parcial           → solo las unidades recogidas
 *  · sin existencias   → excluido
 *  · pendiente         → aparte, como estimación no confirmada
 */
export function shoppingTotals(results, priceOf) {
  let confirmed = 0, pending = 0, excluded = 0;
  const count = { pending: 0, collected: 0, partial: 0, out_of_stock: 0 };
  for (const r of results) {
    const price = n(priceOf(r)) ?? 0;
    count[r.status] = (count[r.status] || 0) + 1;
    if (r.status === 'collected' || r.status === 'partial') confirmed += (Number(r.collected_qty) || 0) * price;
    else if (r.status === 'pending') pending += (Number(r.requested_qty) || 0) * price;
    else excluded += (Number(r.requested_qty) || 0) * price;
  }
  return { confirmed: round2(confirmed), pending: round2(pending), excluded: round2(excluded), count, done: count.pending === 0 && results.length > 0 };
}

export function round2(v) {
  return Math.round((Number(v) + Number.EPSILON) * 100) / 100;
}

export { NEW_BADGE_DAYS };
