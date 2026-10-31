// =====================================================================
// HOGAR · NUESTRA DESPENSA FAMILIAR · Función Edge «compra-tickets»
// ---------------------------------------------------------------------
// Los tickets se guardan en el bucket PRIVADO «compra-tickets». El navegador
// no tiene permisos sobre ese bucket: sube y consulta a través de aquí.
//   POST multipart/form-data  action=upload
//        file, session_id?, paid_by, amount?, receipt_date?, notes?, actor
//   POST JSON { "action": "signed-url", "receipt_id": "…" } → URL firmada (5 min)
// Cabecera obligatoria: x-compra-key (clave familiar).
// Despliegue (desde compra/): supabase functions deploy compra-tickets --no-verify-jwt
// La lógica está en ../_shared/tickets-handler.js (probada con Node en tests/).
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import { createTicketsHandler, supabaseStorage } from '../_shared/tickets-handler.js';
import { TICKET_BUCKET } from '../_shared/tickets-core.js';

const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  db: { schema: 'compra' },
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(createTicketsHandler({
  client,
  storage: supabaseStorage(client, TICKET_BUCKET),
  allowedOrigins: Deno.env.get('COMPRA_ALLOWED_ORIGINS') ?? ''
}));
