// Pruebas de la lógica pura de la aplicación (zonas, precios, frecuencia, compra, tiempos, cola).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveZone, indexRules, needsZoneQuestion, computeSectionZones, circularNeighbors, nextZoneWithPending, firstZoneWithPending, arrowLabel } from '../../js/core/zones.js';
import { priceState, listTotals, shoppingTotals, unitPriceText, isNewProduct } from '../../js/core/pricing.js';
import { frequencyFromItems, splitZoneBlocks, filterProducts, sortProducts, subcategoriesOf } from '../../js/core/catalog-view.js';
import { deviationPct, compareWithHistory, shopperSummary, purchasesByYear, topMissing, deviationText, averageEvolution } from '../../js/core/stats.js';
import { shouldReplaceResult, mergeResults, normalizeResult, enqueue, isPermanentError } from '../../js/core/queue.js';
import { rotateRect, rectStyle, validShapes } from '../../js/core/map-layout.js';
import { fmtEur, fmtClock, fmtDuration, norm } from '../../js/core/text.js';

const zones = Array.from({ length: 15 }, (_, i) => ({ id: `z${i + 1}`, route_order: i + 1, name: `Zona ${i + 1}`, summary: `Resumen ${i + 1}`, active: true }));
const rules = indexRules([
  { level: 0, external_category_id: 5, zone_id: 'z3', source: 'seed' },      // Panadería
  { level: 1, external_category_id: 66, zone_id: 'z4', source: 'seed' },     // Bollería envasada
  { level: 0, external_category_id: 14, zone_id: 'z7', source: 'seed' },     // Conservas…
  { level: 1, external_category_id: 129, zone_id: 'z1', source: 'seed' },    // …pero Sopa y caldo a la zona 1
  { level: 2, external_category_id: 9001, zone_id: 'z9', source: 'manual' },
  { level: 1, external_category_id: 777, zone_id: 'z8', source: 'auto' },
  { level: 1, external_category_id: 500, zone_id: 'z12', source: 'seed', confirm_manually: true }
]);
const P = (id, cat, sub, sub2 = null, extra = {}) => ({ id, category_id: cat, subcategory_id: sub, subsubcategory_id: sub2, visible_in_app: true, name: id, ...extra });

test('asignación de zona: excepción > subcategoría exacta > categoría > automática > sin clasificar', () => {
  const overrides = new Map([['manual', 'z15']]);
  const ctx = { overrides, rulesIndex: rules };
  assert.deepEqual(pick(resolveZone(P('manual', 5, 66), ctx)), { zoneId: 'z15', source: 'manual' });
  assert.deepEqual(pick(resolveZone(P('bolleria', 5, 66), ctx)), { zoneId: 'z4', source: 'subcategory' });
  assert.deepEqual(pick(resolveZone(P('pan', 5, 59), ctx)), { zoneId: 'z3', source: 'category' });
  assert.deepEqual(pick(resolveZone(P('sub2', 5, 66, 9001), ctx)), { zoneId: 'z9', source: 'subcategory' });
  assert.deepEqual(pick(resolveZone(P('auto', 99, 777), ctx)), { zoneId: 'z8', source: 'auto' });
  assert.deepEqual(pick(resolveZone(P('nada', 99, 98), ctx)), { zoneId: null, source: 'unclassified' });
});
const pick = (r) => ({ zoneId: r.zoneId, source: r.source });

test('solo se pregunta la zona cuando no se puede deducir, es ambigua o se pidió confirmación', () => {
  const ctx = { overrides: new Map(), rulesIndex: rules };
  const products = [P('a', 14, 122), P('b', 14, 129), P('c', 5, 59)];
  const sectionZones = computeSectionZones(products, ctx);
  assert.equal(needsZoneQuestion(P('pan', 5, 59), { ...ctx, sectionZones }), false, 'hereda la zona de su sección');
  assert.equal(needsZoneQuestion(P('bolleria', 5, 66), { ...ctx, sectionZones }), false, 'subcategoría inequívoca');
  assert.equal(needsZoneQuestion(P('x', 99, 98), { ...ctx, sectionZones }), true, 'sin clasificar');
  assert.equal(needsZoneQuestion(P('y', 99, 777), { ...ctx, sectionZones }), true, 'regla automática sin confirmar');
  assert.equal(needsZoneQuestion(P('z', 14, 888), { ...ctx, sectionZones }), true, 'sección repartida en varias zonas');
  assert.equal(needsZoneQuestion(P('w', 26, 500), { ...ctx, sectionZones }), true, 'categoría configurada para confirmar');
  assert.equal(needsZoneQuestion(P('v', 5, 59), { ...ctx, sectionZones, manualConfirmIds: [5] }), true);
});

test('navegación circular entre zonas', () => {
  assert.equal(circularNeighbors(zones, 'z1').prev.id, 'z15');
  assert.equal(circularNeighbors(zones, 'z1').next.id, 'z2');
  assert.equal(circularNeighbors(zones, 'z15').next.id, 'z1');
  const withInactive = zones.map((z) => (z.id === 'z2' ? { ...z, active: false } : z));
  assert.equal(circularNeighbors(withInactive, 'z1').next.id, 'z3', 'salta zonas desactivadas');
  const pending = new Map([['z3', 2], ['z14', 1]]);
  assert.equal(nextZoneWithPending(zones, 'z3', pending).id, 'z14');
  assert.equal(nextZoneWithPending(zones, 'z14', pending).id, 'z3', 'da la vuelta');
  assert.equal(nextZoneWithPending(zones, 'z5', new Map()), null);
  assert.equal(firstZoneWithPending(zones, pending).id, 'z3');
  assert.equal(arrowLabel({ summary: 'Cereales · Yogures · Mantequilla y margarina extra larga' }, 20), 'Cereales · Yogures…');
});

test('precio: normal en verde, promoción declarada y bajada detectada son cosas distintas', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(priceState({ price: '1.20' }, now).kind, 'normal');
  const promo = priceState({ price: '15.95', previous_price: '17.25', price_decreased: true }, now);
  assert.equal(promo.kind, 'promo');
  assert.equal(promo.previous, 17.25);
  const drop = priceState({ price: '2.00', price_before_change: '2.20', price_change_kind: 'decrease', price_changed_at: '2026-10-25T00:00:00Z' }, now);
  assert.equal(drop.kind, 'drop');
  const old = priceState({ price: '2.00', price_before_change: '2.20', price_change_kind: 'decrease', price_changed_at: '2026-09-01T00:00:00Z' }, now);
  assert.equal(old.kind, 'normal', 'la marca de bajada caduca');
  assert.equal(priceState({ price: '2.00', price_before_change: '1.80', price_change_kind: 'increase', price_changed_at: '2026-10-29' }, now).kind, 'normal');
  assert.equal(unitPriceText({ unit_price: 3.45, unit_of_measure: 'L' }), '3,45 €/L');
  assert.equal(isNewProduct({ new_until: '2026-11-05T00:00:00Z' }, now), true);
  assert.equal(isNewProduct({ new_until: null }, now), false);
});

test('precio estimado de la lista y precio final de la compra', () => {
  const byId = new Map([['a', { price: 1.5 }], ['b', { price: 2.25 }], ['c', { price: null }]]);
  assert.deepEqual(listTotals([{ product_id: 'a', quantity: 3 }, { product_id: 'b', quantity: 2 }, { product_id: 'c', quantity: 1 }, { product_id: 'a', quantity: 0 }], byId),
    { products: 3, units: 6, total: 9, unknown: 1 });
  const results = [
    { status: 'collected', requested_qty: 2, collected_qty: 2, price: 1.5 },
    { status: 'partial', requested_qty: 4, collected_qty: 1, price: 2 },
    { status: 'out_of_stock', requested_qty: 3, collected_qty: 0, price: 10 },
    { status: 'pending', requested_qty: 1, collected_qty: 0, price: 5 }
  ];
  const t = shoppingTotals(results, (r) => r.price);
  assert.equal(t.confirmed, 5, 'completo + solo las unidades recogidas del parcial');
  assert.equal(t.pending, 5, 'pendiente aparte');
  assert.equal(t.excluded, 30, 'sin existencias excluido');
  assert.equal(t.done, false);
  assert.equal(shoppingTotals(results.slice(0, 3), (r) => r.price).done, true);
});

test('frecuencia por listas distintas (nunca por unidades) y bloques sin repetir', () => {
  const rows = [
    { list_id: 'L1', product_id: 'leche', quantity: 3 },
    { list_id: 'L2', product_id: 'leche', quantity: 1 },
    { list_id: 'L2', product_id: 'pan', quantity: 10 },
    { list_id: 'L3', product_id: 'leche', quantity: 2 }
  ];
  const freq = frequencyFromItems(rows);
  assert.equal(freq.get('leche'), 3);
  assert.equal(freq.get('pan'), 1, '10 unidades en una lista = 1 aparición');
  const prods = ['leche', 'pan', 'agua', 'sal'].map((id) => ({ id, name: id }));
  const b = splitZoneBlocks(prods, new Map([['agua', 2]]), freq);
  assert.deepEqual(b.inList.map((p) => p.id), ['agua']);
  assert.deepEqual(b.frequent.map((p) => p.id), ['leche', 'pan'], 'de mayor a menor frecuencia');
  assert.deepEqual(b.more.map((p) => p.id).sort(), ['agua', 'sal'], '«Más productos» no repite los frecuentes');
});

test('búsqueda, filtros y orden', () => {
  const list = [
    { id: 1, name: 'Leche entera', price: 0.9, subcategory_id: 72, subcategory_name: 'Leche', first_seen_at: '2026-01-01' },
    { id: 2, name: 'Zumo de naranja', price: 1.5, subcategory_id: 143, subcategory_name: 'Naranja', first_seen_at: '2026-10-01', price_decreased: true, previous_price: 1.8 },
    { id: 3, name: 'Leche desnatada', price: 0.8, subcategory_id: 72, subcategory_name: 'Leche', first_seen_at: '2026-05-01' }
  ];
  assert.deepEqual(filterProducts(list, { q: 'léche ENT' }).map((p) => p.id), [1]);
  assert.deepEqual(filterProducts(list, { subcategory: 72 }).map((p) => p.id), [1, 3]);
  assert.deepEqual(filterProducts(list, { promo: true }).map((p) => p.id), [2]);
  assert.deepEqual(sortProducts(list, 'price').map((p) => p.id), [3, 1, 2]);
  assert.deepEqual(sortProducts(list, 'new').map((p) => p.id), [2, 3, 1]);
  assert.deepEqual(sortProducts(list, 'alpha').map((p) => p.id), [3, 1, 2]);
  assert.deepEqual(subcategoriesOf(list).map((s) => [s.name, s.count]), [['Leche', 2], ['Naranja', 1]]);
});

test('tiempos: desviación frente a la media ANTERIOR', () => {
  assert.equal(deviationPct(2700, 1800), 50);
  assert.equal(deviationPct(1500, null), null);
  const r = compareWithHistory(2700, [1800, 1800]);
  assert.equal(r.deviation, 50);
  assert.equal(r.previousAvg, 1800);
  assert.equal(Math.round(r.newAvg), 2100, 'la media se actualiza después de comparar');
  assert.equal(compareWithHistory(1000, []).enoughData, false);
  assert.equal(deviationText(null), 'Todavía no hay datos suficientes');
  assert.match(deviationText(-12.5), /menos que su media/);
  const sessions = [
    { shopper_profile_id: 'papa', status: 'completed', duration_seconds: 1800, ended_at: '2026-01-10T10:00:00Z', deviation_pct: null },
    { shopper_profile_id: 'papa', status: 'completed', duration_seconds: 2400, ended_at: '2026-02-10T10:00:00Z', deviation_pct: 33.33 },
    { shopper_profile_id: 'papa', status: 'completed', duration_seconds: 1200, ended_at: '2026-02-20T10:00:00Z', deviation_pct: -42.86 },
    { shopper_profile_id: 'mama', status: 'completed', duration_seconds: 1500, ended_at: '2025-12-01T10:00:00Z' }
  ];
  const s = shopperSummary(sessions, 'papa');
  assert.equal(s.total, 3);
  assert.equal(s.best, 1200);
  assert.equal(s.last, 1200);
  assert.deepEqual(s.lastThree, [1200, 2400, 1800]);
  assert.equal(s.lastDeviation, -42.86);
  assert.deepEqual(purchasesByYear(sessions), { 2026: { papa: 3 }, 2025: { mama: 1 } });
  assert.deepEqual(averageEvolution(sessions, 'papa').map((x) => x.key), ['2026-01', '2026-02']);
  assert.deepEqual(topMissing([{ status: 'out_of_stock', product_id: 'x' }, { status: 'out_of_stock', product_id: 'x' }, { status: 'collected', product_id: 'y' }]), [{ product_id: 'x', times: 2 }]);
});

test('cola sin conexión: estados finales mandan y se fusionan cambios', () => {
  const at = (m) => new Date(Date.UTC(2026, 9, 30, 10, m)).toISOString();
  assert.equal(shouldReplaceResult({ status: 'collected', resolved_at: at(5) }, { status: 'pending' }), false, 'nunca vuelve a pendiente');
  assert.equal(shouldReplaceResult({ status: 'pending' }, { status: 'out_of_stock', resolved_at: at(1) }), true);
  assert.equal(shouldReplaceResult({ status: 'collected', resolved_at: at(5) }, { status: 'partial', resolved_at: at(3) }), false, 'gana el más reciente');
  assert.equal(shouldReplaceResult({ status: 'collected', resolved_at: at(5) }, { status: 'partial', resolved_at: at(7) }), true);
  const merged = mergeResults([{ list_item_id: 'a', status: 'collected', resolved_at: at(5) }, { list_item_id: 'b', status: 'pending' }],
    [{ list_item_id: 'a', status: 'pending' }, { list_item_id: 'b', status: 'out_of_stock', resolved_at: at(6) }]);
  assert.deepEqual(merged.map((r) => r.status), ['collected', 'out_of_stock']);
  assert.deepEqual(pickR(normalizeResult({ status: 'partial', collected_qty: 5 }, 3)), ['collected', 3]);
  assert.deepEqual(pickR(normalizeResult({ status: 'partial', collected_qty: 0 }, 3)), ['out_of_stock', 0]);
  let q = [];
  q = enqueue(q, { id: 'op1', kind: 'draft', target: 'L', payload: { changes: [{ product_id: 'a', quantity: 1 }] } });
  q = enqueue(q, { id: 'op2', kind: 'draft', target: 'L', payload: { changes: [{ product_id: 'a', quantity: 3 }, { product_id: 'b', quantity: 1 }] } });
  assert.equal(q.length, 1, 'se agrupan en una sola operación idempotente');
  assert.deepEqual(q[0].payload.changes, [{ product_id: 'a', quantity: 3 }, { product_id: 'b', quantity: 1 }]);
  q = enqueue(q, { id: 'op3', kind: 'results', target: 'S', payload: { results: [{ list_item_id: 'x', status: 'collected', resolved_at: at(2) }] } });
  q = enqueue(q, { id: 'op4', kind: 'results', target: 'S', payload: { results: [{ list_item_id: 'x', status: 'pending' }] } });
  assert.equal(q[1].payload.results[0].status, 'collected');
  assert.equal(isPermanentError({ code: 'P0001', message: 'lista_no_editable' }), true);
  assert.equal(isPermanentError({ message: 'Failed to fetch' }), false);
});
const pickR = (r) => [r.status, r.collected_qty];

test('mapa: giro de 90° para móvil y formas válidas', () => {
  assert.deepEqual(rotateRect({ x: 1, y: 1, w: 15, h: 12 }), { x: 39, y: 1, w: 12, h: 15, r: 0 });
  assert.deepEqual(rotateRect({ x: 50, y: 1, w: 50, h: 3 }), { x: 48, y: 50, w: 3, h: 50, r: 0 });
  assert.match(rectStyle({ x: 38, y: 6, w: 21, h: 3, r: 20 }), /--rot:20deg/);
  assert.equal(validShapes([{ x: 1, y: 1, w: 2, h: 2 }]), true);
  assert.equal(validShapes([{ x: 0, y: 1, w: 2, h: 2 }]), false);
});

test('formatos', () => {
  assert.equal(fmtEur(3.5).replace(/\s/g, ' '), '3,50 €');
  assert.equal(fmtClock(3725), '1:02:05');
  assert.equal(fmtClock(65), '01:05');
  assert.equal(fmtDuration(1830), '30 min 30 s');
  assert.equal(norm('  Cuidado FACIAL  y corporal '), 'cuidado facial y corporal');
});
