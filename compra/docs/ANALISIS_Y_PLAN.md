# Nuestra despensa familiar · Fase 1 (análisis) y Fase 2 (plan)

## 1. Lo que había en el repositorio

| Elemento | Hallazgo |
|---|---|
| Publicación | GitHub Pages, sitio estático. No hay `package.json`, ni compilación, ni variables de entorno: la configuración pública va en archivos `supabase-config.js`. |
| Tecnologías | HTML + CSS + JavaScript sin framework. La discoteca es un `index.html` de 316 KB con todo dentro; la biblioteca (`libros/`) separa `index.html`, `styles.css` y `app.js` (IIFE de 3.700 líneas). |
| Pantalla inicial | `index.html` raíz → `#homePicker` con dos tarjetas (`.home-app.discs` / `.home-app.books`). La discoteca se abre en la misma página; la biblioteca navega a `./libros/`. |
| Menú lateral | `.drawer-bg > .drawer` con botones `.navbtn` (icono + título + subtítulo) y «Cambiar de aplicación» abajo con línea discontinua. |
| Colores y tipografía | `--ink #243047`, `--muted`, `--yellow #ffd166`, `--coral #ff786b`, `--mint #66c9a7`, fondo crema degradado, `ui-rounded, system-ui`. |
| Componentes | Pantalla de carga con GIF + mensajes + barra + «Reintentar»; diálogo genérico; toasts; modales `.modal` / `.scan-modal`; pestañas por persona; tarjetas de estadísticas (barras por año, barras por mes, donut, leyenda). |
| Supabase | Proyectos distintos para discoteca y biblioteca. Clave publishable en `supabase-config.js`. **Sin Supabase Auth** (`persistSession: false`). Tablas en `public`. Realtime con `postgres_changes`. Storage público para portadas. Una función Edge (`libros/supabase/functions/agapea`). |
| Sistema de carga | supabase-js 2.100.0 desde jsDelivr con unpkg de reserva y tiempo máximo; red de seguridad a los 20 s si la app no arranca. |
| Caché y PWA | Un único `service-worker.js` en la raíz (alcance `./`), red primero para HTML/JS/CSS y caché primero para GIF; `manifest.webmanifest` «Hogar». |
| Gráficas | HTML/SVG a mano (sin librerías): `.year-bars`, `.month-bars`, `donut()`. |
| Familia | Discoteca y biblioteca: Papá, Mamá, María y Adrián (colores `#ef6f6c`, `#8f6fc5`, `#e6973f`, `#3e9c87`). La compra: solo Papá, Mamá y Adrián. |
| Nombres | «Nuestra discoteca familiar», «Nuestra biblioteca familiar»: un lugar de casa donde se guarda algo. |

### Decisiones derivadas del análisis

* **Nombre**: «Nuestra despensa familiar» (la compra semanal llena la despensa), carpeta `compra/`. Menú con nombres simpáticos y subtítulo explicativo.
* **Mismo patrón que `libros/`**: carpeta propia con `index.html`, `styles.css`, `supabase-config.js`, sus GIF y `supabase/functions`. Como la app es más grande, el JavaScript va en módulos ES (`js/…`) que GitHub Pages sirve tal cual: sigue sin haber compilación.
* **Sin Supabase Auth ni clave** por defecto, como las otras apps (modo abierto). RLS activa en todas las tablas: el navegador solo puede leer y las escrituras pasan por funciones que validan los datos. **Clave familiar opcional**: si se activa con `compra.set_household_key()`, viaja en la cabecera `x-compra-key` y todas las políticas la comprueban (`compra.current_household_id()`); en la base de datos solo se guarda `sha256(sal || clave)`.
* **Esquema propio `compra`**: las tablas con los nombres pedidos (`products`, `households`…) no chocan con las de la biblioteca aunque compartan proyecto (el plan gratuito limita los proyectos activos).
* **Realtime**: con la clave en una cabecera, `postgres_changes` no puede aplicar la RLS. Se usa **Broadcast** solo para avisar «algo ha cambiado»; cada dispositivo vuelve a leer por la API REST, que sí pasa por la RLS. No viaja ningún dato por el canal.
* **Storage**: el Storage de Supabase no recibe cabeceras personalizadas en sus políticas, así que el bucket de tickets es **privado sin políticas** y todo pasa por la función Edge `compra-tickets` (subida validada y URL firmadas).
* **Caché local**: IndexedDB (el proyecto es web, no hay SQLite).

## 2. Fuente del catálogo (comprobada)

`datania/mercadona-catalog` no contiene los JSON en GitHub: los publica cada lunes en Hugging Face (`huggingface.co/datasets/datania/mercadona-catalog`). Son copias exactas de la API pública (no oficial) de `tienda.mercadona.es/api`:

* `categories.json` → 26 secciones (nivel 0) con sus categorías (nivel 1). IDs reales usados en las reglas: p. ej. 5 «Panadería y pastelería», 66 «Bollería envasada», 156 «Agua», 24 «Bebé», 25 «Mascotas».
* `categories/<id>.json` → la categoría con sus subcategorías (nivel 2) y **todos sus productos con precio, formato y miniatura**.
* `products/<id>.json` → ficha completa (EAN, marca, descripción, fotos).

Consecuencia clave: **una sincronización completa son ~150 peticiones de categoría**, no 4.000 fichas. Las fichas (EAN, marca) se completan poco a poco (40 por sincronización).

Promociones: la API solo declara `price_decreased` + `previous_unit_price` (sin fechas). Se guardan como «promoción declarada por la fuente» con la fecha en que se vio empezar y terminar; las bajadas detectadas por nosotros se registran aparte y no se tratan como promoción.

## 3. Árbol de carpetas

```
compra/
├── index.html · styles.css · supabase-config.js · .env.example · package.json
├── coyote.gif · compras.gif · osos-compras.gif
├── img/icono-despensa.svg
├── js/
│   ├── app.js                (arranque, menú, rutas #hash, avisos entre dispositivos)
│   ├── config.js             (GIF, personas, tiempos… todo lo configurable)
│   ├── core/                 (lógica pura y probada: zonas, precios, bloques, estadísticas, cola, mapa)
│   ├── data/                 (IndexedDB, Supabase, estado y sincronización)
│   ├── ui/                   (diálogos, pantalla de carga, mapa, tarjetas, sincronización, avisos)
│   └── pages/                (inicio, mapa, lista, compra, tickets, números, novedades, ajustes)
├── supabase/
│   ├── config.toml
│   ├── migrations/           (esquema, seguridad, funciones, datos iniciales)
│   └── functions/            (compra-sync, compra-tickets y _shared/)
├── tests/                    (unitarias, SQL/RLS, extremo a extremo, lint)
├── tools/generar-config.mjs
├── copias-de-seguridad/      (originales de los archivos de Hogar que se han tocado)
└── docs/
```

## 4. Archivos existentes que cambian (mínimo imprescindible)

| Archivo | Cambio | Copia |
|---|---|---|
| `index.html` (raíz) | Tercera tarjeta «Nuestra despensa familiar» + 3 columnas en escritorio + `location.href='./compra/'`. Nada más. | `compra/copias-de-seguridad/index.html.bak` |
| `service-worker.js` | Precarga de los archivos de `compra/` y página sin conexión propia; versión de caché nueva. | `compra/copias-de-seguridad/service-worker.js.bak` |

La discoteca y la biblioteca no se tocan.

## 5. Modelo de datos (esquema `compra`)

* **Familia**: `households` (clave hasheada) · `family_profiles` (papa, mama, adrian: identificadores estables) · `household_members`.
* **Tienda**: `stores` (código postal y almacén) · `store_zones` (orden, nombre, color, formas del mapa, activa, observaciones) · `category_zone_rules` (por **ID** de categoría y nivel; `seed` / `manual` / `auto`) · `product_zone_overrides`.
* **Catálogo**: `products` (UUID interno + ID de Mercadona, EAN, precios, imagen y hash, `active`, `visible_in_app`, disponibilidad, primera/última aparición, racha de ausencias) · `product_images` · `product_price_history` · `product_promotions` · `catalog_sync_runs` · `catalog_sync_tasks` · `catalog_sync_staging` · `catalog_changes`.
* **Compra**: `shopping_lists` (índices únicos: **una abierta** y **una cerrada pendiente** por familia) · `shopping_list_items` (precio fijado por el servidor) · `shopping_sessions` (**una por lista**) · `shopping_item_results` (restricción de coherencia estado/unidades) · `purchase_receipts`.
* **Otros**: `app_settings` · `audit_log` · `processed_ops` (idempotencia de la cola sin conexión).
* **Vistas**: `v_product_frequency` (`COUNT(DISTINCT list_id)` de listas completadas) · `v_shopper_stats`.

Prioridad de zona (SQL y JavaScript idénticos): excepción manual → subcategoría (nivel 2, luego 1) → categoría (nivel 0) → regla automática → sin clasificar.

## 6. Flujo de sincronización

```
Entrada en la app ──► compra-sync {ensure}
   ├─ última correcta < 12 h → «fresh» (no se descarga nada)
   └─ caducada → sync_begin (índice único: una sola en marcha; la que se queda sin latido 3 min se retoma)
         ├─ plan: categories/ (API) → si falla, categories.json (datania)
         ├─ tramos de 25 s: 2 peticiones a la vez, pausa 0,7 s, 3 reintentos con espera exponencial
         │     cada categoría → catalog_sync_staging
         ├─ fichas detalladas (40 por vez)
         └─ apply_catalog_sync: TODO o NADA en una transacción
               · rechaza si falta alguna categoría o hay < 80 % del catálogo activo
               · nuevos, retirados (3 ausencias), reaparecidos, nombre, formato, categoría,
                 subcategoría, precio (historial), promoción, foto, no disponible
El navegador muestra el progreso real y puede seguir usándose; los demás dispositivos ven el estado.
```

## 7. Riesgos detectados

1. **API no oficial**: puede cambiar o bloquear las IP de servidores. Mitigación: validación de formato, proveedor alternativo, nunca se aplica una descarga incompleta, aviso no bloqueante. El `robots.txt` de Mercadona excluye `/api` a los rastreadores: el uso aquí es familiar, espaciado (cada 12 h, ~150 peticiones lentas) y no automatiza pedidos, pero conviene tenerlo presente.
2. **datania** se actualiza semanalmente: si se usa la copia, los precios pueden tener hasta 7 días.
3. **Sin clave (por defecto)**: igual que la discoteca y la biblioteca, quien conozca la web y la clave pública puede leer y modificar la lista. Si se quiere evitar, se activa la clave opcional.
4. **Pausa del proyecto gratuito**: la app detecta la desconexión, abre con los datos guardados y ofrece reintentar.
5. **Cabecera personalizada**: comprobada con PostgREST (local) y documentada por Supabase para RPC/tablas; Storage no la recibe → resuelto con la función de tickets.
6. **Mismo proyecto que la biblioteca**: por defecto `compra/supabase-config.js` apunta al proyecto de la biblioteca. Las tablas están en otro esquema, pero el espacio de 500 MB es compartido (la despensa no copia imágenes: ocupa pocos MB).
