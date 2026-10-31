# 🛒 Nuestra despensa familiar

La tercera aplicación de **Hogar**, junto a la discoteca y la biblioteca: preparar la compra semanal de nuestro Mercadona zona a zona, hacerla con el móvil (también sin cobertura) y llevar los tickets y los tiempos de cada uno.

> Aplicación familiar no oficial. No está relacionada con Mercadona. El catálogo procede de la API pública (no oficial) de su tienda online o de la copia semanal de [datania/mercadona-catalog](https://github.com/datania/mercadona-catalog).

## Qué hace

| Menú | Para qué |
|---|---|
| 🏠 La despensa de un vistazo | Lista, compra pendiente, tickets, novedades y estado del catálogo |
| 🗺️ El mapa del súper | Las 15 zonas de nuestra tienda; ver y mover productos de zona (uno o varios, con deshacer) |
| 📝 Apunta lo que falta | Preparar la lista: «Ya está en la lista», «Los de siempre» y «Más productos» por zona |
| 🛒 ¡A por la compra! | Recorrido con temporizador, ✓ recogido / ✗ no queda / parcial, paso automático de zona |
| 🧾 Tickets por saldar | Subir el ticket (foto o PDF, bucket privado) y marcar quién lo ha pagado |
| 🏆 El rincón de los números | Tiempos por persona, compras por año y mes, lo que más se agota, ahorro por promociones |
| ✨ Lo nuevo del súper | Productos nuevos, retirados, cambios de precio, promociones y registro de sincronizaciones |
| ⚙️ Los ajustes | Quién usa el dispositivo, clave familiar, código postal, categorías ocultas, zonas y datos locales |

## Puesta en marcha

1. `docs/INSTALACION.md`: migraciones, esquema `compra`, clave familiar, funciones Edge.
2. `docs/DESPLIEGUE.md`: publicar en GitHub Pages y actualizar.
3. `docs/MANTENIMIENTO.md`: catálogo, GIF, mapa, zonas, copias y versiones.

## Documentación

* `docs/ANALISIS_Y_PLAN.md`: análisis del repositorio, decisiones, modelo de datos, flujo de sincronización y riesgos.
* `docs/REGISTRO_DE_CAMBIOS.md`: archivos añadidos y modificados (con copia de seguridad).
* `docs/INFORME_DE_PRUEBAS.md`: qué se ha probado y cómo repetirlo.

## Tecnología

HTML, CSS y JavaScript en módulos (sin compilación, como el resto de Hogar) · Supabase (PostgreSQL con RLS, funciones RPC, Edge Functions, Storage privado y Realtime Broadcast) · IndexedDB para usarla sin conexión · service worker común de Hogar.

## Pantallas de carga

`js/config.js` → `LOADING_ASSETS`: `coyote.gif` (entrada), `compras.gif` (guardar lista y tickets), `osos-compras.gif` (fin de la compra).
