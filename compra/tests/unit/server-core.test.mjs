// Pruebas del adaptador del catálogo, reintentos con espera y validación de tickets (código de las funciones Edge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProduct, extractProducts, parseCategoriesRoot, fetchJsonWithRetry, backoffMs, formatLabel, createDataniaProvider, createMercadonaApiProvider, detailFields, CatalogFetchError } from '../../supabase/functions/_shared/catalog-core.js';
import { isStale } from '../../supabase/functions/_shared/sync-engine.js';
import { sniffMime, validateTicketFile, ticketPath, parseAmount, parseDate } from '../../supabase/functions/_shared/tickets-core.js';
import { corsHeaders, timingSafeEqual, cleanText } from '../../supabase/functions/_shared/http.js';
import { baseCatalog, product, SECTIONS } from '../fixtures/catalog-fixtures.mjs';

test('árbol de categorías y productos con la estructura real de la API', () => {
  const cat = baseCatalog();
  const plan = parseCategoriesRoot(cat.root);
  assert.ok(plan.find((c) => c.id === 66 && c.sectionId === 5));
  const rows = extractProducts(cat.categories[112], { section: { id: 12 }, source: 'mercadona-api' });
  assert.equal(rows.length, 3);
  const oil = rows.find((r) => r.external_id === '4241');
  assert.equal(oil.category_id, 12);
  assert.equal(oil.subcategory_id, 112);
  assert.equal(oil.subsubcategory_id, 420);
  assert.equal(oil.subsubcategory_name, 'Aceite de oliva');
  assert.equal(oil.price, 17.25);
  assert.equal(oil.unit_price, 3.45);
  assert.equal(oil.format_label, 'Garrafa 5 L');
  assert.match(oil.image_url, /h=600&w=600/);
  assert.throws(() => parseCategoriesRoot({ results: [] }), CatalogFetchError);
});

test('normalización defensiva: promociones solo si la fuente las declara y el precio baja', () => {
  const p = product({ id: 1, name: '  Leche   entera ', section: SECTIONS.aceite, price: 1, decreased: true, previous: 1.2 });
  const r = normalizeProduct(p, { category: { id: 72, name: 'Leche' }, source: 'x' });
  assert.equal(r.name, 'Leche entera');
  assert.equal(r.price_decreased, true);
  const weird = normalizeProduct({ ...p, price_instructions: { ...p.price_instructions, previous_unit_price: '0.50', price_decreased: true } }, { category: { id: 72 } });
  assert.equal(weird.price_decreased, false, 'un «precio anterior» menor no es una promoción');
  assert.equal(normalizeProduct({ id: '../x', display_name: 'a' }, {}), null, 'identificador no válido');
  assert.equal(normalizeProduct({ id: '5', display_name: 'Sin EAN raro', ean: 'ABC' }, {}).ean, null);
  const future = normalizeProduct({ ...p, unavailable_from: '2099-01-01' }, { category: { id: 1 } });
  assert.equal(future.unavailable, false);
  const past = normalizeProduct({ ...p, unavailable_from: '2020-01-01' }, { category: { id: 1 } });
  assert.equal(past.unavailable, true);
  assert.equal(formatLabel('Paquete', { is_pack: true, total_units: 6, pack_size: 0.2, size_format: 'l' }), 'Paquete 6 x 0,2 L');
  assert.deepEqual(detailFields({ id: 1, ean: '8480000100054', brand: 'Hacendado', details: { description: 'Desc' }, photos: [{ regular: 'https://x.imgix.net/a.jpg' }] }),
    { ean: '8480000100054', brand: 'Hacendado', description: 'Desc', image_url: 'https://x.imgix.net/a.jpg', detail_fetched: true });
});

test('reintentos con espera exponencial; sin reintentar bloqueos 4xx', async () => {
  const waits = [];
  let calls = 0;
  const flaky = async () => { calls++; return calls < 3 ? new Response('x', { status: 503 }) : Response.json({ id: 1, categories: [] }); };
  const data = await fetchJsonWithRetry(flaky, 'https://a/b', { retries: 4, sleepImpl: async (ms) => waits.push(ms), random: () => 0.5 });
  assert.equal(data.id, 1);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
  calls = 0;
  await assert.rejects(fetchJsonWithRetry(async () => { calls++; return new Response('no', { status: 403 }); }, 'https://a', { sleepImpl: async () => {} }), /HTTP 403/);
  assert.equal(calls, 1, 'un 403 no se insiste');
  const ra = [];
  let n = 0;
  await fetchJsonWithRetry(async () => (++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '7' } }) : Response.json({ results: [1] })), 'https://a', { sleepImpl: async (ms) => ra.push(ms) });
  assert.deepEqual(ra, [7000], 'respeta Retry-After');
  assert.equal(backoffMs(10, 1000, 30000, () => 0.5), 30000, 'con tope');
});

test('URLs de los dos proveedores', async () => {
  const seen = [];
  const f = async (url) => { seen.push(url); return Response.json({ id: 66, categories: [] }); };
  await createMercadonaApiProvider({ fetchImpl: f, warehouse: 'mad1' }).fetchCategory(66);
  await createDataniaProvider({ fetchImpl: f }).fetchCategory(66);
  assert.equal(seen[0], 'https://tienda.mercadona.es/api/categories/66/?lang=es&wh=mad1');
  assert.equal(seen[1], 'https://huggingface.co/datasets/datania/mercadona-catalog/resolve/main/categories/66.json');
});

test('sincronización caducada a partir de 12 horas (nunca menos)', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  assert.equal(isStale(null, 12, now), true);
  assert.equal(isStale('2026-10-30T01:00:00Z', 12, now), false);
  assert.equal(isStale('2026-10-29T23:59:00Z', 12, now), true);
  assert.equal(isStale('2026-10-30T06:00:00Z', 2, now), false, 'el mínimo es 12 h');
});

test('tickets: tipo real por contenido, tamaño, ruta única e importes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  const html = new TextEncoder().encode('<html><script>');
  assert.equal(sniffMime(png), 'image/png');
  assert.equal(sniffMime(pdf), 'application/pdf');
  assert.equal(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(html), null);
  assert.equal(validateTicketFile(html, 'image/png').ok, false);
  assert.equal(validateTicketFile(png, 'application/pdf').ok, false, 'el tipo declarado debe coincidir');
  assert.equal(validateTicketFile(new Uint8Array(11 * 1024 * 1024), 'image/png').ok, false);
  assert.deepEqual(validateTicketFile(pdf, 'application/pdf'), { ok: true, mime: 'application/pdf', ext: 'pdf', size: pdf.length });
  const p = ticketPath('00000000-0000-4000-8000-000000000001', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'jpg', new Date('2026-10-30'));
  assert.equal(p, '00000000-0000-4000-8000-000000000001/2026/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg');
  assert.throws(() => ticketPath('../etc', 'x', 'jpg'));
  assert.equal(parseAmount('54,30 €'), 54.3);
  assert.ok(Number.isNaN(parseAmount('-3')));
  assert.equal(parseAmount(''), null);
  assert.equal(parseDate('2026-10-30'), '2026-10-30');
  assert.ok(Number.isNaN(parseDate('30/10/2026')));
});

test('CORS con la cabecera de la clave familiar, comparación constante y limpieza de texto', () => {
  const req = new Request('https://x', { headers: { origin: 'https://familia.github.io' } });
  const h = corsHeaders(req, 'https://familia.github.io');
  assert.match(h['Access-Control-Allow-Headers'], /x-compra-key/);
  assert.equal(h['Access-Control-Allow-Origin'], 'https://familia.github.io');
  assert.equal(corsHeaders(new Request('https://x', { headers: { origin: 'https://otra.web' } }), 'https://familia.github.io')['Access-Control-Allow-Origin'], 'https://familia.github.io');
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(cleanText('  hola\u0000  mundo  '), 'hola mundo');
});
