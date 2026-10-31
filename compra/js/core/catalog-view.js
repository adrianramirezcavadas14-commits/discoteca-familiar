/* =====================================================================
   Productos de una zona: «Ya está en la lista», «Los de siempre» y
   «Más productos» (sin repetir los frecuentes), búsqueda, filtros y orden.
   ===================================================================== */
import { norm, collator } from './text.js';
import { isOnOffer } from './pricing.js';

/**
 * Frecuencia = número de LISTAS COMPLETADAS distintas en las que apareció.
 * rows: [{ list_id, product_id, quantity }] de listas completadas. No se suman unidades.
 */
export function frequencyFromItems(rows) {
  const lists = new Map();
  for (const r of rows) {
    if (!lists.has(r.product_id)) lists.set(r.product_id, new Set());
    lists.get(r.product_id).add(r.list_id);
  }
  return new Map([...lists].map(([pid, set]) => [pid, set.size]));
}

/**
 * products: productos visibles de la zona · inList: Map(productId → cantidad) · freq: Map(productId → nº listas)
 * Devuelve { inList, frequent, more } · frequent ordenado por nº de listas (desc) y luego por nombre.
 */
export function splitZoneBlocks(products, inList, freq, { frequentLimit = 24 } = {}) {
  const listed = products.filter((p) => (inList.get(p.id) || 0) > 0).sort((a, b) => collator.compare(a.name, b.name));
  const frequent = products
    .filter((p) => (freq.get(p.id) || 0) > 0)
    .sort((a, b) => (freq.get(b.id) - freq.get(a.id)) || collator.compare(a.name, b.name))
    .slice(0, frequentLimit);
  const freqIds = new Set(frequent.map((p) => p.id));
  const more = products.filter((p) => !freqIds.has(p.id));
  return { inList: listed, frequent, more };
}

/** Texto de búsqueda precalculado (nombre, formato, categorías, marca). */
export const haystack = (p) => norm([p.name, p.format_label, p.packaging, p.brand, p.category_name, p.subcategory_name, p.subsubcategory_name].filter(Boolean).join(' '));

export function filterProducts(list, { q = '', subcategory = null, promo = false, now = Date.now() } = {}) {
  const words = norm(q).split(' ').filter(Boolean);
  return list.filter((p) => {
    if (subcategory != null && String(p.subcategory_id) !== String(subcategory) && String(p.subsubcategory_id) !== String(subcategory)) return false;
    if (promo && !isOnOffer(p, now)) return false;
    if (!words.length) return true;
    const h = p._hay || haystack(p);
    return words.every((w) => h.includes(w));
  });
}

export function sortProducts(list, mode = 'alpha') {
  const arr = [...list];
  const price = (p) => (p.price == null ? Infinity : Number(p.price));
  if (mode === 'price') arr.sort((a, b) => price(a) - price(b) || collator.compare(a.name, b.name));
  else if (mode === 'price-desc') arr.sort((a, b) => price(b) - price(a) || collator.compare(a.name, b.name));
  else if (mode === 'new') arr.sort((a, b) => (new Date(b.first_seen_at || 0) - new Date(a.first_seen_at || 0)) || collator.compare(a.name, b.name));
  else arr.sort((a, b) => collator.compare(a.name, b.name));
  return arr;
}

/** Subcategorías presentes (para el filtro): [{ id, name, count }] */
export function subcategoriesOf(list) {
  const m = new Map();
  for (const p of list) {
    const id = p.subcategory_id;
    if (id == null) continue;
    const cur = m.get(id) || { id, name: p.subcategory_name || String(id), count: 0 };
    cur.count++;
    m.set(id, cur);
  }
  return [...m.values()].sort((a, b) => collator.compare(a.name, b.name));
}

/** Carga progresiva: primeras «page × size» posiciones. */
export const pageSlice = (list, page, size) => list.slice(0, Math.max(1, page) * size);
