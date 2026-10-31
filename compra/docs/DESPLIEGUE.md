# Despliegue

La despensa tiene dos partes: la web (GitHub Pages, igual que el resto de Hogar) y el servidor (Supabase: base de datos y dos funciones Edge).

## Primera vez

1. **Supabase**: sigue `INSTALACION.md` pasos 1–6 (migraciones, esquema expuesto, clave familiar, funciones, bucket).
2. **GitHub**: sube a `main` la carpeta `compra/` y los dos archivos de la raíz modificados (`index.html`, `service-worker.js`).
3. **GitHub Pages** publica solo. En el móvil, cierra Hogar del todo y vuelve a abrirlo; si aparece «Hay una versión nueva», pulsa «Actualizar».

## Actualizaciones posteriores

| Qué cambia | Qué hacer |
|---|---|
| Archivos de `compra/` (web) | Subirlos a GitHub; cambiar `CACHE` en `service-worker.js` y `APP_VERSION`. |
| `compra/supabase/functions/**` | `supabase functions deploy compra-sync --no-verify-jwt` (o `compra-tickets`) desde `compra/`. |
| Migración nueva | Añadir un archivo con fecha posterior en `compra/supabase/migrations/` y ejecutarlo (SQL Editor o `supabase db push`). Nunca editar las ya aplicadas. |

## Comandos útiles (desde `compra/`)

```bash
supabase link --project-ref TU_REF
supabase db push
supabase functions deploy compra-sync --no-verify-jwt
supabase functions deploy compra-tickets --no-verify-jwt
supabase secrets set COMPRA_ALLOWED_ORIGINS=https://TU_USUARIO.github.io
supabase functions logs compra-sync
```

## Qué necesita credenciales

| Pieza | Credencial | Dónde vive |
|---|---|---|
| Web (navegador) | URL + *publishable key* (públicas) + clave familiar (la escribe cada persona) | `compra/supabase-config.js` y el dispositivo |
| `compra-sync` | `SUPABASE_SERVICE_ROLE_KEY` (automática) · `COMPRA_CRON_SECRET` (opcional) | Secretos de Supabase |
| `compra-tickets` | `SUPABASE_SERVICE_ROLE_KEY` (automática) | Secretos de Supabase |
| Migraciones | Contraseña de la base de datos o acceso al SQL Editor | Solo quien administra |
| `compra.set_household_key()` | Solo ejecutable desde el SQL Editor (o service_role) | — |
