// =====================================================================
// HOGAR · NUESTRA DESPENSA FAMILIAR · Función Edge «compra-recetas»
// ---------------------------------------------------------------------
// Imágenes para el menú semanal:
//   POST JSON { "action": "buscar", "q": "lentejas con chorizo", "page": 0 }
//   POST multipart/form-data  action=subir, file   (foto propia → bucket público compra-recetas)
// Secretos opcionales (supabase secrets set …):
//   BRAVE_SEARCH_API_KEY   → busca en webs de recetas conocidas (Brave Search API, imágenes)
//   COMPRA_RECETAS_SITIOS  → lista de dominios separados por comas (si no, la lista por defecto)
//   COMPRA_ALLOWED_ORIGINS → orígenes permitidos (CORS)
// Sin BRAVE_SEARCH_API_KEY usa Wikimedia Commons y Openverse (gratis y sin clave).
// Despliegue (desde compra/): supabase functions deploy compra-recetas --no-verify-jwt
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.100.0';
import { createRecipesHandler, supabaseRecipeStorage } from '../_shared/recipes-handler.js';
import { RECIPE_BUCKET } from '../_shared/recipes-core.js';

const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  db: { schema: 'compra' },
  auth: { persistSession: false, autoRefreshToken: false }
});

Deno.serve(createRecipesHandler({
  client,
  storage: supabaseRecipeStorage(client, RECIPE_BUCKET),
  braveKey: Deno.env.get('BRAVE_SEARCH_API_KEY') ?? '',
  sites: Deno.env.get('COMPRA_RECETAS_SITIOS') ?? '',
  allowedOrigins: Deno.env.get('COMPRA_ALLOWED_ORIGINS') ?? ''
}));
