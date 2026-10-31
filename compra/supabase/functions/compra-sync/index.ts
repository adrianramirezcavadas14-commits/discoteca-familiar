// =====================================================================
// HOGAR · NUESTRA DESPENSA FAMILIAR · Función Edge «compra-sync»
// ---------------------------------------------------------------------
// Sincroniza el catálogo de Mercadona en Supabase de forma incremental.
// El navegador NUNCA descarga el catálogo de Mercadona: solo llama aquí.
//
// Peticiones (POST JSON, cabecera x-compra-key con la clave familiar):
//   { "action": "status" }                  → estado de la última sincronización
//   { "action": "ensure", "actor": "mama" }  → sincroniza si han pasado ≥ 12 h
//   { "action": "continue" }                → avanza la sincronización en curso
//   { "action": "manual", "actor": "papa" }  → fuerza una sincronización (Ajustes)
// Tarea programada opcional: cabecera x-compra-cron = secreto COMPRA_CRON_SECRET.
//
// Secretos: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (los pone Supabase),
//           COMPRA_CRON_SECRET y COMPRA_ALLOWED_ORIGINS (opcionales).
// Despliegue (desde compra/): supabase functions deploy compra-sync --no-verify-jwt
// La lógica está en ../_shared/sync-handler.js (probada con Node en tests/).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import { createSyncHandler, defaultProviders } from '../_shared/sync-handler.js';

const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  db: { schema: 'compra' },
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(createSyncHandler({
  client,
  providersFor: defaultProviders(client, fetch),
  cronSecret: Deno.env.get('COMPRA_CRON_SECRET') ?? '',
  allowedOrigins: Deno.env.get('COMPRA_ALLOWED_ORIGINS') ?? ''
}));
