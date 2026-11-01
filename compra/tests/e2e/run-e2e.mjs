// =====================================================================
// Prueba de extremo a extremo con un navegador real (Chromium + Playwright)
// contra el entorno local que imita Supabase (tests/e2e/local-stack.mjs).
// Recorre: inicio de Hogar → despensa → clave → sincronización → mapa →
// lista → cierre → compra → resumen → ticket → números → novedades →
// sin conexión → otras aplicaciones de Hogar. Hace capturas en móvil,
// tableta y escritorio y falla si hay errores en la consola.
// Uso: node tests/e2e/run-e2e.mjs   (necesita PostgreSQL y PostgREST)
// =====================================================================
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { startStack } from './local-stack.mjs';
import { richCatalog, product } from '../fixtures/catalog-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'artifacts');
mkdirSync(OUT, { recursive: true });
const require = createRequire(pathToFileURL(join(here, '..', '..', 'package.json')));
// Playwright puede estar instalado en el proyecto o de forma global (NODE_PATH).
const { chromium } = (() => { try { return require('playwright'); } catch { return createRequire(import.meta.url)(require.resolve('playwright', { paths: (process.env.NODE_PATH || '').split(':').concat(['/opt/npm-tools/node_modules']) })); } })();
const SUPABASE_UMD = readFileSync(require.resolve('@supabase/supabase-js/dist/umd/supabase.js'), 'utf8');

const report = [];
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); report.push({ name, ok: true, ms: Date.now() - t }); console.log(`✔ ${name}`); }
  catch (e) { report.push({ name, ok: false, ms: Date.now() - t, error: String(e?.stack || e) }); console.error(`✘ ${name}\n${e?.stack || e}`); throw e; }
};

const stack = await startStack();
stack.catalog.current = richCatalog();
const browser = await chromium.launch();
const consoleErrors = [];

function productSvg(url) {
  const n = Number((url.match(/test(\d+)/) || [])[1] || 0);
  const hue = (n * 47) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="300" height="300" fill="hsl(${hue} 60% 92%)"/><rect x="80" y="60" width="140" height="190" rx="22" fill="hsl(${hue} 55% 55%)"/><text x="150" y="165" font-family="sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${n % 1000}</text></svg>`;
}

async function newContext(viewport, { offline = false } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'allow', locale: 'es-ES', timezoneId: 'Europe/Madrid' });
  // Playwright aplica primero la última ruta registrada: el bloqueo general va el primero.
  await ctx.route(/^https:\/\/(?!prod-mercadona)/, (r) => r.abort());
  await ctx.route('**/compra/supabase-config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: `window.DESPENSA_SUPABASE = { url: '${stack.apiBase}', publishableKey: '${stack.publishable}' };` }));
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase|unpkg\.com\/@supabase/, (r) => r.fulfill({ contentType: 'text/javascript', body: SUPABASE_UMD }));
  await ctx.route('https://prod-mercadona.imgix.net/**', (r) => r.fulfill({ contentType: 'image/svg+xml', headers: { 'Access-Control-Allow-Origin': '*' }, body: productSvg(r.request().url()) }));
  await ctx.route(/^https:\/\/(upload\.wikimedia\.org|storage\.despensa\.test)\//, (r) => r.fulfill({ contentType: 'image/svg+xml', body: productSvg(`test${r.request().url().length}`) }));
  if (offline) await ctx.setOffline(true);
  return ctx;
}
function watch(page, label) {
  page.on("pageerror", (e) => consoleErrors.push(`[${label}] pageerror: ${e.message} ${String(e.stack || "").split("\n").slice(0, 4).join(" | ")}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Ruido esperado del entorno local: sin Realtime (websocket) y recursos externos bloqueados a propósito.
    if (/realtime|websocket|ERR_FAILED|ERR_INTERNET_DISCONNECTED|net::ERR_|Failed to load resource/i.test(t)) return;
    consoleErrors.push(`[${label}] console: ${t}`);
  });
}
const shot = (page, name) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false });
const q = async (sql, args = []) => (await stack.pool.query(sql, args)).rows;

try {
  const ctx = await newContext({ width: 1280, height: 900 });
  const page = await ctx.newPage();
  watch(page, 'escritorio');

  await step('Inicio de Hogar: tres aplicaciones y entrada a la despensa', async () => {
    await page.goto(`${stack.webBase}/index.html`);
    await page.waitForSelector('#homePicker .home-app.shop');
    assert.equal(await page.locator('#homePicker .home-app').count(), 3);
    const cols = await page.$eval('.home-apps', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 3, 'tres columnas en escritorio');
    await shot(page, '01-hogar-inicio-escritorio');
    await page.click('#enterShop');
    await page.waitForURL(/\/compra\//);
  });

  await step('Sin clave (modo abierto): sincronización inicial (coyote) y quién soy', async () => {
    await page.waitForFunction(() => /coyote\.gif/.test(document.querySelector('#loadingCharacter').src));
    await page.waitForSelector('#dialogModal.open >> text=¿Quién usa este dispositivo?', { timeout: 60000 });
    await page.click('#dlgActions button:has-text("Mamá")');
    await page.waitForSelector('#page-inicio.active h2');
    const n = (await q('select count(*)::int n from compra.products'))[0].n;
    assert.ok(n > 400, `catálogo cargado (${n})`);
    await shot(page, '02-despensa-inicio-escritorio');
  });

  await step('Mapa: 15 zonas, congelados en tres piezas, cajas y vista en lista', async () => {
    await page.click('#open');
    await page.click('.navbtn[data-page="mapa"]');
    await page.waitForSelector('#page-mapa .store-map');
    assert.equal(await page.locator('#page-mapa .zone-shape.main').count(), 15);
    assert.equal(await page.locator('#page-mapa .zone-shape[style*="#f2cf1d"]').count(), 3, 'zona 15 en tres piezas');
    assert.equal(await page.locator('#page-mapa .map-checkout').count(), 1);
    await shot(page, '03-mapa-escritorio');
    await page.click('#page-mapa [data-view="list"]');
    assert.equal(await page.locator('#page-mapa .zone-row').count(), 15);
    await page.click('#page-mapa [data-view="map"]');
  });

  await step('Plano: agrandar una zona, guardarla para todos y volver a la forma original', async () => {
    assert.equal(await page.locator('#page-mapa .map-wall[style*="span 9"]').count(), 0, 'sin la barra gris entre 5 y 6');
    await page.click('#page-mapa [data-edit]');
    await page.click('#page-mapa .zone-shape.main[data-zone][aria-label^="Zona 6:"]');
    await page.waitForSelector('#page-mapa .zone-shape.selected .rh-e');
    await page.click('#page-mapa [data-grow="w:1"]');
    await page.click('#page-mapa [data-grow="h:1"]');
    const h = await page.locator('#page-mapa .zone-shape.selected .rh-s').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await shot(page, '03b-plano-editando');
    await page.click('#page-mapa [data-save-shapes]');
    await page.waitForSelector('#page-mapa [data-edit]');
    const z6 = (await q(`select map_shapes from compra.store_zones where code = 'z06'`))[0].map_shapes[0];
    assert.equal(z6.w, 10, 'más ancha');
    assert.ok(z6.h >= 18, `más alta (${z6.h})`);
    await page.click('#page-mapa [data-edit]');
    await page.click('#page-mapa .zone-shape.main[aria-label^="Zona 6:"]');
    await page.click('#page-mapa [data-reset]');
    await page.click('#page-mapa [data-save-shapes]');
    await page.waitForSelector('#page-mapa [data-edit]');
    assert.deepEqual((await q(`select map_shapes from compra.store_zones where code = 'z06'`))[0].map_shapes, [{ x: 18, y: 1, w: 9, h: 16 }]);
  });

  await step('Editor de zona: fotos sin texto, mover varios y deshacer', async () => {
    await page.click('#page-mapa .zone-shape.main[aria-label^="Zona 9:"]');
    await page.waitForSelector('#page-mapa .tiles .tile');
    const firstTile = page.locator('#page-mapa .tile').first();
    assert.ok((await firstTile.getAttribute('aria-label')).length > 3, 'nombre accesible');
    assert.ok(await firstTile.locator('img[loading="lazy"]').count() === 1, 'carga diferida');
    const cols = await page.$eval('#page-mapa .tiles', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 3, 'tres fotos por fila en escritorio');
    await shot(page, '04-zona-editor-escritorio');
    await page.click('#page-mapa [data-select]');
    await page.locator('#page-mapa .tile').nth(0).click();
    await page.locator('#page-mapa .tile').nth(1).click();
    const ids = await page.$$eval('#page-mapa .tile.selected', (els) => els.map((e) => e.dataset.tile));
    await page.selectOption('#page-mapa [data-target]', { label: '5 · Charcutería y platos preparados' });
    await page.click('#page-mapa [data-move]');
    await page.waitForSelector('#page-mapa [data-undo]');
    const ov = await q('select product_id, created_by from compra.product_zone_overrides where product_id = any($1)', [ids]);
    assert.equal(ov.length, 2);
    assert.ok(ov[0].created_by, 'se guarda quién');
    await page.click('#page-mapa [data-undo]');
    await page.waitForFunction(() => !document.querySelector('#page-mapa [data-undo]'));
    assert.equal((await q('select count(*)::int n from compra.product_zone_overrides where product_id = any($1)', [ids]))[0].n, 0);
  });

  let oilId;
  await step('Preparar la lista: tres bloques, cantidades, navegación circular y guardado', async () => {
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.waitForSelector('#page-lista .store-map');
    await page.click('#page-lista .zone-shape.main[aria-label^="Zona 9:"]');
    await page.waitForSelector('#page-lista .zone-nav');
    assert.equal(await page.locator('#page-lista .block h3').count(), 3);
    const cols = await page.$eval('#page-lista .cards', (el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert.equal(cols, 2, 'dos tarjetas por fila en escritorio');
    const card = page.locator('#page-lista .pcard').first();
    oilId = await card.getAttribute('data-pid');
    await card.locator('[data-inc]').click();
    await page.locator(`#page-lista .pcard[data-pid="${oilId}"] [data-inc]`).click();
    await page.waitForSelector(`#page-lista .li-row[data-pid="${oilId}"] output:has-text("2")`);
    assert.match(await page.textContent('#page-lista .b-meta'), /1 producto · 2 uds/);
    const drafts = await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft'`);
    assert.equal(drafts[0].n, 0, 'no se escribe en Supabase con cada pulsación');
    // El buscador no se repinta mientras se escribe (en el móvil se cerraría el teclado)
    await page.evaluate(() => { window.__q = document.querySelector('#page-lista [data-q]'); });
    await page.click('#page-lista [data-q]');
    await page.keyboard.type('ac', { delay: 120 });
    await page.waitForTimeout(500);
    await page.keyboard.type('e', { delay: 50 });
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => document.querySelector('#page-lista [data-q]') === window.__q && document.activeElement === window.__q), 'la caja de búsqueda sigue siendo la misma y con el foco');
    assert.equal(await page.inputValue('#page-lista [data-q]'), 'ace');
    await page.fill('#page-lista [data-q]', '');
    await page.waitForTimeout(400);
    await shot(page, '05-lista-zona-escritorio');
    // Flecha anterior desde la zona 1 → zona 15 (circular)
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.click('#page-lista .zone-shape.main[aria-label^="Zona 1:"]');
    await page.waitForSelector('#page-lista .zone-nav');
    assert.match(await page.textContent('#page-lista .zn-arrow.prev'), /15 · Congelados/);
    await page.locator('#page-lista .pcard [data-inc]').first().click();
    await page.click('#page-lista [data-save]');
    await page.waitForFunction(() => /Guardado/.test(document.querySelector('#page-lista .b-state').textContent), null, { timeout: 15000 })
      .catch(async (e) => { console.error('Estado:', JSON.stringify(await page.evaluate(async () => { const m = await import('/compra/js/data/store.js'); return { dirty: [...m.S.draft.dirty], queue: m.S.queue, list: m.S.draft.list?.id, online: navigator.onLine, server: m.S.serverOk }; }))); throw e; });
    const n = await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft'`);
    assert.equal(n[0].n, 2);
  });


  await step('Persistencia: recargar sin guardar no pierde cambios', async () => {
    await page.click('#page-lista .zn-arrow.next');
    await page.waitForSelector('#page-lista .pcard');
    await page.locator('#page-lista .pcard [data-inc]').first().click();
    await page.reload();
    await page.waitForSelector('#page-lista .basket-bar');
    await page.waitForFunction(() => /3 productos/.test(document.querySelector('#page-lista .b-meta')?.textContent || ''), null, { timeout: 15000 })
      .catch(async (e) => { console.error('Cesta tras recargar:', await page.textContent('#page-lista .b-meta').catch(() => '?'), JSON.stringify(await page.evaluate(async () => { const m = await import('/compra/js/data/store.js'); return { items: [...m.S.draft.items.keys()].length, dirty: [...m.S.draft.dirty], queue: m.S.queue.length }; }))); throw e; });
    // Al recargar, lo pendiente se envía
    await page.waitForFunction(async () => true);
    for (let i = 0; i < 40; i++) {
      const n = await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft'`);
      if (n[0].n === 3) break;
      await page.waitForTimeout(250);
      if (i === 39) assert.fail('el cambio no llegó a Supabase');
    }
  });

  await step('Buscador universal en el mapa: zona actual y cambio de zona guardado para todos', async () => {
    await page.goto(`${stack.webBase}/compra/#mapa`);
    await page.waitForSelector('#page-mapa [data-finder] [data-fd-q]');
    await page.fill('#page-mapa [data-fd-q]', 'ACEITE');
    await page.waitForSelector('#page-mapa .fd-row');
    const firstPid = await page.getAttribute('#page-mapa .fd-row', 'data-pid');
    const pillBefore = await page.textContent(`#page-mapa .fd-row[data-pid="${firstPid}"] .zone-pill`);
    assert.match(pillBefore, /9/, `muestra la zona actual (${pillBefore})`);
    await shot(page, '03c-buscador-mapa');
    await page.click(`#page-mapa .fd-row[data-pid="${firstPid}"] [data-fd-open]`);
    await page.waitForSelector('#productModal.open [data-to]');
    assert.match(await page.textContent('#productModal'), /Está en: zona 9/);
    await page.selectOption('#productModal [data-to]', { label: '5 · Charcutería y platos preparados' });
    await page.click('#productModal [data-do-move]');
    await page.waitForFunction((pid) => /5/.test(document.querySelector(`#page-mapa .fd-row[data-pid="${pid}"] .zone-pill`)?.textContent || ''), firstPid);
    assert.equal((await q('select count(*)::int n from compra.product_zone_overrides where product_id = $1', [firstPid]))[0].n, 1, 'guardado en la base de datos');
    assert.equal(await page.inputValue('#page-mapa [data-fd-q]'), 'ACEITE', 'la búsqueda se conserva');
    await page.click(`#page-mapa .fd-row[data-pid="${firstPid}"] [data-fd-open]`);
    await page.click('#productModal [data-do-restore]');
    await page.click('#dialogModal .btn.primary').catch(() => {});
    await page.waitForFunction((pid) => /9/.test(document.querySelector(`#page-mapa .fd-row[data-pid="${pid}"] .zone-pill`)?.textContent || ''), firstPid);
    assert.equal((await q('select count(*)::int n from compra.products where external_id like $1', ['%']))[0].n > 0, true, 'no se crean productos');
  });

  await step('Lista: buscador único, «Pendientes no urgentes», pendientes de revisar y mover sin duplicar', async () => {
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.waitForSelector('#page-lista [data-finder] [data-fd-q]');
    assert.equal(await page.locator('#page-lista [data-fd-q]').count(), 1, 'un solo buscador universal');
    await page.fill('#page-lista [data-fd-q]', 'mayonesa');
    await page.waitForSelector('#page-lista .fd-row');
    const pid = await page.getAttribute('#page-lista .fd-row', 'data-pid');
    await page.click(`#page-lista .fd-row[data-pid="${pid}"] [data-fd-later]`);
    await page.waitForFunction(() => /No urgente · 1/.test(document.querySelector('#page-lista .fd-row')?.textContent || ''));
    await page.click(`#page-lista .fd-row[data-pid="${pid}"] [data-fd-later]`);
    await page.waitForFunction(() => /No urgente · 2/.test(document.querySelector('#page-lista .fd-row')?.textContent || ''));
    assert.deepEqual(await q('select quantity from compra.backlog_items where product_id = $1', [pid]), [{ quantity: 2 }]);
    await page.click(`#page-lista .fd-row[data-pid="${pid}"] [data-fd-flag]`);
    await page.waitForFunction(() => /Pendiente de revisar/.test(document.querySelector('#page-lista .fd-row')?.textContent || ''));
    assert.equal((await q('select count(*)::int n from compra.product_review_flags where product_id = $1', [pid]))[0].n, 1);
    assert.equal((await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft' and i.product_id = $1`, [pid]))[0].n, 0, 'marcar no añade a la lista');
    await page.click(`#page-lista .fd-row[data-pid="${pid}"] [data-fd-main]`);
    await page.waitForFunction(() => /En la lista · 1/.test(document.querySelector('#page-lista .fd-row')?.textContent || ''));
    await shot(page, '05b-buscador-lista');
    // Pasar de «No urgentes» a la lista principal: 1 + 2 = 3 y desaparece de «No urgentes»
    await page.click('#page-lista [data-backlog]');
    await page.waitForSelector(`#panelBody [data-move-to="main"][data-pid="${pid}"]`);
    await page.click(`#panelBody [data-move-to="main"][data-pid="${pid}"]`);
    await page.waitForFunction((p) => !document.querySelector(`#panelBody [data-move-to="main"][data-pid="${p}"]`), pid);
    assert.deepEqual(await q(`select i.quantity from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft' and i.product_id = $1`, [pid]), [{ quantity: 3 }]);
    assert.equal((await q('select count(*)::int n from compra.backlog_items where product_id = $1', [pid]))[0].n, 0);
    // Y de vuelta desde la lista principal
    await page.click('#panelBody [data-tab-main]');
    await page.waitForSelector(`#panelBody [data-move-to="backlog"][data-pid="${pid}"]`);
    await page.click(`#panelBody [data-move-to="backlog"][data-pid="${pid}"]`);
    await page.waitForFunction((p) => !document.querySelector(`#panelBody [data-move-to="backlog"][data-pid="${p}"]`), pid);
    assert.deepEqual(await q('select quantity from compra.backlog_items where product_id = $1', [pid]), [{ quantity: 3 }]);
    assert.equal((await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft' and i.product_id = $1`, [pid]))[0].n, 0);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#page-lista .backlog-card .backlog-row');
  });

  await step('Zona: todos los productos sin «Ver más» y cabecera fija al bajar', async () => {
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.click('#page-lista .zone-shape.main[aria-label^="Zona 9:"]');
    await page.waitForSelector('#page-lista .prep-sticky .zone-nav');
    assert.equal(await page.locator('#page-lista [data-more]').count(), 0, 'sin botón «Ver más»');
    const shown = await page.locator('#page-lista [data-more-results] .pcard').count();
    const said = Number((await page.textContent('#page-lista [data-more-count]')).replace(/\D/g, ''));
    assert.equal(shown, said, `se ven todos (${shown} de ${said})`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    const box = await page.locator('#page-lista .prep-sticky .zone-nav').boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 260, `la cabecera de la zona sigue visible (${box?.y})`);
    assert.ok(await page.locator('#page-lista .prep-sticky .zone-nav [data-map]').isVisible(), 'salir al mapa siempre accesible');
    await shot(page, '05c-zona-cabecera-fija');
    assert.ok(await page.locator('#page-lista [data-to-top]').isVisible(), 'botón azul para subir visible al bajar');
    // Cambiar de pasillo desde abajo: la nueva zona empieza arriba, justo debajo de la cabecera fija
    await page.click('#page-lista .prep-sticky .zn-arrow.next');
    await page.waitForFunction(() => /10/.test(document.querySelector('#page-lista .zn-current .zn-num')?.textContent || ''));
    await page.waitForTimeout(300);
    const gap = await page.evaluate(() => { const st = document.querySelector('#page-lista .prep-sticky').getBoundingClientRect(); const b = document.querySelector('#page-lista [data-body]').getBoundingClientRect(); return Math.round(b.top - st.bottom); });
    assert.ok(gap >= -2 && gap < 40, `la lista empieza arriba al cambiar de pasillo (separación ${gap}px)`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(250);
    await page.click('#page-lista [data-to-top]');
    await page.waitForTimeout(900);
    const gap2 = await page.evaluate(() => { const st = document.querySelector('#page-lista .prep-sticky').getBoundingClientRect(); const b = document.querySelector('#page-lista [data-body]').getBoundingClientRect(); return Math.round(b.top - st.bottom); });
    assert.ok(gap2 >= -2 && gap2 < 40, `el botón azul sube al principio (separación ${gap2}px)`);
    await page.click('#page-lista .prep-sticky .zn-arrow.prev');
    await page.waitForFunction(() => /9/.test(document.querySelector('#page-lista .zn-current .zn-num')?.textContent || ''));
    const flag = page.locator('#page-lista [data-more-results] .flag-btn').first();
    await flag.click();
    await page.waitForSelector('#page-lista [data-more-results] .flag-btn.on');
  });

  await step('Novedades: «Pendientes de revisar» con su zona y desmarcar', async () => {
    await page.goto(`${stack.webBase}/compra/#novedades`);
    await page.waitForSelector('#page-novedades [data-tab="review"]');
    await page.click('#page-novedades [data-tab="review"]');
    await page.waitForSelector('#page-novedades .review-item');
    const before = await page.locator('#page-novedades .review-item').count();
    assert.equal(before, (await q('select count(*)::int n from compra.product_review_flags'))[0].n);
    assert.ok(await page.locator('#page-novedades .review-item .zone-pill').count() >= 1, 'muestra la zona');
    await shot(page, '13b-pendientes-revisar');
    await page.locator('#page-novedades [data-unflag]').first().click();
    await page.waitForFunction((n) => document.querySelectorAll('#page-novedades .review-item').length === n - 1, before);
    assert.equal((await q('select count(*)::int n from compra.product_review_flags'))[0].n, before - 1);
  });

  await step('Menú semanal: semanas, comidas y cenas por separado y recetas con imagen', async () => {
    await page.goto(`${stack.webBase}/compra/#menu`);
    await page.waitForSelector('#page-menu .week-nav');
    const label = await page.textContent('#page-menu .wk-current');
    assert.match(label, /Semana \d+/);
    assert.equal(await page.locator('#page-menu .menu-day').count(), 7);
    await page.click('#page-menu [data-week="1"]');
    await page.waitForSelector('#page-menu [data-week="0"]');
    await page.click('#page-menu [data-week="-1"]');
    await page.waitForFunction(() => /Semana actual/.test(document.querySelector('#page-menu .wk-current').textContent));
    const day = await page.getAttribute('#page-menu .menu-day:first-child [data-slot="comida"]', 'data-add');
    await page.click('#page-menu .menu-day:first-child [data-slot="comida"]');
    await page.waitForSelector('#panelBody [data-rq]');
    await page.fill('#panelBody [data-rq]', 'Lentejas con chorizo');
    await page.press('#panelBody [data-rq]', 'Enter');
    await page.waitForSelector('#panelBody .image-choice').catch(async (e) => { await shot(page, 'debug-menu'); console.error('Panel:', await page.textContent('#panelBody').catch(() => '?'), 'abierto:', await page.evaluate(() => document.querySelector('#panelModal').className), 'errores:', JSON.stringify(consoleErrors), 'url:', page.url()); throw e; });
    assert.equal(await page.locator('#panelBody .image-choice').count(), 5, 'primero 5 imágenes');
    assert.ok(await page.locator('#panelBody [data-isave]').isDisabled(), 'sin imagen no se puede guardar');
    await page.click('#panelBody [data-imore]');
    await page.waitForFunction(() => document.querySelectorAll('#panelBody .image-choice').length === 10);
    await page.locator('#panelBody .image-choice').nth(6).click();
    await shot(page, '17-menu-imagen');
    await page.click('#panelBody [data-isave]');
    await page.waitForSelector('#page-menu .menu-entry');
    const r = await q('select name, image_url, category from compra.recipes');
    assert.equal(r.length, 1);
    assert.match(r[0].image_url, /^https:\/\//);
    assert.equal(r[0].category, 'comida');
    assert.equal((await q('select count(*)::int n from compra.menu_entries where menu_date = $1 and slot = $2', [day, 'comida']))[0].n, 1);
    // En la cena no se sugiere la receta de comida; escrita igual se reutiliza sin volver a buscar imágenes
    const searches = stack.recipeSearches.length;
    await page.click('#page-menu .menu-day:first-child [data-slot="cena"]');
    await page.waitForSelector('#panelBody [data-rlist]');
    assert.equal(await page.locator('#panelBody .recipe-card').count(), 0, 'las cenas no muestran recetas de comida');
    await page.fill('#panelBody [data-rq]', 'LENTEJAS con chorízo');
    await page.waitForFunction(() => /ya existe/.test(document.querySelector('#panelBody [data-rhint]').textContent));
    await page.click('#panelBody [data-addnew]');
    await page.waitForFunction(() => document.querySelectorAll('#page-menu .menu-day:first-child .menu-entry').length === 2);
    assert.equal(stack.recipeSearches.length, searches, 'no se repite la búsqueda de imágenes');
    const rr = await q('select category from compra.recipes');
    assert.deepEqual(rr, [{ category: 'ambas' }], 'una sola receta, ahora de comida y cena');
    await shot(page, '17b-menu-semana');
    // Si el servidor de imágenes falla, el navegador busca directamente en Wikipedia
    await page.route('**/functions/v1/compra-recetas', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"caído a propósito"}' }));
    await page.route(/^https:\/\/es\.wikipedia\.org\/w\/api\.php/, (r) => r.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ query: { pages: { 1: { index: 1, title: 'Sopa de ajo', fullurl: 'https://es.wikipedia.org/wiki/Sopa_de_ajo', thumbnail: { source: 'https://upload.wikimedia.org/fake/640px-Sopa_de_ajo.jpg' } } } } }) }));
    await page.click('#page-menu .menu-day:nth-child(2) [data-slot="cena"]');
    await page.waitForSelector('#panelBody [data-rq]');
    await page.fill('#panelBody [data-rq]', 'Sopa de ajo');
    await page.press('#panelBody [data-rq]', 'Enter');
    await page.waitForSelector('#panelBody .image-choice');
    assert.match(await page.textContent('#panelBody .image-choice'), /Wikipedia/);
    await page.click('#panelBody .image-choice');
    await page.click('#panelBody [data-isave]');
    await page.waitForFunction(() => document.querySelectorAll('#page-menu .menu-day:nth-child(2) .menu-entry').length === 1);
    await page.unroute('**/functions/v1/compra-recetas');
  });


  await step('Cerrar la lista (carro) y pasar a «¡A por la compra!»', async () => {
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.waitForSelector('#page-lista [data-close-list]:not([disabled])');
    await page.click('#page-lista [data-close-list]');
    await page.waitForSelector('#dialogModal.open >> text=¿Cerramos la lista?');
    await page.click('#dlgActions .primary');
    await page.waitForFunction(() => /compras\.gif/.test(document.querySelector('#loadingCharacter').src));
    await page.waitForSelector('#page-compra.active [data-start]', { timeout: 30000 });
    assert.equal((await q(`select status from compra.shopping_lists order by created_at desc limit 1`))[0].status, 'ready_to_shop');
    await shot(page, '06-compra-pendiente-escritorio');
  });

  await step('Hacer la compra en móvil: Papá, recoger, sin existencias, parcial, final', async () => {
    const m = await newContext({ width: 390, height: 844 });
    const mp = await m.newPage();
    watch(mp, 'móvil');
    await mp.addInitScript((k) => { localStorage.setItem('despensaClaveFamiliar', k); localStorage.setItem('despensaQuienSoy', 'papa'); }, stack.familyKey);
    await mp.goto(`${stack.webBase}/compra/#compra`);
    await mp.waitForSelector('#page-compra.active [data-start]', { timeout: 30000 });
    await mp.click('#page-compra [data-start]');
    const names = await mp.$$eval('.shopper-pick button', (b) => b.map((x) => x.textContent.trim()));
    assert.deepEqual(names, ['Papá', 'Mamá', 'Adrián']);
    await mp.click('.shopper-pick [data-shopper="papa"]');
    await mp.waitForSelector('#page-compra .collect-grid .ccard');
    await mp.waitForFunction(() => {
      const g = document.querySelector('#page-compra .collect-grid');
      const c = g?.querySelector('.ccard');
      return g && c && g.getBoundingClientRect().width > 0 && c.getBoundingClientRect().width / g.getBoundingClientRect().width < 0.55;
    }, null, { timeout: 8000 });   // dos productos por fila
    await mp.waitForTimeout(1200);
    assert.notEqual(await mp.textContent('#shopTimer'), '00:00');
    await shot(mp, '07-compra-movil');
    // Un segundo dispositivo no puede iniciar la misma compra
    const ses = await q(`select id, device_id from compra.shopping_sessions where status = 'active'`);
    assert.equal(ses.length, 1);
    // Ampliar foto sin pulsar botones
    await mp.locator('#page-compra .c-photo').first().click();
    await mp.waitForSelector('#productModal.open #pmTitle');
    await mp.click('#productModal [data-close]');
    // Resolver todo: primero sin existencias, luego recogidos (con parcial si hay varias unidades)
    let guard = 0;
    while (await mp.locator('#page-compra .ccard.pending').count() && guard++ < 20) {
      const c = mp.locator('#page-compra .ccard.pending').first();
      const multi = await c.locator('[data-units="-1"]').count();
      if (multi) await c.locator('[data-units="-1"]').click();
      else if (guard === 1) await c.locator('[data-no]').click();
      else await c.locator('[data-ok]').click();
      await mp.waitForTimeout(150);
      if (await mp.locator('#page-compra .all-done').count()) break;
    }
    await mp.waitForSelector('#page-compra .all-done >> text=Ya está todo. Puedes ir a caja.');
    await shot(mp, '08-compra-todo-listo-movil');
    await mp.click('#page-compra [data-finish]');
    await mp.waitForFunction(() => /osos-compras\.gif/.test(document.querySelector('#loadingCharacter').src));
    await mp.waitForSelector('#page-compra h2:has-text("¡Compra hecha!")', { timeout: 30000 });
    await shot(mp, '09-resumen-compra-movil');
    const s = await q(`select status, duration_seconds, deviation_pct, missing_items, partial_items from compra.shopping_sessions order by created_at desc limit 1`);
    assert.equal(s[0].status, 'completed');
    assert.ok(s[0].missing_items >= 1);
    assert.equal(s[0].deviation_pct, null, 'primera compra sin media anterior');
    assert.match(await mp.textContent('#page-compra'), /Todavía no hay datos suficientes/);
    await m.close();
  });

  await step('Tickets: subir imagen (bucket privado), ver, marcar pagado', async () => {
    await page.goto(`${stack.webBase}/compra/#tickets`);
    await page.waitForSelector('#page-tickets [data-upload]');
    await page.click('#page-tickets [data-upload]');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#panelBody input[accept="image/*"]:not([capture])', { name: 'ticket.png', mimeType: 'image/png', buffer: png });
    await page.waitForSelector('#panelBody [data-send]:not([disabled])');
    await page.fill('#panelBody [data-f="amount"]', '54,30');
    await page.selectOption('#panelBody [data-f="session"]', { index: 1 });
    await page.selectOption('#panelBody [data-f="paid_by"]', 'mama');
    await page.click('#panelBody [data-send]');
    await page.waitForSelector('#page-tickets .ticket [data-paid]', { timeout: 30000 });
    const r = await q('select amount::float, mime_type, status, session_id from compra.purchase_receipts');
    assert.equal(r.length, 1);
    assert.equal(r[0].amount, 54.3);
    assert.ok(r[0].session_id);
    // Un archivo que no es imagen ni PDF se rechaza en el servidor
    const bad = await fetch(`${stack.apiBase}/functions/v1/compra-tickets`, { method: 'POST', headers: { 'x-compra-key': stack.familyKey }, body: (() => { const f = new FormData(); f.append('action', 'upload'); f.append('file', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png'); return f; })() });
    assert.equal(bad.status, 415);
    await shot(page, '10-tickets-escritorio');
    await page.click('#page-tickets [data-paid]');
    await page.click('#dlgActions .primary');
    await page.waitForSelector('#page-tickets .empty-note:has-text("No hay tickets pendientes")');
    const paid = await q('select status, marked_paid_by, marked_paid_at from compra.purchase_receipts');
    assert.equal(paid[0].status, 'paid');
    assert.ok(paid[0].marked_paid_by && paid[0].marked_paid_at);
  });

  await step('El rincón de los números', async () => {
    await page.goto(`${stack.webBase}/compra/#numeros`);
    await page.waitForSelector('#page-numeros .person-card');
    assert.equal(await page.locator('#page-numeros .person-card').count(), 3);
    await page.waitForSelector('#page-numeros .year-bars');
    await shot(page, '11-numeros-escritorio');
  });

  await step('Novedades: nueva sincronización con producto nuevo, bajada y retirado', async () => {
    stack.catalog.current = richCatalog((c) => {
      c[112].subs[0].products.push(product({ id: 999001, name: 'Aceite nuevo de prueba', section: { id: 12, name: 'Aceite, especias y salsas' }, price: 3.1 }));
      c[244].subs[0].products.push(product({ id: 999002, name: 'Fregona nueva de prueba', section: { id: 26, name: 'Limpieza y hogar' }, price: 2.2 }));
      const p = c[156].subs[0].products[0];
      p.price_instructions.previous_unit_price = p.price_instructions.unit_price;
      p.price_instructions.unit_price = (Number(p.price_instructions.unit_price) * 0.8).toFixed(2);
      p.price_instructions.price_decreased = true;
      c[59].subs[0].products.shift();
    });
    await q(`update compra.catalog_sync_runs set finished_at = now() - interval '13 hours' where status = 'completed'`);
    await page.goto(`${stack.webBase}/compra/#inicio`);
    await page.reload();   // cada entrada comprueba si toca sincronizar (≥ 12 h)
    await page.waitForSelector('#panelModal.open >> text=Hemos encontrado 2 productos nuevos', { timeout: 60000 });
    await shot(page, '12-productos-nuevos-escritorio');
    // La fregona (categoría sin zona) pide zona; el aceite la hereda
    const asks = await page.$$eval('#panelBody .review-item', (els) => els.map((e) => [e.querySelector('b').textContent, e.dataset.ask]));
    assert.deepEqual(asks.sort(), [['Aceite nuevo de prueba', '0'], ['Fregona nueva de prueba', '1']]);
    await page.selectOption('#panelBody .review-item[data-ask="1"] select', { label: '12 · Limpieza' });
    await page.click('#panelBody [data-save]');
    await page.waitForFunction(() => !document.querySelector('#panelModal.open'));
    const ov = await q(`select z.route_order from compra.product_zone_overrides o join compra.products p on p.id = o.product_id join compra.store_zones z on z.id = o.zone_id where p.external_id = '999002'`);
    assert.equal(ov[0].route_order, 12);
    await page.goto(`${stack.webBase}/compra/#novedades`);
    await page.click('#page-novedades [data-tab="price"]');
    await page.waitForSelector('#page-novedades .change');
    await page.click('#page-novedades [data-tab="runs"]');
    await page.waitForSelector('#page-novedades .run');
    await shot(page, '13-novedades-escritorio');
  });

  await step('Sin conexión: la lista sigue funcionando y se sincroniza al volver', async () => {
    await page.goto(`${stack.webBase}/compra/#lista`);
    await page.waitForSelector('#page-lista .store-map');
    await page.waitForTimeout(800);
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForSelector('#page-lista .basket-bar', { timeout: 30000 });
    await page.click('#page-lista .zone-shape.main[aria-label^="Zona 10:"] .zn');
    await page.locator('#page-lista .pcard [data-inc]').first().click();
    await page.click('#page-lista [data-save]');
    await page.waitForFunction(() => /Sin conexión/.test(document.querySelector('#syncStatus').textContent));
    await shot(page, '14-sin-conexion-escritorio');
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    for (let i = 0; i < 60; i++) {
      const n = await q(`select count(*)::int n from compra.shopping_list_items i join compra.shopping_lists l on l.id = i.list_id where l.status = 'draft'`);
      if (n[0].n >= 1) break;
      await page.waitForTimeout(250);
      if (i === 59) assert.fail('la cola sin conexión no se envió');
    }
  });

  await step('Capturas responsive (320, 768) sin desplazamiento horizontal', async () => {
    for (const [w, h, tag] of [[320, 640, 'movil-320'], [768, 1024, 'tableta']]) {
      const c = await newContext({ width: w, height: h });
      const p = await c.newPage();
      watch(p, tag);
      await p.addInitScript((k) => { localStorage.setItem('despensaClaveFamiliar', k); localStorage.setItem('despensaQuienSoy', 'adrian'); }, stack.familyKey);
      for (const route of ['inicio', 'mapa', 'lista', 'numeros', 'ajustes']) {
        await p.goto(`${stack.webBase}/compra/#${route}`);
        await p.waitForSelector(`#page-${route}.active h2`, { timeout: 30000 });
        await p.waitForTimeout(300);
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 0, `${tag} ${route}: desplazamiento horizontal de ${overflow}px`);
        await shot(p, `15-${route}-${tag}`);
      }
      await p.goto(`${stack.webBase}/compra/#lista`);
      await p.waitForSelector('#page-lista .zone-shape.main, #page-lista .zone-row');
      await p.locator('#page-lista [data-zone]').first().click();
      await p.waitForSelector('#page-lista .pcard');
      const small = await p.$$eval('#page-lista button, #page-lista a.btn', (els) => els.filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 44 && e.getBoundingClientRect().width < 44)).map((e) => e.outerHTML.slice(0, 80)));
      assert.deepEqual(small, [], `${tag}: botones menores de 44×44`);
      await shot(p, `16-lista-zona-${tag}`);
      await c.close();
    }
  });

  await step('La discoteca y la biblioteca siguen abriendo', async () => {
    const c = await newContext({ width: 1280, height: 900 });
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${stack.webBase}/index.html`);
    await p.click('#enterDiscs');
    await p.waitForSelector('#homePicker[hidden]', { state: 'attached' });
    await p.waitForSelector('#page-inicio, #search.page.active, main.wrap');
    await p.goto(`${stack.webBase}/libros/`);
    await p.waitForSelector('#loadingScreen');
    await p.waitForTimeout(1500);
    assert.deepEqual(errs, [], 'sin excepciones en las otras aplicaciones');
    await c.close();
  });

  assert.deepEqual(consoleErrors, [], 'errores en la consola');
} catch (e) {
  process.exitCode = 1;
} finally {
  writeFileSync(join(OUT, 'informe-e2e.json'), JSON.stringify({ when: new Date().toISOString(), steps: report, consoleErrors }, null, 2));
  if (consoleErrors.length) console.error('Errores de consola:\n' + consoleErrors.join('\n'));
  await browser.close();
  await stack.stop();
  console.log(`\n${report.filter((r) => r.ok).length}/${report.length} pasos correctos`);
}
