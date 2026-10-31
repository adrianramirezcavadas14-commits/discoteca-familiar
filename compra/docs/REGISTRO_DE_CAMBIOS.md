# Registro de archivos modificados y añadidos

## Archivos existentes modificados (2)

Las copias de los originales están en `compra/copias-de-seguridad/`. Para deshacer la integración basta con volver a poner esos dos archivos (la carpeta `compra/` no afecta a nada más).

### `index.html` (raíz) → copia: `compra/copias-de-seguridad/index.html.bak`

Tres cambios, nada más:

1. Tercera tarjeta en la pantalla «¿A qué rincón de casa quieres entrar?», justo después de la biblioteca:
   `<button class="home-app shop" id="enterShop">… Nuestra despensa familiar · La compra de la semana, zona a zona</button>`
2. Un bloque `<style>` pequeño antes de `</head>`: icono verde de la despensa y tres columnas a partir de 651 px (en móvil siguen apiladas, como antes).
3. En el script final: `document.getElementById('enterShop').addEventListener('click',()=>{location.href='./compra/'});`

La discoteca, sus datos, su menú y sus funciones no se tocan.

### `service-worker.js` (raíz) → copia: `compra/copias-de-seguridad/service-worker.js.bak`

1. `CACHE`: `hogar-v7f-autores-20261028` → `hogar-v8-despensa-20261030` (para que los móviles reciban la versión nueva; las cachés antiguas de Hogar se borran solas como hasta ahora).
2. Lista `CORE`: se añaden los archivos de `compra/` (HTML, CSS, módulos JS, icono y el GIF de entrada) para abrir la despensa sin cobertura.
3. Página sin conexión: las rutas `/compra/` devuelven `compra/index.html` (antes solo se distinguía `/libros/`).

El resto (red primero para HTML/JS/CSS, caché primero para GIF, sin tocar Supabase ni dominios externos) sigue igual.

## Archivos añadidos

Todo lo nuevo vive en `compra/`:

- `compra/.env.example`
- `compra/.gitignore`
- `compra/README.md`
- `compra/compras.gif`
- `compra/copias-de-seguridad/index.html.bak`
- `compra/copias-de-seguridad/service-worker.js.bak`
- `compra/coyote.gif`
- `compra/docs/ANALISIS_Y_PLAN.md`
- `compra/docs/DESPLIEGUE.md`
- `compra/docs/INFORME_DE_PRUEBAS.md`
- `compra/docs/INSTALACION.md`
- `compra/docs/MANTENIMIENTO.md`
- `compra/docs/REGISTRO_DE_CAMBIOS.md`
- `compra/docs/capturas/01-hogar-inicio-escritorio.png`
- `compra/docs/capturas/03-mapa-escritorio.png`
- `compra/docs/capturas/05-lista-zona-escritorio.png`
- `compra/docs/capturas/07-compra-movil.png`
- `compra/docs/capturas/08-compra-todo-listo-movil.png`
- `compra/docs/capturas/12-productos-nuevos-escritorio.png`
- `compra/docs/capturas/15-mapa-movil-320.png`
- `compra/docs/capturas/16-lista-zona-movil-320.png`
- `compra/docs/mapa-referencia.png`
- `compra/img/icono-despensa.svg`
- `compra/index.html`
- `compra/js/app.js`
- `compra/js/config.js`
- `compra/js/core/catalog-view.js`
- `compra/js/core/map-layout.js`
- `compra/js/core/pricing.js`
- `compra/js/core/queue.js`
- `compra/js/core/stats.js`
- `compra/js/core/text.js`
- `compra/js/core/zones.js`
- `compra/js/data/api.js`
- `compra/js/data/idb.js`
- `compra/js/data/store.js`
- `compra/js/pages/changes.js`
- `compra/js/pages/home.js`
- `compra/js/pages/map-page.js`
- `compra/js/pages/prepare.js`
- `compra/js/pages/settings.js`
- `compra/js/pages/shop.js`
- `compra/js/pages/stats.js`
- `compra/js/pages/tickets.js`
- `compra/js/ui/cards.js`
- `compra/js/ui/dom.js`
- `compra/js/ui/map.js`
- `compra/js/ui/nav.js`
- `compra/js/ui/review.js`
- `compra/js/ui/sync.js`
- `compra/osos-compras.gif`
- `compra/package-lock.json`
- `compra/package.json`
- `compra/styles.css`
- `compra/supabase-config.js`
- `compra/supabase/config.toml`
- `compra/supabase/functions/_shared/catalog-core.js`
- `compra/supabase/functions/_shared/db-supabase.js`
- `compra/supabase/functions/_shared/http.js`
- `compra/supabase/functions/_shared/sync-engine.js`
- `compra/supabase/functions/_shared/sync-handler.js`
- `compra/supabase/functions/_shared/tickets-core.js`
- `compra/supabase/functions/_shared/tickets-handler.js`
- `compra/supabase/functions/compra-sync/index.ts`
- `compra/supabase/functions/compra-tickets/index.ts`
- `compra/supabase/migrations/20261030120000_compra_esquema.sql`
- `compra/supabase/migrations/20261030120100_compra_seguridad.sql`
- `compra/supabase/migrations/20261030120200_compra_funciones.sql`
- `compra/supabase/migrations/20261030120300_compra_datos_iniciales.sql`
- `compra/tests/e2e/deno-edge-check.mjs`
- `compra/tests/e2e/deno-serve-port.ts`
- `compra/tests/e2e/local-stack.mjs`
- `compra/tests/e2e/run-e2e.mjs`
- `compra/tests/fixtures/catalog-fixtures.mjs`
- `compra/tests/lint.mjs`
- `compra/tests/sql/00_entorno_local_supabase.sql`
- `compra/tests/sql/catalog-sync.test.mjs`
- `compra/tests/sql/helpers.mjs`
- `compra/tests/sql/rpc-rls.test.mjs`
- `compra/tests/unit/core.test.mjs`
- `compra/tests/unit/offline-store.test.mjs`
- `compra/tests/unit/server-core.test.mjs`
- `compra/tools/generar-config.mjs`

`compra/node_modules/` (solo para pruebas) y `compra/tests/e2e/artifacts/` (capturas) están en `compra/.gitignore` y no hace falta subirlos.

## Fuera del alcance (documentado, sin cambios)

* `manifest.webmanifest`: sigue describiendo «Las colecciones familiares de discos y libros». Se puede añadir «y la compra» si se quiere; no afecta al funcionamiento.
* `libros/` y la discoteca: sin cambios. La despensa usa por defecto el mismo proyecto de Supabase que la biblioteca, pero en su propio esquema (`compra`), sin tocar las tablas de los libros.
