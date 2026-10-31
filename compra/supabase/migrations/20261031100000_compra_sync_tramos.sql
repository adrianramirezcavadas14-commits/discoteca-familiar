-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 5 · Corrección de la sincronización
-- ---------------------------------------------------------------------
-- 1) Al terminar cada tramo se SUELTA el cerrojo: la siguiente llamada
--    (de cualquier dispositivo) sigue al momento, sin esperar 3 minutos.
-- 2) Las fichas detalladas se intentan UNA sola vez por sincronización:
--    si Mercadona no las da, ya no se reintentan en bucle y el catálogo
--    se guarda igualmente.
-- Se puede ejecutar varias veces sin problema.
-- =====================================================================

create or replace function compra.sync_release(p_run uuid, p_token uuid) returns void
language sql security definer set search_path = '' as $$
  update compra.catalog_sync_runs
     set heartbeat_at = now() - interval '1 day'
   where id = p_run and lock_token = p_token and status = 'running';
$$;

create or replace function compra.sync_merge_details(p_run uuid, p_token uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform compra.sync_check(p_run, p_token);
  update compra.catalog_sync_staging st
     set data = st.data || jsonb_strip_nulls(coalesce(x.detail, '{}'::jsonb)) || jsonb_build_object('detail_attempted', true)
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(external_id text, detail jsonb)
   where st.run_id = p_run and st.external_id = x.external_id;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function compra.sync_detail_candidates(p_run uuid, p_limit integer default 40)
returns table (external_id text) language sql stable security definer set search_path = '' as $$
  select st.external_id from compra.catalog_sync_staging st
  left join compra.products p on p.external_id = st.external_id
  where st.run_id = p_run and p.detail_fetched_at is null
    and not coalesce((st.data ->> 'detail_fetched')::boolean, false)
    and not coalesce((st.data ->> 'detail_attempted')::boolean, false)
  order by (p.id is null) desc, st.external_id
  limit greatest(0, least(p_limit, 200));
$$;

revoke execute on function compra.sync_release(uuid, uuid), compra.sync_merge_details(uuid, uuid, jsonb), compra.sync_detail_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function compra.sync_release(uuid, uuid), compra.sync_merge_details(uuid, uuid, jsonb), compra.sync_detail_candidates(uuid, integer) to service_role;
