// =====================================================================
// HOGAR · NUESTRA DESPENSA FAMILIAR · Conexión pública con Supabase
// ---------------------------------------------------------------------
// Solo la Project URL y la PUBLISHABLE key (pública). Nunca la secret
// ni la service_role. Estos valores se pueden generar desde .env con:
//     node tools/generar-config.mjs
// Por defecto apunta al MISMO proyecto que la biblioteca (el plan gratuito
// de Supabase admite pocos proyectos activos). Todo lo de la despensa vive
// en el esquema «compra», separado de las tablas de los libros.
// =====================================================================
window.DESPENSA_SUPABASE = {
  url: 'https://ravnuggmkypkrcfgfeip.supabase.co',
  publishableKey: 'sb_publishable_IFbVLHoh3msnxsrtUAPQ4A_Mxb5apyp'
};
