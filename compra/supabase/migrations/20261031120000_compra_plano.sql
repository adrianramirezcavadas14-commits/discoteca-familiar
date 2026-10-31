-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 7 · Cambiar el tamaño de las zonas del mapa
-- ---------------------------------------------------------------------
-- El mapa guarda en store_zones.map_shapes uno o varios rectángulos en una
-- cuadrícula de 100 × 50 celdas. Esta función los cambia desde la app
-- (agrandar, reducir, mover) validando que no se salgan del plano.
-- =====================================================================
create or replace function compra.update_zone_shapes(p_zone_id uuid, p_shapes jsonb, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  z compra.store_zones%rowtype;
  s jsonb;
  clean jsonb := '[]'::jsonb;
  vx integer; vy integer; vw integer; vh integer; vr integer;
begin
  if p_shapes is null or jsonb_typeof(p_shapes) <> 'array' or jsonb_array_length(p_shapes) < 1 or jsonb_array_length(p_shapes) > 6 then
    perform compra.fail('forma_no_valida', 'Cada zona necesita entre 1 y 6 rectángulos.');
  end if;
  for s in select value from jsonb_array_elements(p_shapes) loop
    begin
      vx := (s ->> 'x')::integer; vy := (s ->> 'y')::integer; vw := (s ->> 'w')::integer; vh := (s ->> 'h')::integer;
      vr := coalesce((s ->> 'r')::integer, 0);
    exception when others then
      perform compra.fail('forma_no_valida', 'Las medidas de la zona tienen que ser números enteros.');
    end;
    if vx is null or vy is null or vw is null or vh is null
       or vx < 1 or vy < 1 or vw < 1 or vh < 1 or vx + vw - 1 > 100 or vy + vh - 1 > 50 or vr < -90 or vr > 90 then
      perform compra.fail('forma_no_valida', 'La zona se sale del plano.');
    end if;
    clean := clean || jsonb_build_array(
      jsonb_build_object('x', vx, 'y', vy, 'w', vw, 'h', vh)
      || case when vr <> 0 then jsonb_build_object('r', vr) else '{}'::jsonb end
      || case when s ->> 'lp' = 'end' then jsonb_build_object('lp', 'end') else '{}'::jsonb end);
  end loop;

  update compra.store_zones set map_shapes = clean
   where id = p_zone_id and household_id = h
  returning * into z;
  if z.id is null then perform compra.fail('zona_no_valida', 'La zona no existe.'); end if;
  perform compra.audit(h, actor, 'update_zone_shapes', 'store_zones', z.id::text, jsonb_build_object('map_shapes', clean));
  return to_jsonb(z);
end $$;

revoke execute on function compra.update_zone_shapes(uuid, jsonb, text) from public;
grant execute on function compra.update_zone_shapes(uuid, jsonb, text) to anon, authenticated, service_role;
