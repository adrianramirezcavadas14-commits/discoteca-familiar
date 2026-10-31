/* =====================================================================
   Zonas del supermercado: asignación de productos y recorrido.
   Misma prioridad que compra.zone_for_product() en Supabase:
     1. excepción manual del producto
     2. asignación exacta de subcategoría (nivel 2 y después nivel 1)
     3. asignación de categoría (nivel 0, la sección)
     4. regla automática (por nombre, pendiente de confirmar)
     5. producto sin clasificar
   ===================================================================== */

export const UNCLASSIFIED = '__sin_zona__';

/** Índice de reglas: "nivel:idCategoría" → regla */
export function indexRules(rules = []) {
  const m = new Map();
  for (const r of rules) m.set(`${r.level}:${r.external_category_id}`, r);
  return m;
}

/** Resultado: { zoneId|null, source: 'manual'|'subcategory'|'category'|'auto'|'unclassified', rule } */
export function resolveZone(product, { overrides = new Map(), rulesIndex = new Map() } = {}) {
  if (!product) return { zoneId: null, source: 'unclassified', rule: null };
  const ov = overrides.get(product.id);
  if (ov) return { zoneId: ov, source: 'manual', rule: null };
  const firm = [], auto = [];
  for (const [level, cat] of [[2, product.subsubcategory_id], [1, product.subcategory_id], [0, product.category_id]]) {
    if (cat == null) continue;
    const r = rulesIndex.get(`${level}:${cat}`);
    if (!r) continue;
    (r.source === 'auto' ? auto : firm).push(r);
  }
  const rule = firm[0] || auto[0] || null;
  if (!rule || !rule.zone_id) return { zoneId: null, source: 'unclassified', rule };
  return { zoneId: rule.zone_id, source: rule.source === 'auto' ? 'auto' : (rule.level === 0 ? 'category' : 'subcategory'), rule };
}

/** Zonas posibles para un producto según todas sus reglas (para detectar ambigüedad). */
export function candidateZones(product, rulesIndex = new Map()) {
  const out = new Set();
  for (const [level, cat] of [[2, product.subsubcategory_id], [1, product.subcategory_id], [0, product.category_id]]) {
    const r = cat != null ? rulesIndex.get(`${level}:${cat}`) : null;
    if (r?.zone_id) out.add(r.zone_id);
  }
  return [...out];
}

/**
 * ¿Hay que preguntar a la familia en qué zona está un producto nuevo?
 * Solo si no se puede deducir, si hay varias zonas posibles o si la categoría pide confirmación.
 */
export function needsZoneQuestion(product, { overrides, rulesIndex, manualConfirmIds = [], sectionZones = new Map() } = {}) {
  const res = resolveZone(product, { overrides, rulesIndex });
  if (res.source === 'manual') return false;
  if (!res.zoneId || res.source === 'auto' || res.source === 'unclassified') return true;
  const manual = new Set(manualConfirmIds.map(Number));
  if ([product.category_id, product.subcategory_id, product.subsubcategory_id].some((c) => c != null && manual.has(Number(c)))) return true;
  if (res.rule?.confirm_manually) return true;
  // Varias zonas posibles: el producto solo hereda la zona de la sección, pero esa sección
  // está repartida entre varias zonas (p. ej. «Conservas, caldos y cremas» → zonas 7 y 1).
  if (res.source === 'category' && (sectionZones.get(product.category_id)?.size || 0) > 1) return true;
  return false;
}

/** Sección → conjunto de zonas en las que acaban sus productos (para detectar secciones repartidas). */
export function computeSectionZones(products, ctx) {
  const m = new Map();
  for (const p of products) {
    if (p.category_id == null || !p.visible_in_app) continue;
    const { zoneId } = resolveZone(p, ctx);
    if (!zoneId) continue;
    if (!m.has(p.category_id)) m.set(p.category_id, new Set());
    m.get(p.category_id).add(zoneId);
  }
  return m;
}

/** Zonas ordenadas por recorrido. */
export const byRoute = (zones) => [...zones].sort((a, b) => a.route_order - b.route_order);

/** Anterior y siguiente con navegación circular (de la 15 a la 1 y de la 1 a la 15). */
export function circularNeighbors(zones, currentId, { onlyActive = true } = {}) {
  const list = byRoute(zones).filter((z) => !onlyActive || z.active !== false || z.id === currentId);
  if (!list.length) return { prev: null, next: null, index: -1 };
  const i = list.findIndex((z) => z.id === currentId);
  if (i < 0) return { prev: list[list.length - 1], next: list[0], index: -1 };
  return { prev: list[(i - 1 + list.length) % list.length], next: list[(i + 1) % list.length], index: i };
}

/** Siguiente zona (en orden circular, empezando después de la actual) que tiene algo pendiente. */
export function nextZoneWithPending(zones, currentId, pendingByZone) {
  const list = byRoute(zones);
  const has = (z) => (pendingByZone.get(z.id) || 0) > 0;
  if (!list.length) return null;
  const i = list.findIndex((z) => z.id === currentId);
  for (let k = 1; k <= list.length; k++) {
    const z = list[(Math.max(i, -1) + k + list.length) % list.length];
    if (has(z)) return z;
  }
  return null;
}

/** Primera zona del recorrido con productos pendientes. */
export function firstZoneWithPending(zones, pendingByZone) {
  return byRoute(zones).find((z) => (pendingByZone.get(z.id) || 0) > 0) || null;
}

/** Texto corto de la flecha: «Zona 2 · Cereales · Yogures…» */
export function arrowLabel(zone, max = 34) {
  if (!zone) return '';
  const s = zone.summary || zone.name || '';
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
