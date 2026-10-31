/* =====================================================================
   HOGAR · NUESTRA DESPENSA FAMILIAR · Configuración central
   ---------------------------------------------------------------------
   Todo lo que se puede querer cambiar sin tocar la lógica está aquí.
   ===================================================================== */

export const APP_VERSION = '1.0 · 30/10/2026';

/* Pantallas de carga: para cambiar un GIF basta con subir el archivo a
   la carpeta compra/ y escribir aquí su nombre. No aparecen en ningún otro sitio. */
export const LOADING_ASSETS = {
  startup: 'coyote.gif',               // entrada y conexión inicial
  saving: 'compras.gif',               // guardado/cierre de la lista y subida de tickets
  completedPurchase: 'osos-compras.gif' // fin de la compra y actualización de estadísticas
};
export const LOADING_ALT = {
  startup: 'El coyote vigila con prismáticos si hay novedades en el súper',
  saving: 'Llenando el carro de la compra',
  completedPurchase: 'Los osos llegan con la compra hecha'
};

/* Personas que pueden hacer la compra (identificadores estables en Supabase). */
export const SHOPPERS = [
  { code: 'papa', name: 'Papá', color: '#ef6f6c' },
  { code: 'mama', name: 'Mamá', color: '#8f6fc5' },
  { code: 'adrian', name: 'Adrián', color: '#3e9c87' }
];

export const DB_SCHEMA = 'compra';
export const SYNC_FUNCTION = 'compra-sync';
export const TICKETS_FUNCTION = 'compra-tickets';

export const SUPABASE_JS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.100.0/dist/umd/supabase.js',
  'https://unpkg.com/@supabase/supabase-js@2.100.0/dist/umd/supabase.js'
];

export const NET_TIMEOUT = 15000;
export const PAGE_SIZE = 24;               // productos por tanda en «Más productos»
export const FREQUENT_LIMIT = 24;          // máximo de «Los de siempre» por zona
export const NEW_BADGE_DAYS = 14;          // días que un producto se marca como «Nuevo»
export const DROP_BADGE_DAYS = 14;         // días que una bajada detectada se marca en rojo
export const RESULTS_FLUSH_MS = 2500;      // agrupación de toques en la compra antes de enviar
export const SYNC_POLL_MS = 1500;          // pausa entre tramos de sincronización
export const MAX_TICKET_MB = 10;

export const STORAGE_KEYS = {
  key: 'despensaClaveFamiliar',
  me: 'despensaQuienSoy',
  device: 'despensaDispositivo',
  mapView: 'despensaVistaMapa',
  colors: 'despensaColores'
};

export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
