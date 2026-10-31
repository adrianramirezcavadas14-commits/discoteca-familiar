-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 6 · Límite real de fichas por sincronización
-- ---------------------------------------------------------------------
-- Las fichas detalladas (EAN, marca) se completan poco a poco: como mucho
-- p_limit (40) por SINCRONIZACIÓN, no por tramo. Antes cada tramo pedía 40
-- nuevas y la primera sincronización intentaba recorrer todo el catálogo
-- antes de guardarlo.
-- =====================================================================
create or replace function compra.sync_detail_candidates(p_run uuid, p_limit integer default 40)
returns table (external_id text) language sql stable security definer set search_path = '' as $$
  with ya as (
    select count(*)::integer as n from compra.catalog_sync_staging
     where run_id = p_run and coalesce((data ->> 'detail_attempted')::boolean, false)
  )
  select st.external_id from compra.catalog_sync_staging st
  left join compra.products p on p.external_id = st.external_id
  cross join ya
  where st.run_id = p_run and p.detail_fetched_at is null
    and not coalesce((st.data ->> 'detail_fetched')::boolean, false)
    and not coalesce((st.data ->> 'detail_attempted')::boolean, false)
  order by (p.id is null) desc, st.external_id
  limit greatest(0, least(p_limit - (select n from ya), 200));
$$;

revoke execute on function compra.sync_detail_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function compra.sync_detail_candidates(uuid, integer) to service_role;

-- Guardar el catálogo completo la primera vez puede tardar más que el límite
-- corto que la API aplica por defecto a cada consulta. Se da margen a la
-- función del servidor (service_role, nunca usada por el navegador).
-- Si el proyecto no lo permite, se ignora sin error.
do $$
begin
  alter role service_role set statement_timeout = '5min';
  perform pg_notify('pgrst', 'reload config');
exception when others then
  raise notice 'No se pudo ampliar el tiempo de service_role: %', sqlerrm;
end $$;
