# Instalación de Nuestra despensa familiar

> **Importante:** las migraciones se han probado en un PostgreSQL 16 real con PostgREST (el mismo motor de la API de Supabase), pero **no se han ejecutado en tu proyecto de Supabase**. Hasta que sigas estos pasos, la despensa mostrará «Faltan tablas» o «clave no válida».

Tiempo estimado: 20 minutos. Necesitas acceso al panel de Supabase y (para las funciones) la [CLI de Supabase](https://supabase.com/docs/guides/cli).

## 1. Elegir el proyecto de Supabase

Por defecto `compra/supabase-config.js` usa **el mismo proyecto que la biblioteca** (todo va en el esquema `compra`, separado de las tablas de los libros). Si prefieres un proyecto propio, crea uno y pon su URL y su *publishable key* en ese archivo (o en `compra/.env` y ejecuta `node tools/generar-config.mjs` desde `compra/`).

Nunca pongas la clave *secret* ni la *service_role* en ese archivo: la app se niega a arrancar si lo detecta.

## 2. Crear las tablas (migraciones)

**Opción A · SQL Editor** (sin instalar nada): abre *SQL Editor → New query*, pega **todo** el archivo `compra/supabase/INSTALAR_TODO.sql` (son las cuatro migraciones juntas, en orden) y pulsa *Run*. Debe terminar con «Success».

Se puede ejecutar varias veces sin duplicar nada. Si un intento anterior se quedó a medias, no pasa nada: vuelve a ejecutarlo entero.

**Opción B · CLI** (desde la carpeta `compra/`):

```bash
supabase link --project-ref TU_REF
supabase db push
```

## 3. Exponer el esquema `compra` en la API

*Project Settings → Data API → Exposed schemas* → añade `compra` → *Save*.
(Si falta este paso la app muestra: «Supabase no expone el esquema compra».)

## 4. Clave familiar (opcional, no hace falta)

Por defecto la despensa se abre **sin clave**, igual que la discoteca y la biblioteca. Como en ellas, cualquiera que conozca la dirección de la web y la clave pública de Supabase (que está en el código de la página) podría ver y cambiar la lista: para una app familiar suele bastar.

Si algún día queréis protegerla, en el SQL Editor:

```sql
select compra.set_household_key('una frase larga que recuerde la familia');
```

A partir de entonces cada dispositivo la pedirá una vez. Para volver a quitarla:

```sql
select compra.clear_household_key();
```

## 5. Desplegar las funciones del servidor

Desde la carpeta `compra/`:

```bash
supabase functions deploy compra-sync --no-verify-jwt
supabase functions deploy compra-tickets --no-verify-jwt
```

`--no-verify-jwt` es necesario porque la app usa la *publishable key* (no es un JWT); cada función comprueba la clave familiar por su cuenta.

Opcional (recomendado), limitar desde qué web se puede llamar a las funciones:

```bash
supabase secrets set COMPRA_ALLOWED_ORIGINS=https://TU_USUARIO.github.io
```

## 6. Comprobar el bucket de tickets

La migración 4 crea el bucket **privado** `compra-tickets` (10 MB, JPG/PNG/WEBP/HEIC/PDF). Compruébalo en *Storage*: debe aparecer como *Private* y **sin políticas**. No hay que crear ninguna.

## 7. Publicar en GitHub

Sube al repositorio (rama `main`):

* la carpeta `compra/` completa (puedes omitir `compra/node_modules/` y `compra/tests/e2e/artifacts/`, ya ignoradas en `.gitignore`);
* `index.html` y `service-worker.js` de la raíz (cambios mínimos, ver `REGISTRO_DE_CAMBIOS.md`).

Espera a que GitHub Pages publique y abre Hogar: aparecerá la tercera tarjeta.

## 8. Primera entrada

1. Pulsa «Nuestra despensa familiar».
2. Se lanza la **primera sincronización** del catálogo (coyote con prismáticos). Tarda unos minutos; puedes pulsar «Seguir usando la despensa mientras tanto».
3. Elige quién usa el dispositivo (Papá, Mamá o Adrián).
4. En *Ajustes* puedes poner el **código postal** de tu Mercadona para recibir su surtido y sus precios.

## Variables y claves

| Nombre | Dónde | Pública | Para qué |
|---|---|---|---|
| `DESPENSA_SUPABASE_URL` → `url` | `compra/supabase-config.js` | Sí | URL del proyecto |
| `DESPENSA_SUPABASE_PUBLISHABLE_KEY` → `publishableKey` | `compra/supabase-config.js` | Sí | Clave pública (*publishable*) |
| `SUPABASE_URL` | Funciones Edge | — | La pone Supabase automáticamente |
| `SUPABASE_SERVICE_ROLE_KEY` | Funciones Edge | **No** | La pone Supabase automáticamente; nunca sale del servidor |
| `COMPRA_ALLOWED_ORIGINS` | `supabase secrets` | — | Opcional: orígenes permitidos (CORS) |
| `COMPRA_CRON_SECRET` | `supabase secrets` | **No** | Opcional: sincronización programada (ver MANTENIMIENTO.md) |
| Clave familiar (opcional) | `compra.set_household_key()` + cada dispositivo | **No** | Solo si se quiere proteger el acceso |

## Problemas frecuentes

| Mensaje | Solución |
|---|---|
| «Supabase no expone el esquema compra» | Paso 3. |
| «Faltan tablas o funciones» | Paso 2 (las cuatro migraciones, en orden). |
| Pide una clave y no la habéis puesto | Ejecuta `select compra.clear_household_key();` |
| «La función compra-sync no está desplegada» | Paso 5. La app funciona con el catálogo guardado. |
| «El proyecto de Supabase está en pausa» | Reactívalo en el panel de Supabase y pulsa «Reintentar». No se pierde nada: los cambios esperan en el dispositivo. |
| La sincronización falla siempre | Mira *Lo nuevo del súper → Sincronizaciones*: aparece el error de cada intento. Si la API de Mercadona bloquea al servidor, se usa la copia de datania automáticamente. |
