# Mantenimiento de Nuestra despensa familiar

## Actualizar el catálogo

* **Automático**: cada vez que alguien abre la despensa se pregunta al servidor si han pasado **12 horas** (configurable en *Ajustes*, mínimo 12) desde la última sincronización correcta. Si toca, se actualiza por tramos con el progreso a la vista.
* **Manual**: *Ajustes → Catálogo del súper → Actualizar ahora* (como mucho una vez cada 30 minutos).
* **Registro**: *Lo nuevo del súper → Sincronizaciones* muestra cada intento, la fuente usada, los cambios y los errores.
* **Programado (opcional)**, para que se actualice aunque nadie abra la app. En Supabase, activa las extensiones `pg_cron` y `pg_net`, fija un secreto y programa una llamada cada 10 minutos (si el catálogo está al día, la función responde al instante sin descargar nada):

```bash
supabase secrets set COMPRA_CRON_SECRET=una-cadena-larga-y-aleatoria
```

```sql
select cron.schedule('despensa-catalogo', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://TU_REF.supabase.co/functions/v1/compra-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-compra-cron', 'una-cadena-larga-y-aleatoria'),
    body := '{"action":"continue"}'::jsonb);
$$);
```

### Cómo funciona por dentro

`compra/supabase/functions/_shared/`:

* `catalog-core.js` → **MercadonaCatalogProvider**: `listCategories()`, `fetchCategory(id)`, `fetchProduct(id)`. Dos proveedores: `createMercadonaApiProvider` (API, con el almacén del código postal) y `createDataniaProvider` (JSON de Hugging Face). Para cambiar de fuente basta con escribir otro objeto con esos tres métodos y añadirlo en `defaultProviders()` de `sync-handler.js`.
* `sync-engine.js` → tramos con presupuesto de tiempo, concurrencia 2, pausa 0,7 s, 3 intentos por categoría, cerrojo con latido.
* `compra.apply_catalog_sync()` (SQL) → aplica todo o nada; nunca borra productos (3 ausencias seguidas = retirado).

## Sustituir los GIF de las pantallas de carga

1. Copia el GIF nuevo en `compra/` (por ejemplo `nuevo.gif`).
2. Cambia el nombre en `compra/js/config.js`, el único sitio donde aparecen:

```js
export const LOADING_ASSETS = {
  startup: 'coyote.gif',                // entrada y conexión inicial
  saving: 'compras.gif',                // guardar/cerrar la lista y subir tickets
  completedPurchase: 'osos-compras.gif' // fin de la compra y estadísticas
};
```

3. Si cambias el de entrada, actualiza también `'./compra/coyote.gif'` en `service-worker.js` (para que esté disponible sin conexión) y sube el número de `CACHE`.

## El mapa del supermercado

El mapa no es una imagen: se dibuja con HTML y CSS a partir de `store_zones.map_shapes`, una lista de rectángulos sobre una cuadrícula de **100 × 50** celdas:

```json
[{ "x": 38, "y": 6, "w": 21, "h": 3, "r": 20 }]
```

* `x`, `y`: esquina superior izquierda (desde 1) · `w`, `h`: ancho y alto en celdas · `r`: giro en grados (opcional) · `lp: "end"` pone el número y el nombre abajo (opcional).
* La zona 15 (Congelados) tiene **tres** rectángulos: los tres arcones amarillos son una sola zona.
* Los pasillos grises y las cajas son decorativos y están en `compra/js/core/map-layout.js` (`WALLS`, `CHECKOUT`).
* En móviles en vertical el plano se gira 90° automáticamente; siempre hay una vista en lista.

Para mover o redimensionar una zona (SQL Editor):

```sql
update compra.store_zones set map_shapes = '[{"x":49,"y":15,"w":14,"h":22,"lp":"end"}]' where code = 'z10';
```

La imagen original de referencia está en `compra/docs/mapa-referencia.png`. Si cambia la distribución de la tienda, sustituye esa imagen por la nueva (mismo nombre) para tenerla a mano y ajusta las coordenadas como arriba.

Nombre, resumen de las flechas, observaciones y si la zona está activa se cambian desde *Ajustes → Las zonas del súper*.

## Zonas de categorías y productos

* **Productos sueltos**: *El mapa del súper* → zona → foto → «Mover a la zona» (o seleccionar varios). Queda registrado quién y cuándo, y se puede deshacer el último movimiento o restaurar la zona automática.
* **Categorías enteras** (por identificador de Mercadona; nivel 0 = sección, 1 = categoría, 2 = subcategoría). En el SQL Editor:

```sql
insert into compra.category_zone_rules (household_id, store_id, zone_id, level, external_category_id, category_name, source, confirmed)
select s.household_id, s.id, z.id, 1, 244, 'Utensilios de limpieza y calzado', 'manual', true
from compra.stores s join compra.store_zones z on z.store_id = s.id and z.code = 'z12'
where s.is_default and s.deleted_at is null
on conflict (store_id, level, external_category_id)
do update set zone_id = excluded.zone_id, source = 'manual', confirmed = true;
```

  La regla más específica gana (por eso «Bollería envasada», 66, va a la zona 4 aunque «Panadería y pastelería», 5, vaya a la 3). Los identificadores están en `categories.json` del catálogo y en *Ajustes → Categorías del catálogo*.
* **Preguntar la zona de productos nuevos** de una sección: *Ajustes → Categorías del catálogo → Preguntar zona*.
* **Categorías ocultas** (Bebé y Mascotas por defecto): *Ajustes → Categorías del catálogo → Ocultar*. Sus productos se siguen guardando.

## Datos y copias de seguridad

* Supabase guarda copias diarias en planes de pago; en el gratuito, exporta de vez en cuando desde *Database → Backups* o con `supabase db dump --schema compra`.
* Los tickets están en el bucket privado `compra-tickets`. Al «eliminar» un ticket solo se oculta (`deleted_at`); el archivo se conserva.
* Limpieza automática: los datos temporales de sincronización se borran al aplicar; `processed_ops` guarda 90 días; se conservan las últimas 120 sincronizaciones.

## Si el proyecto gratuito se pausa

Supabase pausa los proyectos gratuitos tras una semana sin actividad. La despensa lo detecta, abre con lo guardado en el dispositivo y muestra «Reintentar». Reactiva el proyecto desde el panel; los cambios hechos mientras tanto se envían solos (cola con identificadores idempotentes).

## Versiones

Al publicar cambios en la despensa:

1. Sube `APP_VERSION` en `compra/js/config.js` y el `?v=` de `compra/index.html`.
2. Cambia el nombre de `CACHE` en `service-worker.js` para que los móviles descarguen la versión nueva.
3. Si añades un archivo JavaScript, añádelo a la lista de `service-worker.js` (`npm run lint` avisa si falta).

## Pruebas

Desde `compra/` (ver `INFORME_DE_PRUEBAS.md`):

```bash
npm install
npm run lint          # sintaxis, importaciones, ids duplicados, secretos y service worker
npm test              # lógica de la app y de las funciones del servidor
npm run test:sql      # migraciones, RLS y funciones en PostgreSQL real
npm run test:e2e      # navegador real contra PostgreSQL + PostgREST locales
```
