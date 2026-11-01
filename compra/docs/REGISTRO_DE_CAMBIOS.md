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

1. `CACHE`: `hogar-v7f-autores-20261028` → `hogar-v9-despensa-20261031` (antes `hogar-v8-despensa-20261030`) (para que los móviles reciban la versión nueva; las cachés antiguas de Hogar se borran solas como hasta ahora).
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

## Corrección 31/10/2026 · la sincronización se quedaba en el 100 %

Síntoma: «152/152 categorías descargadas» pero `compra.products` seguía vacío.

Causas:
1. Al terminar cada tramo la función no soltaba el cerrojo, así que el siguiente tramo recibía «ocupado» hasta 3 minutos.
2. Las fichas detalladas que fallaban se reintentaban en cada tramo sin fin, y nunca se llegaba a guardar el catálogo.

Arreglo:
* Nueva migración `20261031100000_compra_sync_tramos.sql` (`compra.sync_release`; cada ficha se marca como intentada). Incluida en `INSTALAR_TODO.sql`.
* `supabase/functions/_shared/sync-engine.js`: suelta el cerrojo al final de cada tramo, intenta cada ficha una vez y deja el guardado para un tramo propio si queda poco tiempo. Más rápido: 3 peticiones a la vez y pausa de 0,4 s.
* `js/ui/sync.js`: al 100 % muestra «Completando fichas y guardando el catálogo…».
* Prueba nueva en `tests/sql/catalog-sync.test.mjs`.

### Segunda parte (31/10/2026) · las fichas recorrían todo el catálogo

El límite de 40 fichas detalladas se aplicaba por tramo y no por sincronización: si las fichas iban lentas, cada tramo pedía 40 nuevas y la primera sincronización intentaba recorrer los ~4.400 productos antes de guardar. Nueva migración `20261031110000_compra_sync_fichas.sql` (solo SQL, no hace falta volver a desplegar la función): límite real por sincronización y más tiempo de consulta para la función del servidor al guardar el catálogo. Prueba nueva en `tests/sql/catalog-sync.test.mjs`.

## Versión 1.1 · 31/10/2026 · mapa, buscadores y catálogo

* **Zonas con el tamaño que queráis**: en *El mapa del súper* → «✏️ Cambiar tamaños». Se elige una zona y se agranda, reduce o mueve con botones (− / + / flechas) o arrastrando los tiradores de los bordes; «Forma original» la deja como estaba. Se guarda para toda la familia con la nueva función `compra.update_zone_shapes` (migración `20261031120000_compra_plano.sql`), que valida que no se salga del plano y deja registro.
* Quitada la barra gris horizontal entre las zonas 5 y 6.
* **Mapa en el móvil**: más alto, número y contador uno al lado del otro (ya no se tapan), nombres que se adaptan al tamaño de cada zona (en fila, en vertical o en dos líneas) y lupa − / + para verlo más grande.
* **Buscadores**: al escribir solo se repintan los resultados, nunca la caja de texto; mientras se escribe no se repinta la página aunque llegue un aviso de otro dispositivo; y el mapa ya no «se gira» al abrir el teclado (era lo que cerraba el teclado en el móvil). Lo escrito en Ajustes y no guardado se conserva.
* **Ajustes**: quitado el apartado de la clave. Aviso cuando falta el código postal o el catálogo es de otra tienda; al guardar un código postal nuevo se descarga el surtido de esa tienda.
* `compra-sync`: si cambia el código postal, el catálogo se considera caducado y se puede actualizar al momento.
* `service-worker.js` (raíz): caché `hogar-v9-despensa-20261031`.

## Versión 1.2 · 01/11/2026 · Discos, Libros y Despensa

### Discos (`index.html` de la raíz)
* **Fallo de conexión en el iPad (causa localizada y reproducida con WebKit):** la colección completa se copiaba en `localStorage` *dentro* de la conexión. Safari/WebKit cuenta 2 bytes por carácter cuando el texto lleva caracteres como «—» (que la colección usa para «sin año»), así que su límite real es ~2,5 millones de caracteres, la mitad que en Chrome. Con una colección grande (por ejemplo, portadas subidas desde el dispositivo, guardadas como imagen dentro de la colección) la copia lanzaba `QuotaExceededError` y la app mostraba «Error de conexión» aunque la base de datos respondía. Ahora la copia local nunca impide conectar: va completa a IndexedDB y, si cabe, ligera a `localStorage`.
* Librería de Supabase fijada (2.100.0, como la biblioteca y la despensa) con CDN de reserva y tiempo máximo; antes se cargaba «@2» sin versión ni reserva.
* Todos los accesos a `localStorage` protegidos (Safari con almacenamiento bloqueado ya no rompe el arranque).
* **Bloqueo de escrituras sin sincronización:** mientras no se haya leído la colección de la base de datos (o si se pierde la conexión) no se puede guardar, editar, eliminar ni tocar la lista de deseos; las funciones lo comprueban por dentro, no solo los botones. Aviso visible con «Reintentar»; se desbloquea solo al volver a sincronizar. Si un guardado falla, se deshace el cambio (no queda nada «guardado solo en este móvil»).
* Registro en consola con el prefijo `[Discos]` (sin claves ni datos personales).
* Las portadas elegidas del dispositivo se reducen (máximo 700 px) antes de guardarlas.
* **Ordenación** junto al contador: álbum, artista o año, ascendente o descendente (por defecto, artista ascendente). Se guarda en el dispositivo.

### Libros (`libros/`)
* **Ordenación** junto al contador: título, autor o año (por defecto, autor ascendente), guardada en el dispositivo.
* **Libros leídos por año:** al elegir un año, debajo de los meses salen las portadas completas agrupadas por mes, ordenadas por fecha, con la valoración en estrellas (enteras, medias y vacías; «Sin valorar» si no la hay).
* **Portadas en el iPad:** se ven enteras (`object-fit: contain` con la imagen posicionada dentro de la caja; Safari no siempre resolvía `height: 100%` dentro de una caja con `aspect-ratio`).

### Despensa (`compra/`)
* Buscador universal en el mapa (ver o cambiar la zona del producto) y en la preparación de la lista (añadir a la lista principal, a «Pendientes no urgentes» o marcar «Pendiente de revisar»).
* «Pendientes de revisar» (marca 🚩 junto a «+ Añadir») y apartado propio en *Lo nuevo del súper*.
* «Pendientes no urgentes»: segunda lista siempre abierta; mover productos entre listas sin duplicar.
* Cada zona muestra todos sus productos (sin «Ver más») y la cabecera de la zona queda fija al bajar.
* **Menú semanal** nuevo, con recetas de comida y de cena por separado e imagen obligatoria (función `compra-recetas`).
* *El rincón de los números*: sin filtros; una sola gráfica de líneas con la media acumulada del tiempo de compra de cada persona, compra a compra.
* Migración `20261101100000_compra_menu_y_pendientes.sql` (incluida en `INSTALAR_TODO.sql`).
* `service-worker.js`: caché `hogar-v10-20261101` y archivos nuevos de la despensa.
