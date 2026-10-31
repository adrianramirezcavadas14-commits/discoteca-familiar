-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 3/4 · Funciones, vistas y RPC
-- ---------------------------------------------------------------------
-- · Todas las escrituras de la aplicación pasan por estas funciones.
-- · Son SECURITY DEFINER con search_path vacío y validan la clave familiar.
-- · Los precios los pone siempre el servidor (nunca se aceptan del cliente).
-- · p_op_id hace cada operación idempotente (cola sin conexión).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auxiliares internas (sin permiso para anon)
-- ---------------------------------------------------------------------
create or replace function compra.norm_text(p text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''), 'ÁÀÄÂáàäâÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔóòöôÚÙÜÛúùüûÑñÇç', 'AAAAaaaaEEEEeeeeIIIIiiiiOOOOooooUUUUuuuuNnCc')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function compra.profile_id(p_household uuid, p_code text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from compra.family_profiles
  where household_id = p_household and active and (code = lower(btrim(coalesce(p_code, ''))) or id::text = p_code)
  limit 1;
$$;

create or replace function compra.profile_name(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select display_name from compra.family_profiles where id = p_id;
$$;

create or replace function compra.default_store(p_household uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from compra.stores where household_id = p_household and is_default and deleted_at is null limit 1;
$$;

create or replace function compra.audit(p_household uuid, p_actor uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into compra.audit_log (household_id, actor_id, actor_label, action, entity, entity_id, details)
  values (p_household, p_actor, compra.profile_name(p_actor), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

create or replace function compra.op_result(p_household uuid, p_op uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select result from compra.processed_ops where op_id = p_op and household_id = p_household;
$$;

create or replace function compra.op_store(p_household uuid, p_op uuid, p_kind text, p_result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_op is not null then
    insert into compra.processed_ops (op_id, household_id, kind, result) values (p_op, p_household, p_kind, p_result)
    on conflict (op_id) do nothing;
  end if;
  return p_result;
end $$;

create or replace function compra.fail(p_code text, p_message text, p_detail text default null) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'P0001', detail = coalesce(p_detail, ''), hint = p_message;
end $$;

-- ---------------------------------------------------------------------
-- Categorías ocultas (Bebé y Mascotas por defecto)
-- ---------------------------------------------------------------------
create or replace function compra.hidden_category_ids() returns integer[]
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from compra.app_settings where key = 'hidden_category_ids') then
      coalesce((select array_agg(distinct x::integer) from compra.app_settings s, jsonb_array_elements_text(s.value) x
                where s.key = 'hidden_category_ids' and x ~ '^[0-9]+$'), '{}'::integer[])
    else array[24, 25] end;
$$;

create or replace function compra.hidden_category_names() returns text[]
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from compra.app_settings where key = 'hidden_category_names') then
      coalesce((select array_agg(distinct compra.norm_text(x)) from compra.app_settings s, jsonb_array_elements_text(s.value) x
                where s.key = 'hidden_category_names'), '{}'::text[])
    else array['bebe', 'mascotas'] end;
$$;

create or replace function compra.recompute_visibility() returns integer
language plpgsql security definer set search_path = '' as $$
declare ids integer[] := compra.hidden_category_ids(); names text[] := compra.hidden_category_names(); n integer;
begin
  update compra.products p
     set visible_in_app = not (coalesce(p.category_id = any(ids), false) or compra.norm_text(p.category_name) = any(names))
   where p.visible_in_app is distinct from not (coalesce(p.category_id = any(ids), false) or compra.norm_text(p.category_name) = any(names));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Zona de un producto. Prioridad:
--   1 excepción manual · 2 subcategoría exacta (nivel 2 y luego nivel 1)
--   3 categoría (nivel 0) · 4 regla automática · 5 sin clasificar
-- ---------------------------------------------------------------------
create or replace function compra.zone_for_product(p_store uuid, p_product uuid)
returns table (zone_id uuid, source text)
language sql stable security definer set search_path = '' as $$
  with p as (select * from compra.products where id = p_product),
  candidates as (
    select o.zone_id, 'manual'::text as source, 1 as prio
      from compra.product_zone_overrides o where o.store_id = p_store and o.product_id = p_product
    union all
    select r.zone_id,
           case when r.source = 'auto' then 'auto' when r.level = 0 then 'category' else 'subcategory' end,
           case when r.source = 'auto' then 12 - r.level else 4 - r.level end
      from compra.category_zone_rules r, p
     where r.store_id = p_store
       and ((r.level = 2 and r.external_category_id = p.subsubcategory_id)
         or (r.level = 1 and r.external_category_id = p.subcategory_id)
         or (r.level = 0 and r.external_category_id = p.category_id))
  )
  select c.zone_id, case when c.zone_id is null then 'unclassified' else c.source end
  from candidates c order by c.prio limit 1;
$$;

-- ---------------------------------------------------------------------
-- Identificación
-- ---------------------------------------------------------------------
create or replace function compra.whoami() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h uuid := compra.current_household_id();
begin
  if h is null then
    return jsonb_build_object(
      'ok', false,
      'reason', case when compra.request_key() is null then 'missing_key' else 'invalid_key' end,
      'configured', exists (select 1 from compra.households where access_key_hash is not null and deleted_at is null));
  end if;
  return jsonb_build_object(
    'ok', true,
    'server_time', now(),
    'household', (select jsonb_build_object('id', id, 'name', name) from compra.households where id = h),
    'store', (select jsonb_build_object('id', id, 'name', name, 'postal_code', postal_code, 'warehouse_code', warehouse_code)
                from compra.stores where household_id = h and is_default and deleted_at is null limit 1));
end $$;

-- ---------------------------------------------------------------------
-- Listas
-- ---------------------------------------------------------------------
create or replace function compra.list_payload(p_list uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'list', to_jsonb(l),
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at) from compra.shopping_list_items i where i.list_id = l.id), '[]'::jsonb))
  from compra.shopping_lists l where l.id = p_list;
$$;

create or replace function compra.recalc_list(p_list uuid) returns void
language sql security definer set search_path = '' as $$
  update compra.shopping_lists l
     set estimated_total = coalesce((select sum(i.quantity * coalesce(i.unit_price_snapshot, 0)) from compra.shopping_list_items i where i.list_id = l.id), 0),
         version = l.version + 1
   where l.id = p_list;
$$;

-- Cambios del borrador por producto: [{product_id, quantity (0 = quitar), notes}]
create or replace function compra.save_list_draft(p_changes jsonb, p_actor text default null, p_op_id uuid default null, p_list_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype;
  c record; p record; r jsonb; other text;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 400 then
    perform compra.fail('cambios_no_validos', 'La lista de cambios no tiene el formato esperado.');
  end if;

  select * into l from compra.shopping_lists where household_id = h and status = 'draft' and deleted_at is null for update;
  if p_list_id is not null and (l.id is null or l.id <> p_list_id) then
    select status into other from compra.shopping_lists where id = p_list_id and household_id = h;
    perform compra.fail('lista_no_editable', 'Esa lista ya no está en preparación (se cerró o se completó en otro dispositivo).', coalesce(other, 'missing'));
  end if;
  if l.id is null then
    insert into compra.shopping_lists (household_id, store_id, created_by)
    values (h, compra.default_store(h), actor) returning * into l;
  end if;

  for c in select * from jsonb_to_recordset(p_changes) as x(product_id uuid, quantity integer, notes text) loop
    if c.product_id is null or c.quantity is null or c.quantity < 0 or c.quantity > 99 then
      perform compra.fail('cantidad_no_valida', 'Cada producto necesita una cantidad entre 0 y 99.');
    end if;
    if c.quantity = 0 then
      delete from compra.shopping_list_items where list_id = l.id and product_id = c.product_id;
    else
      select id, price, previous_price, price_decreased, visible_in_app into p from compra.products where id = c.product_id and deleted_at is null;
      if p.id is null then perform compra.fail('producto_no_existe', 'Un producto de la lista ya no existe en el catálogo.'); end if;
      if not p.visible_in_app then perform compra.fail('producto_oculto', 'Ese producto pertenece a una categoría oculta.'); end if;
      insert into compra.shopping_list_items (household_id, list_id, product_id, quantity, unit_price_snapshot, regular_price_snapshot, notes, added_by)
      values (h, l.id, c.product_id, c.quantity, p.price, case when p.price_decreased then p.previous_price end, left(nullif(btrim(c.notes), ''), 200), actor)
      on conflict (list_id, product_id) do update
        set quantity = excluded.quantity,
            unit_price_snapshot = excluded.unit_price_snapshot,
            regular_price_snapshot = excluded.regular_price_snapshot,
            notes = coalesce(excluded.notes, compra.shopping_list_items.notes);
    end if;
  end loop;

  if (select count(*) from compra.shopping_list_items where list_id = l.id) > 400 then
    perform compra.fail('lista_demasiado_grande', 'La lista no puede tener más de 400 productos distintos.');
  end if;
  perform compra.recalc_list(l.id);
  r := compra.list_payload(l.id);
  return compra.op_store(h, p_op_id, 'save_list_draft', r);
end $$;

create or replace function compra.list_summary(p_list uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'products', count(*),
    'units', coalesce(sum(i.quantity), 0),
    'zones', count(distinct i.zone_id_snapshot),
    'unavailable', count(*) filter (where p.availability <> 'available'),
    'estimated_total', coalesce(sum(i.quantity * coalesce(i.unit_price_snapshot, 0)), 0),
    'prices_checked_at', (select max(finished_at) from compra.catalog_sync_runs where status = 'completed'))
  from compra.shopping_list_items i join compra.products p on p.id = i.product_id
  where i.list_id = p_list;
$$;

create or replace function compra.close_list(p_list_id uuid, p_actor text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype; r jsonb;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  select * into l from compra.shopping_lists where id = p_list_id and household_id = h and deleted_at is null for update;
  if l.id is null then perform compra.fail('lista_no_existe', 'No se encuentra la lista.'); end if;
  if l.status <> 'draft' then perform compra.fail('lista_no_abierta', 'La lista ya estaba cerrada.', l.status); end if;
  if exists (select 1 from compra.shopping_lists where household_id = h and status in ('ready_to_shop', 'shopping') and deleted_at is null) then
    perform compra.fail('ya_hay_compra_pendiente', 'Ya hay una lista cerrada pendiente de compra. Termina esa compra antes de cerrar otra.');
  end if;
  if not exists (select 1 from compra.shopping_list_items where list_id = l.id) then
    perform compra.fail('lista_vacia', 'La lista está vacía.');
  end if;

  -- Precios y zonas definitivos según el catálogo actual del servidor
  update compra.shopping_list_items i
     set unit_price_snapshot = p.price,
         regular_price_snapshot = case when p.price_decreased then p.previous_price end,
         zone_id_snapshot = (select z.zone_id from compra.zone_for_product(l.store_id, i.product_id) z)
    from compra.products p
   where p.id = i.product_id and i.list_id = l.id;

  update compra.shopping_lists
     set status = 'ready_to_shop', closed_at = now(), closed_by = actor,
         prices_checked_at = (select max(finished_at) from compra.catalog_sync_runs where status = 'completed')
   where id = l.id;
  perform compra.recalc_list(l.id);
  perform compra.audit(h, actor, 'close_list', 'shopping_lists', l.id::text, compra.list_summary(l.id));
  r := compra.list_payload(l.id) || jsonb_build_object('summary', compra.list_summary(l.id));
  return compra.op_store(h, p_op_id, 'close_list', r);
end $$;

create or replace function compra.reopen_list(p_list_id uuid, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype;
begin
  select * into l from compra.shopping_lists where id = p_list_id and household_id = h and deleted_at is null for update;
  if l.id is null then perform compra.fail('lista_no_existe', 'No se encuentra la lista.'); end if;
  if l.status <> 'ready_to_shop' or exists (select 1 from compra.shopping_sessions where list_id = l.id) then
    perform compra.fail('no_se_puede_reabrir', 'Solo se puede reabrir una lista cerrada cuya compra no ha empezado.', l.status);
  end if;
  if exists (select 1 from compra.shopping_lists where household_id = h and status = 'draft' and deleted_at is null) then
    perform compra.fail('ya_hay_lista_abierta', 'Ya hay otra lista en preparación. Vacíala o ciérrala antes de reabrir esta.');
  end if;
  update compra.shopping_lists set status = 'draft', reopened_at = now(), version = version + 1 where id = l.id;
  perform compra.audit(h, actor, 'reopen_list', 'shopping_lists', l.id::text);
  return compra.list_payload(l.id);
end $$;

-- Producto retirado o sin existencias en una lista ya cerrada: conservar, quitar o sustituir.
create or replace function compra.adjust_closed_list_item(p_list_id uuid, p_product_id uuid, p_action text, p_replacement uuid default null, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype; it compra.shopping_list_items%rowtype; rp record;
begin
  select * into l from compra.shopping_lists where id = p_list_id and household_id = h and deleted_at is null for update;
  if l.id is null or l.status not in ('draft', 'ready_to_shop') then
    perform compra.fail('lista_no_editable', 'Esa lista ya no se puede modificar.');
  end if;
  select * into it from compra.shopping_list_items where list_id = l.id and product_id = p_product_id;
  if it.id is null then perform compra.fail('producto_no_en_lista', 'El producto ya no está en la lista.'); end if;
  if p_action = 'keep' then
    update compra.shopping_list_items set unavailable_ack_at = now() where id = it.id;
  elsif p_action = 'remove' then
    delete from compra.shopping_list_items where id = it.id;
  elsif p_action = 'replace' then
    select id, price, previous_price, price_decreased, visible_in_app into rp from compra.products where id = p_replacement and deleted_at is null;
    if rp.id is null or not rp.visible_in_app then perform compra.fail('sustituto_no_valido', 'El producto sustituto no es válido.'); end if;
    delete from compra.shopping_list_items where id = it.id;
    insert into compra.shopping_list_items (household_id, list_id, product_id, quantity, unit_price_snapshot, regular_price_snapshot, zone_id_snapshot, added_by)
    values (h, l.id, rp.id, it.quantity, rp.price, case when rp.price_decreased then rp.previous_price end,
            (select z.zone_id from compra.zone_for_product(l.store_id, rp.id) z), actor)
    on conflict (list_id, product_id) do update set quantity = least(99, compra.shopping_list_items.quantity + excluded.quantity);
  else
    perform compra.fail('accion_no_valida', 'Acción no válida.');
  end if;
  perform compra.recalc_list(l.id);
  perform compra.audit(h, actor, 'adjust_list_item', 'shopping_lists', l.id::text,
                       jsonb_build_object('product_id', p_product_id, 'action', p_action, 'replacement', p_replacement));
  return compra.list_payload(l.id);
end $$;

-- ---------------------------------------------------------------------
-- Compra en tienda
-- ---------------------------------------------------------------------
create or replace function compra.session_payload(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session', to_jsonb(s) || jsonb_build_object('shopper_code', (select code from compra.family_profiles where id = s.shopper_profile_id)),
    'results', coalesce((select jsonb_agg(to_jsonb(r)) from compra.shopping_item_results r where r.session_id = s.id), '[]'::jsonb))
  from compra.shopping_sessions s where s.id = p_session;
$$;

create or replace function compra.start_shopping(p_list_id uuid, p_shopper text, p_device_id text, p_started_at timestamptz default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  shopper uuid;
  l compra.shopping_lists%rowtype; s compra.shopping_sessions%rowtype; r jsonb; started timestamptz;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return compra.session_payload((r -> 'session' ->> 'id')::uuid); end if; end if;
  select id into shopper from compra.family_profiles where household_id = h and active and can_shop and code = lower(btrim(coalesce(p_shopper, '')));
  if shopper is null then perform compra.fail('comprador_no_valido', 'Elige quién va a hacer la compra.'); end if;

  select * into l from compra.shopping_lists where id = p_list_id and household_id = h and deleted_at is null for update;
  if l.id is null then perform compra.fail('lista_no_existe', 'No se encuentra la lista.'); end if;

  select * into s from compra.shopping_sessions where list_id = l.id;
  if s.id is not null then
    if s.status = 'active' and s.device_id is not distinct from left(p_device_id, 64) then
      return compra.session_payload(s.id);    -- el mismo dispositivo retoma su compra
    end if;
    perform compra.fail('compra_ya_iniciada', 'Esta compra ya se ha iniciado en otro dispositivo.', compra.profile_name(s.shopper_profile_id));
  end if;
  if l.status <> 'ready_to_shop' then perform compra.fail('lista_no_preparada', 'La lista no está cerrada y pendiente de compra.', l.status); end if;

  started := least(now(), greatest(coalesce(p_started_at, now()), now() - interval '6 hours'));
  insert into compra.shopping_sessions (household_id, list_id, shopper_profile_id, device_id, started_at, planned_items, initial_estimated_total)
  values (h, l.id, shopper, left(p_device_id, 64), started,
          (select count(*) from compra.shopping_list_items where list_id = l.id), l.estimated_total)
  returning * into s;
  insert into compra.shopping_item_results (household_id, session_id, list_item_id, product_id, requested_qty)
  select h, s.id, i.id, i.product_id, i.quantity from compra.shopping_list_items i where i.list_id = l.id;
  update compra.shopping_lists set status = 'shopping', shopping_started_at = started where id = l.id;
  perform compra.audit(h, shopper, 'start_shopping', 'shopping_sessions', s.id::text);
  r := compra.session_payload(s.id);
  return compra.op_store(h, p_op_id, 'start_shopping', r);
exception when unique_violation then
  perform compra.fail('compra_ya_iniciada', 'Ya hay una compra en curso.');
  return null;
end $$;

-- Resultados de recogida: [{list_item_id, status, collected_qty, resolved_at}]
-- Regla de conflictos: un estado final nunca vuelve a «pendiente»; entre finales gana el más reciente.
create or replace function compra.record_item_results(p_session_id uuid, p_results jsonb, p_device_id text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  s compra.shopping_sessions%rowtype; cur compra.shopping_item_results%rowtype;
  x record; st text; q integer; at timestamptz; r jsonb; applied integer := 0; skipped integer := 0;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 400 then
    perform compra.fail('resultados_no_validos', 'Los resultados no tienen el formato esperado.');
  end if;
  select * into s from compra.shopping_sessions where id = p_session_id and household_id = h for update;
  if s.id is null then perform compra.fail('compra_no_existe', 'No se encuentra la compra.'); end if;
  if s.status <> 'active' then
    r := compra.session_payload(s.id) || jsonb_build_object('applied', 0, 'skipped', jsonb_array_length(p_results), 'closed', true);
    return compra.op_store(h, p_op_id, 'record_item_results', r);
  end if;

  for x in select * from jsonb_to_recordset(p_results) as y(list_item_id uuid, status text, collected_qty integer, resolved_at timestamptz) loop
    select * into cur from compra.shopping_item_results where session_id = s.id and list_item_id = x.list_item_id for update;
    if cur.id is null then skipped := skipped + 1; continue; end if;
    st := x.status;
    q := coalesce(x.collected_qty, 0);
    if st not in ('pending', 'collected', 'partial', 'out_of_stock') then perform compra.fail('estado_no_valido', 'Estado de producto no válido.'); end if;
    -- Normalización coherente con la restricción de la tabla
    if st = 'collected' then q := cur.requested_qty;
    elsif st = 'out_of_stock' or st = 'pending' then q := 0;
    elsif st = 'partial' then
      if q >= cur.requested_qty then st := 'collected'; q := cur.requested_qty;
      elsif q <= 0 then st := 'out_of_stock'; q := 0; end if;
    end if;
    at := least(coalesce(x.resolved_at, now()), now() + interval '5 minutes');
    if st = 'pending' then skipped := skipped + 1; continue; end if;                       -- nunca se vuelve a pendiente
    if cur.status <> 'pending' and cur.resolved_at is not null and at < cur.resolved_at then skipped := skipped + 1; continue; end if;
    update compra.shopping_item_results
       set status = st, collected_qty = q, resolved_at = at, device_id = left(p_device_id, 64)
     where id = cur.id;
    applied := applied + 1;
  end loop;
  update compra.shopping_sessions set updated_at = now() where id = s.id;
  r := compra.session_payload(s.id) || jsonb_build_object('applied', applied, 'skipped', skipped);
  return compra.op_store(h, p_op_id, 'record_item_results', r);
end $$;

create or replace function compra.session_summary(p_session uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'session_id', s.id,
    'shopper', compra.profile_name(s.shopper_profile_id),
    'shopper_code', (select code from compra.family_profiles where id = s.shopper_profile_id),
    'started_at', s.started_at, 'ended_at', s.ended_at, 'duration_seconds', s.duration_seconds,
    'previous_avg_seconds', s.previous_avg_seconds, 'deviation_pct', s.deviation_pct,
    'planned_items', s.planned_items, 'collected_items', s.collected_items, 'partial_items', s.partial_items,
    'missing_items', s.missing_items, 'initial_estimated_total', s.initial_estimated_total,
    'final_estimated_total', s.final_estimated_total, 'detected_savings', s.detected_savings,
    'difference', coalesce(s.final_estimated_total, 0) - coalesce(s.initial_estimated_total, 0))
  from compra.shopping_sessions s where s.id = p_session;
$$;

create or replace function compra.finish_shopping(p_session_id uuid, p_ended_at timestamptz default null, p_op_id uuid default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  s compra.shopping_sessions%rowtype; r jsonb; ended timestamptz; dur integer;
  prev_avg numeric; prev_n integer; pend integer;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  select * into s from compra.shopping_sessions where id = p_session_id and household_id = h for update;
  if s.id is null then perform compra.fail('compra_no_existe', 'No se encuentra la compra.'); end if;
  if s.status = 'completed' then return compra.session_summary(s.id); end if;
  if s.status <> 'active' then perform compra.fail('compra_no_activa', 'Esta compra ya no está en curso.'); end if;

  select count(*) into pend from compra.shopping_item_results where session_id = s.id and status = 'pending';
  if pend > 0 and not p_force then
    perform compra.fail('quedan_pendientes', 'Todavía quedan productos pendientes.', pend::text);
  end if;

  ended := least(now(), greatest(coalesce(p_ended_at, now()), s.started_at));
  dur := greatest(0, round(extract(epoch from ended - s.started_at)))::integer;

  -- Media personal ANTERIOR (sin incluir esta compra): primero se compara y después se actualiza.
  select avg(duration_seconds), count(*) into prev_avg, prev_n
    from compra.shopping_sessions
   where household_id = h and shopper_profile_id = s.shopper_profile_id and status = 'completed' and id <> s.id and duration_seconds is not null;

  update compra.shopping_sessions ss
     set status = 'completed',
         ended_at = ended,
         duration_seconds = dur,
         previous_avg_seconds = case when prev_n >= 1 then round(prev_avg, 2) end,
         deviation_pct = case when prev_n >= 1 and prev_avg > 0 then round(((dur - prev_avg) / prev_avg) * 100, 2) end,
         collected_items = (select count(*) from compra.shopping_item_results where session_id = s.id and status = 'collected'),
         partial_items   = (select count(*) from compra.shopping_item_results where session_id = s.id and status = 'partial'),
         missing_items   = (select count(*) from compra.shopping_item_results where session_id = s.id and status = 'out_of_stock'),
         final_estimated_total = (select coalesce(sum(r2.collected_qty * coalesce(i.unit_price_snapshot, 0)), 0)
                                    from compra.shopping_item_results r2 join compra.shopping_list_items i on i.id = r2.list_item_id
                                   where r2.session_id = s.id),
         detected_savings = (select coalesce(sum(r2.collected_qty * (i.regular_price_snapshot - i.unit_price_snapshot)), 0)
                               from compra.shopping_item_results r2 join compra.shopping_list_items i on i.id = r2.list_item_id
                              where r2.session_id = s.id and i.regular_price_snapshot > i.unit_price_snapshot)
   where ss.id = s.id;

  update compra.shopping_lists set status = 'completed', completed_at = ended where id = s.list_id;
  perform compra.audit(h, s.shopper_profile_id, 'finish_shopping', 'shopping_sessions', s.id::text, compra.session_summary(s.id));
  r := compra.session_summary(s.id);
  return compra.op_store(h, p_op_id, 'finish_shopping', r);
end $$;

create or replace function compra.cancel_shopping(p_session_id uuid, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  s compra.shopping_sessions%rowtype;
begin
  select * into s from compra.shopping_sessions where id = p_session_id and household_id = h for update;
  if s.id is null or s.status <> 'active' then perform compra.fail('compra_no_activa', 'Esta compra ya no está en curso.'); end if;
  delete from compra.shopping_sessions where id = s.id;
  update compra.shopping_lists set status = 'ready_to_shop', shopping_started_at = null where id = s.list_id;
  perform compra.audit(h, actor, 'cancel_shopping', 'shopping_lists', s.list_id::text);
  return compra.list_payload(s.list_id);
end $$;

-- ---------------------------------------------------------------------
-- Zonas y productos
-- ---------------------------------------------------------------------
-- [{product_id, zone_id}] · zone_id null = restaurar la zona automática. Devuelve el estado anterior (para deshacer).
create or replace function compra.set_product_zone_overrides(p_assignments jsonb, p_actor text default null, p_reason text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  st uuid := compra.default_store(h);
  a record; prev jsonb := '[]'::jsonb; r jsonb; n integer := 0;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' or jsonb_array_length(p_assignments) > 500 then
    perform compra.fail('asignaciones_no_validas', 'Las asignaciones no tienen el formato esperado.');
  end if;
  for a in select * from jsonb_to_recordset(p_assignments) as x(product_id uuid, zone_id uuid) loop
    if not exists (select 1 from compra.products where id = a.product_id) then continue; end if;
    if a.zone_id is not null and not exists (select 1 from compra.store_zones where id = a.zone_id and household_id = h and store_id = st) then
      perform compra.fail('zona_no_valida', 'La zona elegida no existe.');
    end if;
    prev := prev || jsonb_build_array(jsonb_build_object('product_id', a.product_id,
              'zone_id', (select zone_id from compra.product_zone_overrides where store_id = st and product_id = a.product_id)));
    if a.zone_id is null then
      delete from compra.product_zone_overrides where store_id = st and product_id = a.product_id;
    else
      insert into compra.product_zone_overrides (household_id, store_id, product_id, zone_id, reason, created_by, updated_by)
      values (h, st, a.product_id, a.zone_id, left(p_reason, 200), actor, actor)
      on conflict (store_id, product_id) do update set zone_id = excluded.zone_id, reason = excluded.reason, updated_by = excluded.updated_by;
    end if;
    n := n + 1;
  end loop;
  perform compra.audit(h, actor, 'set_product_zones', 'product_zone_overrides', null,
                       jsonb_build_object('assignments', p_assignments, 'previous', prev, 'reason', p_reason));
  r := jsonb_build_object('applied', n, 'previous', prev, 'at', now(), 'by', compra.profile_name(actor));
  return compra.op_store(h, p_op_id, 'set_product_zones', r);
end $$;

create or replace function compra.set_category_rule(p_level integer, p_category_id integer, p_category_name text, p_zone_id uuid, p_confirm_manually boolean default false, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  st uuid := compra.default_store(h);
begin
  if p_level not in (0, 1, 2) or p_category_id is null then perform compra.fail('regla_no_valida', 'Regla no válida.'); end if;
  if p_zone_id is not null and not exists (select 1 from compra.store_zones where id = p_zone_id and household_id = h) then
    perform compra.fail('zona_no_valida', 'La zona elegida no existe.');
  end if;
  insert into compra.category_zone_rules (household_id, store_id, zone_id, level, external_category_id, category_name, source, confirmed, confirm_manually, updated_by)
  values (h, st, p_zone_id, p_level, p_category_id, left(coalesce(nullif(btrim(p_category_name), ''), p_category_id::text), 120), 'manual', true, coalesce(p_confirm_manually, false), actor)
  on conflict (store_id, level, external_category_id) do update
    set zone_id = excluded.zone_id, category_name = excluded.category_name, source = 'manual', confirmed = true,
        confirm_manually = excluded.confirm_manually, updated_by = excluded.updated_by;
  perform compra.audit(h, actor, 'set_category_rule', 'category_zone_rules', p_category_id::text,
                       jsonb_build_object('level', p_level, 'zone_id', p_zone_id, 'confirm_manually', p_confirm_manually));
  return jsonb_build_object('ok', true);
end $$;

create or replace function compra.update_zone(p_zone_id uuid, p_name text, p_summary text, p_active boolean, p_notes text, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  z compra.store_zones%rowtype;
begin
  update compra.store_zones
     set name = left(coalesce(nullif(btrim(p_name), ''), name), 60),
         summary = left(coalesce(p_summary, summary), 200),
         active = coalesce(p_active, active),
         notes = left(nullif(btrim(p_notes), ''), 500)
   where id = p_zone_id and household_id = h
  returning * into z;
  if z.id is null then perform compra.fail('zona_no_valida', 'La zona no existe.'); end if;
  perform compra.audit(h, actor, 'update_zone', 'store_zones', z.id::text, to_jsonb(z));
  return to_jsonb(z);
end $$;

-- ---------------------------------------------------------------------
-- Novedades
-- ---------------------------------------------------------------------
-- [{change_id, product_id, zone_id}]: zone_id solo si se confirma o cambia la zona.
create or replace function compra.review_new_products(p_items jsonb, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  st uuid := compra.default_store(h);
  x record; auto_zone uuid; n integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then
    perform compra.fail('revision_no_valida', 'Formato no válido.');
  end if;
  for x in select * from jsonb_to_recordset(p_items) as y(change_id bigint, product_id uuid, zone_id uuid) loop
    if x.zone_id is not null then
      if not exists (select 1 from compra.store_zones where id = x.zone_id and household_id = h) then
        perform compra.fail('zona_no_valida', 'La zona elegida no existe.');
      end if;
      select z.zone_id into auto_zone from compra.zone_for_product(st, x.product_id) z;
      -- Solo se crea una excepción si la zona elegida difiere de la que da la regla (o la regla no es firme).
      if auto_zone is distinct from x.zone_id or exists (
           select 1 from compra.zone_for_product(st, x.product_id) z where z.source in ('auto', 'unclassified')) then
        insert into compra.product_zone_overrides (household_id, store_id, product_id, zone_id, reason, created_by, updated_by)
        values (h, st, x.product_id, x.zone_id, 'Revisión de producto nuevo', actor, actor)
        on conflict (store_id, product_id) do update set zone_id = excluded.zone_id, reason = excluded.reason, updated_by = excluded.updated_by;
      end if;
    end if;
    update compra.catalog_changes set reviewed_at = now(), reviewed_by = coalesce(compra.profile_name(actor), 'familia')
     where id = x.change_id and reviewed_at is null;
    n := n + 1;
  end loop;
  perform compra.audit(h, actor, 'review_new_products', 'catalog_changes', null, jsonb_build_object('items', p_items));
  return jsonb_build_object('reviewed', n);
end $$;

create or replace function compra.review_changes(p_change_ids bigint[], p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  n integer;
begin
  update compra.catalog_changes set reviewed_at = now(), reviewed_by = coalesce(compra.profile_name(actor), 'familia')
   where id = any(coalesce(p_change_ids, '{}')) and reviewed_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('reviewed', n);
end $$;

-- ---------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------
create or replace function compra.set_setting(p_key text, p_value jsonb, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  v jsonb := coalesce(p_value, 'null'::jsonb); changed integer := 0;
begin
  if p_key = 'postal_code' then
    if not (v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9]{5}$')) then
      perform compra.fail('ajuste_no_valido', 'El código postal debe tener 5 cifras.');
    end if;
    update compra.stores set postal_code = v #>> '{}', warehouse_code = null where id = compra.default_store(h);
  elsif p_key = 'sync_interval_hours' then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 12 or (v #>> '{}')::numeric > 168 then
      perform compra.fail('ajuste_no_valido', 'El intervalo debe estar entre 12 y 168 horas.');
    end if;
  elsif p_key in ('hidden_category_ids', 'manual_confirm_category_ids') then
    if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number') or jsonb_array_length(v) > 200 then
      perform compra.fail('ajuste_no_valido', 'Se esperaba una lista de identificadores de categoría.');
    end if;
  elsif p_key = 'hidden_category_names' then
    if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') or jsonb_array_length(v) > 50 then
      perform compra.fail('ajuste_no_valido', 'Se esperaba una lista de nombres.');
    end if;
  else
    perform compra.fail('ajuste_desconocido', 'Ese ajuste no existe.', p_key);
  end if;
  insert into compra.app_settings (household_id, key, value, updated_by) values (h, p_key, v, actor)
  on conflict (household_id, key) do update set value = excluded.value, updated_by = excluded.updated_by;
  if p_key in ('hidden_category_ids', 'hidden_category_names') then changed := compra.recompute_visibility(); end if;
  perform compra.audit(h, actor, 'set_setting', 'app_settings', p_key, jsonb_build_object('value', v));
  return jsonb_build_object('ok', true, 'key', p_key, 'value', v, 'products_changed', changed);
end $$;

-- ---------------------------------------------------------------------
-- Tickets (la subida la hace la función Edge «compra-tickets»)
-- ---------------------------------------------------------------------
create or replace function compra.update_receipt(p_receipt_id uuid, p_session_id uuid, p_paid_by text, p_amount numeric, p_receipt_date date, p_notes text, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  rc compra.purchase_receipts%rowtype;
begin
  if p_session_id is not null and not exists (select 1 from compra.shopping_sessions where id = p_session_id and household_id = h and status = 'completed') then
    perform compra.fail('compra_no_valida', 'El ticket solo se puede asociar a una compra finalizada.');
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount >= 100000) then perform compra.fail('importe_no_valido', 'Importe no válido.'); end if;
  update compra.purchase_receipts
     set session_id = p_session_id, paid_by = compra.profile_id(h, p_paid_by), amount = round(p_amount, 2),
         receipt_date = p_receipt_date, notes = left(nullif(btrim(p_notes), ''), 500)
   where id = p_receipt_id and household_id = h and deleted_at is null
  returning * into rc;
  if rc.id is null then perform compra.fail('ticket_no_existe', 'No se encuentra el ticket.'); end if;
  perform compra.audit(h, actor, 'update_receipt', 'purchase_receipts', rc.id::text);
  return to_jsonb(rc);
end $$;

create or replace function compra.mark_receipt_paid(p_receipt_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  rc compra.purchase_receipts%rowtype;
begin
  if actor is null then perform compra.fail('persona_no_valida', 'Indica quién marca el ticket como pagado.'); end if;
  update compra.purchase_receipts set status = 'paid', marked_paid_by = actor, marked_paid_at = now()
   where id = p_receipt_id and household_id = h and deleted_at is null and status = 'pending'
  returning * into rc;
  if rc.id is null then
    if exists (select 1 from compra.purchase_receipts where id = p_receipt_id and household_id = h and status = 'paid') then
      return (select to_jsonb(x) from compra.purchase_receipts x where x.id = p_receipt_id);
    end if;
    perform compra.fail('ticket_no_existe', 'No se encuentra el ticket pendiente.');
  end if;
  perform compra.audit(h, actor, 'mark_receipt_paid', 'purchase_receipts', rc.id::text, jsonb_build_object('amount', rc.amount));
  return to_jsonb(rc);
end $$;

create or replace function compra.delete_receipt(p_receipt_id uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  n integer;
begin
  update compra.purchase_receipts set deleted_at = now() where id = p_receipt_id and household_id = h and deleted_at is null;
  get diagnostics n = row_count;
  if n = 0 then perform compra.fail('ticket_no_existe', 'No se encuentra el ticket.'); end if;
  perform compra.audit(h, actor, 'delete_receipt', 'purchase_receipts', p_receipt_id::text);
  return jsonb_build_object('deleted', true);
end $$;

-- ---------------------------------------------------------------------
-- Vistas (con security_invoker: respetan la RLS de quien consulta)
-- ---------------------------------------------------------------------
-- Frecuencia = número de LISTAS COMPLETADAS distintas en las que aparece el producto (no unidades).
create or replace view compra.v_product_frequency with (security_invoker = true) as
select l.household_id, i.product_id,
       count(distinct i.list_id) as list_count,
       max(l.completed_at) as last_completed_at
from compra.shopping_list_items i
join compra.shopping_lists l on l.id = i.list_id
where l.status = 'completed' and l.deleted_at is null
group by l.household_id, i.product_id;

create or replace view compra.v_shopper_stats with (security_invoker = true) as
select s.household_id, s.shopper_profile_id,
       count(*) as total_purchases,
       round(avg(s.duration_seconds), 2) as avg_seconds,
       min(s.duration_seconds) as best_seconds,
       (array_agg(s.duration_seconds order by s.ended_at desc))[1] as last_seconds,
       (array_agg(s.duration_seconds order by s.ended_at desc))[1:3] as last_three_seconds,
       (array_agg(s.deviation_pct order by s.ended_at desc))[1] as last_deviation_pct
from compra.shopping_sessions s
where s.status = 'completed' and s.duration_seconds is not null
group by s.household_id, s.shopper_profile_id;

grant select on compra.v_product_frequency, compra.v_shopper_stats to anon, authenticated;

-- =====================================================================
-- SINCRONIZACIÓN DEL CATÁLOGO (solo service_role / función Edge)
-- =====================================================================
create or replace function compra.sync_begin(p_household uuid, p_trigger text, p_requested_by text, p_stale_seconds integer default 180)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare run compra.catalog_sync_runs%rowtype;
begin
  select * into run from compra.catalog_sync_runs where status in ('running', 'applying') for update;
  if run.id is not null then
    if run.heartbeat_at < now() - make_interval(secs => p_stale_seconds) and run.status = 'running' then
      update compra.catalog_sync_runs
         set lock_token = gen_random_uuid(), heartbeat_at = now(),
             log = log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', 'Retomada tras quedarse sin latido', 'by', p_requested_by))
       where id = run.id returning * into run;
      return jsonb_build_object('state', 'takeover', 'run', to_jsonb(run));
    end if;
    return jsonb_build_object('state', 'busy', 'run', to_jsonb(run) - 'lock_token');
  end if;
  insert into compra.catalog_sync_runs (status, trigger_kind, household_id, requested_by, is_baseline, postal_code, warehouse_code)
  values ('running', case when p_trigger = 'manual' then 'manual' else 'auto' end, p_household, left(p_requested_by, 40),
          not exists (select 1 from compra.products),
          (select postal_code from compra.stores where household_id = p_household and is_default and deleted_at is null limit 1),
          (select warehouse_code from compra.stores where household_id = p_household and is_default and deleted_at is null limit 1))
  returning * into run;
  return jsonb_build_object('state', 'created', 'run', to_jsonb(run));
exception when unique_violation then
  return jsonb_build_object('state', 'busy');
end $$;

create or replace function compra.sync_check(p_run uuid, p_token uuid) returns compra.catalog_sync_runs
language plpgsql security definer set search_path = '' as $$
declare run compra.catalog_sync_runs%rowtype;
begin
  select * into run from compra.catalog_sync_runs where id = p_run for update;
  if run.id is null or run.lock_token <> p_token or run.status <> 'running' then
    raise exception 'sync_lock_lost' using errcode = 'P0001';
  end if;
  update compra.catalog_sync_runs set heartbeat_at = now() where id = p_run returning * into run;
  return run;
end $$;

create or replace function compra.sync_fail(p_run uuid, p_token uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update compra.catalog_sync_runs
     set status = 'failed', finished_at = now(), error = left(p_error, 2000),
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', left(p_error, 500)))
   where id = p_run and lock_token = p_token and status in ('running', 'applying');
  delete from compra.catalog_sync_staging where run_id = p_run;
$$;

create or replace function compra.first_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from compra.households where deleted_at is null order by created_at limit 1;
$$;

create or replace function compra.sync_log(p_run uuid, p_token uuid, p_msg text) returns void
language sql security definer set search_path = '' as $$
  update compra.catalog_sync_runs
     set log = (case when jsonb_array_length(log) > 200 then log - 0 else log end) || jsonb_build_array(jsonb_build_object('at', now(), 'msg', left(p_msg, 500))),
         heartbeat_at = now()
   where id = p_run and lock_token = p_token;
$$;

-- [{external_id, detail:{ean, brand, description, image_url, detail_fetched}}]
create or replace function compra.sync_merge_details(p_run uuid, p_token uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform compra.sync_check(p_run, p_token);
  update compra.catalog_sync_staging st
     set data = st.data || jsonb_strip_nulls(x.detail) || jsonb_build_object('detail_fetched', true)
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as x(external_id text, detail jsonb)
   where st.run_id = p_run and st.external_id = x.external_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Productos descargados en esta sincronización que todavía no tienen ficha detallada (EAN, marca, descripción).
create or replace function compra.sync_detail_candidates(p_run uuid, p_limit integer default 40)
returns table (external_id text) language sql stable security definer set search_path = '' as $$
  select st.external_id from compra.catalog_sync_staging st
  left join compra.products p on p.external_id = st.external_id
  where st.run_id = p_run and p.detail_fetched_at is null and not coalesce((st.data ->> 'detail_fetched')::boolean, false)
  order by (p.id is null) desc, st.external_id
  limit greatest(0, least(p_limit, 200));
$$;

-- Reglas automáticas: categorías nuevas sin regla cuyo nombre coincide con una regla conocida.
create or replace function compra.create_auto_rules() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer := 0; k integer;
begin
  -- nivel 1 y nivel 2: por nombre exacto normalizado de otra regla firme del mismo nivel o de nivel 1
  insert into compra.category_zone_rules (household_id, store_id, zone_id, level, external_category_id, category_name, source, confirmed)
  select distinct on (st.id, c.lvl, c.cid) st.household_id, st.id, r.zone_id, c.lvl, c.cid, c.cname, 'auto', false
  from (
    select distinct 1 as lvl, p.subcategory_id as cid, p.subcategory_name as cname from compra.products p
     where p.visible_in_app and p.subcategory_id is not null and p.deleted_at is null
    union
    select distinct 0, p.category_id, p.category_name from compra.products p
     where p.visible_in_app and p.category_id is not null and p.deleted_at is null
  ) c
  cross join compra.stores st
  join compra.category_zone_rules r
    on r.store_id = st.id and r.source <> 'auto' and r.zone_id is not null
   and compra.norm_text(r.category_name) = compra.norm_text(c.cname) and r.external_category_id <> c.cid
  where st.deleted_at is null
    and not exists (select 1 from compra.category_zone_rules x where x.store_id = st.id and x.level = c.lvl and x.external_category_id = c.cid)
  order by st.id, c.lvl, c.cid, r.level desc
  on conflict (store_id, level, external_category_id) do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- Aplica el catálogo descargado en catalog_sync_staging. Todo o nada (una transacción).
create or replace function compra.apply_catalog_sync(p_run uuid, p_token uuid, p_min_ratio numeric default 0.8)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  run compra.catalog_sync_runs%rowtype;
  v_now timestamptz := now();
  v_baseline boolean;
  n_staged integer; n_active integer; v_stats jsonb := '{}'::jsonb; k integer;
  hid integer[] := compra.hidden_category_ids();
  hnames text[] := compra.hidden_category_names();
begin
  select * into run from compra.catalog_sync_runs where id = p_run for update;
  if run.id is null or run.lock_token <> p_token or run.status <> 'running' then raise exception 'sync_lock_lost'; end if;
  if exists (select 1 from compra.catalog_sync_tasks where run_id = p_run and status <> 'done') then
    raise exception 'catalogo_incompleto: quedan categorías sin descargar';
  end if;
  update compra.catalog_sync_runs set status = 'applying', heartbeat_at = v_now where id = p_run;

  select count(*) into n_staged from compra.catalog_sync_staging where run_id = p_run;
  select count(*) into n_active from compra.products where active and deleted_at is null;
  v_baseline := not exists (select 1 from compra.products);
  -- Nunca se sustituye un catálogo válido por una descarga incompleta.
  if n_staged = 0 or (not v_baseline and n_staged < floor(n_active * p_min_ratio)) then
    raise exception 'catalogo_incompleto: % productos descargados frente a % activos', n_staged, n_active;
  end if;

  create temp table s on commit drop as
  select d.*
  from compra.catalog_sync_staging st,
       jsonb_to_record(st.data) as d(
         external_id text, name text, packaging text, format_label text,
         category_id integer, category_name text, subcategory_id integer, subcategory_name text,
         subsubcategory_id integer, subsubcategory_name text,
         price numeric, unit_price numeric, unit_of_measure text, unit_size numeric, size_format text,
         selling_method smallint, is_bulk boolean, approx_size boolean, previous_price numeric, price_decreased boolean,
         thumbnail_url text, image_url text, share_url text, published boolean, unavailable boolean, is_new_arrival boolean,
         source text, ean text, brand text, description text, detail_fetched boolean)
  where st.run_id = p_run and d.external_id is not null and d.name is not null;

  create temp table j on commit drop as
  select s.*, p.id as pid, p.name as o_name, p.packaging as o_packaging, p.format_label as o_format,
         p.category_id as o_cat, p.category_name as o_cat_name, p.subcategory_id as o_sub, p.subcategory_name as o_sub_name,
         p.subsubcategory_id as o_subsub, p.price as o_price, p.price_decreased as o_decreased, p.previous_price as o_prev,
         p.thumbnail_url as o_thumb, p.image_hash as o_hash, p.availability as o_avail, p.visible_in_app as o_visible,
         md5(split_part(coalesce(s.thumbnail_url, ''), '?', 1)) as n_hash,
         case when coalesce(s.published, true) and not coalesce(s.unavailable, false) then 'available' else 'temporarily_unavailable' end as n_avail,
         not (coalesce(s.category_id = any(hid), false) or compra.norm_text(s.category_name) = any(hnames)) as n_visible
  from s left join compra.products p on p.external_id = s.external_id;

  -- 1) Productos nuevos
  with ins as (
    insert into compra.products (external_id, ean, name, description, brand, packaging, format_label, category_id, category_name,
           subcategory_id, subcategory_name, subsubcategory_id, subsubcategory_name, price, unit_price, unit_of_measure, unit_size,
           size_format, selling_method, is_bulk, approx_size, previous_price, price_decreased, image_url, thumbnail_url, image_hash,
           share_url, is_new_arrival, new_until, active, visible_in_app, availability, first_seen_at, last_seen_at, source, detail_fetched_at)
    select external_id, ean, name, description, brand, packaging, format_label, category_id, category_name,
           subcategory_id, subcategory_name, subsubcategory_id, subsubcategory_name, round(price, 2), unit_price, unit_of_measure, unit_size,
           size_format, selling_method, coalesce(is_bulk, false), coalesce(approx_size, false), round(previous_price, 2),
           coalesce(price_decreased, false), image_url, thumbnail_url, case when thumbnail_url is not null then n_hash end,
           share_url, coalesce(is_new_arrival, false), case when v_baseline then null else v_now + interval '14 days' end,
           true, n_visible, n_avail, v_now, v_now, source, case when coalesce(detail_fetched, false) then v_now end
    from j where pid is null
    returning id, external_id)
  update j set pid = ins.id from ins where j.external_id = ins.external_id and j.pid is null;
  get diagnostics k = row_count; v_stats := v_stats || jsonb_build_object('new', case when v_baseline then 0 else k end, 'inserted', k);

  insert into compra.product_price_history (product_id, price, unit_price, change_type, promo_declared, sync_run_id, recorded_at)
  select pid, round(price, 2), unit_price, 'initial', coalesce(price_decreased, false), p_run, v_now from j where o_name is null and price is not null;
  insert into compra.product_images (product_id, url, thumbnail_url, image_hash, first_seen_at, last_seen_at)
  select pid, image_url, thumbnail_url, n_hash, v_now, v_now from j where o_name is null and thumbnail_url is not null
  on conflict (product_id, image_hash) do nothing;
  insert into compra.product_promotions (product_id, promo_price, regular_price, started_at, start_run_id)
  select pid, round(price, 2), round(previous_price, 2), v_now, p_run from j where o_name is null and coalesce(price_decreased, false)
  on conflict do nothing;
  if not v_baseline then
    insert into compra.catalog_changes (run_id, product_id, change_type, new_value, needs_review, detected_at)
    select p_run, pid, 'new_product',
           jsonb_build_object('name', name, 'price', price, 'category', category_name, 'subcategory', subcategory_name, 'format', format_label),
           n_visible, v_now
    from j where o_name is null;
  end if;

  -- 2) Cambios en productos existentes (se registran antes de actualizar)
  insert into compra.catalog_changes (run_id, product_id, change_type, old_value, new_value, needs_review, detected_at)
  select p_run, pid, t.change_type, t.old_value, t.new_value, t.needs_review, v_now
  from j cross join lateral (values
    ('name_change', jsonb_build_object('name', o_name), jsonb_build_object('name', name), false,
       o_name is distinct from name),
    ('format_change', jsonb_build_object('packaging', o_packaging, 'format', o_format), jsonb_build_object('packaging', packaging, 'format', format_label), false,
       o_packaging is distinct from packaging or o_format is distinct from format_label),
    ('category_change', jsonb_build_object('id', o_cat, 'name', o_cat_name), jsonb_build_object('id', category_id, 'name', category_name), n_visible,
       o_cat is distinct from category_id),
    ('subcategory_change', jsonb_build_object('id', o_sub, 'name', o_sub_name, 'sub2', o_subsub), jsonb_build_object('id', subcategory_id, 'name', subcategory_name, 'sub2', subsubcategory_id), n_visible,
       o_cat is not distinct from category_id and (o_sub is distinct from subcategory_id or o_subsub is distinct from subsubcategory_id)),
    ('price_increase', jsonb_build_object('price', o_price), jsonb_build_object('price', round(price, 2), 'diff', round(price, 2) - o_price,
        'pct', case when o_price > 0 then round((round(price, 2) - o_price) / o_price * 100, 2) end), false,
       o_price is not null and price is not null and round(price, 2) > o_price),
    ('price_decrease', jsonb_build_object('price', o_price), jsonb_build_object('price', round(price, 2), 'diff', round(price, 2) - o_price,
        'pct', case when o_price > 0 then round((round(price, 2) - o_price) / o_price * 100, 2) end, 'promo', coalesce(price_decreased, false)), false,
       o_price is not null and price is not null and round(price, 2) < o_price),
    ('promo_start', jsonb_build_object('price', o_price), jsonb_build_object('price', round(price, 2), 'previous', round(previous_price, 2)), false,
       coalesce(price_decreased, false) and not coalesce(o_decreased, false)),
    ('promo_end', jsonb_build_object('price', o_price, 'previous', o_prev), jsonb_build_object('price', round(price, 2)), false,
       coalesce(o_decreased, false) and not coalesce(price_decreased, false)),
    ('photo_change', jsonb_build_object('thumbnail', o_thumb), jsonb_build_object('thumbnail', thumbnail_url), false,
       thumbnail_url is not null and o_hash is distinct from n_hash),
    ('reappeared', jsonb_build_object('availability', o_avail), jsonb_build_object('availability', n_avail), n_visible,
       o_avail in ('possibly_removed', 'removed')),
    ('temporarily_unavailable', jsonb_build_object('availability', o_avail), jsonb_build_object('availability', n_avail), false,
       n_avail = 'temporarily_unavailable' and o_avail = 'available'),
    ('available_again', jsonb_build_object('availability', o_avail), jsonb_build_object('availability', n_avail), false,
       n_avail = 'available' and o_avail = 'temporarily_unavailable')
  ) as t(change_type, old_value, new_value, needs_review, happened)
  where j.o_name is not null and t.happened;
  get diagnostics k = row_count; v_stats := v_stats || jsonb_build_object('changes', k);

  -- Historial de precios y promociones declaradas por la fuente
  insert into compra.product_price_history (product_id, price, unit_price, previous_price, change_eur, change_pct, change_type, promo_declared, sync_run_id, recorded_at)
  select pid, round(price, 2), unit_price, o_price, round(price, 2) - o_price,
         case when o_price > 0 then round((round(price, 2) - o_price) / o_price * 100, 2) end,
         case when round(price, 2) > o_price then 'increase' else 'decrease' end, coalesce(price_decreased, false), p_run, v_now
  from j where o_name is not null and o_price is not null and price is not null and round(price, 2) <> o_price;
  update compra.product_promotions pr set ended_at = v_now, end_run_id = p_run
    from j where pr.product_id = j.pid and pr.ended_at is null and j.o_name is not null and not coalesce(j.price_decreased, false);
  update compra.product_promotions pr set promo_price = round(j.price, 2), regular_price = round(j.previous_price, 2)
    from j where pr.product_id = j.pid and pr.ended_at is null and coalesce(j.price_decreased, false);
  insert into compra.product_promotions (product_id, promo_price, regular_price, started_at, start_run_id)
  select pid, round(price, 2), round(previous_price, 2), v_now, p_run from j
   where o_name is not null and coalesce(price_decreased, false) and not coalesce(o_decreased, false)
  on conflict do nothing;

  -- Fotografías: se actualizan solas (sin preguntar) y se guarda el historial
  update compra.product_images pi set is_primary = false, replaced_at = v_now
    from j where pi.product_id = j.pid and j.o_name is not null and j.thumbnail_url is not null and j.o_hash is distinct from j.n_hash and pi.replaced_at is null;
  insert into compra.product_images (product_id, url, thumbnail_url, image_hash, first_seen_at, last_seen_at)
  select pid, image_url, thumbnail_url, n_hash, v_now, v_now from j where o_name is not null and thumbnail_url is not null
  on conflict (product_id, image_hash) do update set last_seen_at = excluded.last_seen_at, is_primary = true, replaced_at = null;

  -- 3) Actualizar productos vistos (sin tocar zona, frecuencia, historial ni configuración propia)
  update compra.products p
     set name = j.name,
         packaging = j.packaging,
         format_label = j.format_label,
         category_id = j.category_id, category_name = j.category_name,
         subcategory_id = j.subcategory_id, subcategory_name = j.subcategory_name,
         subsubcategory_id = j.subsubcategory_id, subsubcategory_name = j.subsubcategory_name,
         price = round(j.price, 2), unit_price = j.unit_price, unit_of_measure = j.unit_of_measure, unit_size = j.unit_size,
         size_format = j.size_format, selling_method = j.selling_method, is_bulk = coalesce(j.is_bulk, false),
         approx_size = coalesce(j.approx_size, false),
         previous_price = round(j.previous_price, 2), price_decreased = coalesce(j.price_decreased, false),
         price_before_change = case when j.o_price is not null and j.price is not null and round(j.price, 2) <> j.o_price then j.o_price else p.price_before_change end,
         price_change_kind = case when j.o_price is not null and j.price is not null and round(j.price, 2) <> j.o_price
                                  then case when round(j.price, 2) > j.o_price then 'increase' else 'decrease' end else p.price_change_kind end,
         price_changed_at = case when j.o_price is not null and j.price is not null and round(j.price, 2) <> j.o_price then v_now else p.price_changed_at end,
         thumbnail_url = coalesce(j.thumbnail_url, p.thumbnail_url),
         image_url = coalesce(j.image_url, p.image_url),
         image_hash = case when j.thumbnail_url is not null then j.n_hash else p.image_hash end,
         share_url = coalesce(j.share_url, p.share_url),
         is_new_arrival = coalesce(j.is_new_arrival, false),
         ean = coalesce(j.ean, p.ean), brand = coalesce(j.brand, p.brand), description = coalesce(j.description, p.description),
         detail_fetched_at = case when coalesce(j.detail_fetched, false) then v_now else p.detail_fetched_at end,
         active = true,
         visible_in_app = j.n_visible,
         availability = j.n_avail,
         missing_streak = 0, first_missing_at = null, removed_at = null,
         last_seen_at = v_now,
         source = j.source
    from j
   where p.id = j.pid and j.o_name is not null;
  get diagnostics k = row_count; v_stats := v_stats || jsonb_build_object('seen', k + coalesce((v_stats ->> 'inserted')::integer, 0));

  -- 4) Productos que no aparecen: nunca se borran. Tres ausencias seguidas = retirado.
  with miss as (
    update compra.products p
       set missing_streak = least(p.missing_streak + 1, 1000),
           active = false,
           first_missing_at = coalesce(p.first_missing_at, v_now),
           availability = case when p.missing_streak + 1 >= 3 then 'removed' else 'possibly_removed' end,
           removed_at = case when p.missing_streak + 1 >= 3 then coalesce(p.removed_at, v_now) else null end
     where p.deleted_at is null
       and p.availability <> 'removed'
       and not exists (select 1 from s where s.external_id = p.external_id)
    returning p.id, p.missing_streak, p.visible_in_app, p.last_seen_at, p.first_missing_at)
  insert into compra.catalog_changes (run_id, product_id, change_type, old_value, new_value, needs_review, detected_at)
  select p_run, id, case when missing_streak >= 3 then 'removed' else 'possibly_removed' end,
         jsonb_build_object('last_seen_at', last_seen_at), jsonb_build_object('first_missing_at', first_missing_at, 'streak', missing_streak),
         visible_in_app, v_now
  from miss where missing_streak = 1 or missing_streak = 3;
  get diagnostics k = row_count; v_stats := v_stats || jsonb_build_object('missing_changes', k);

  v_stats := v_stats || jsonb_build_object('auto_rules', compra.create_auto_rules(), 'staged', n_staged, 'baseline', v_baseline);

  delete from compra.catalog_sync_staging where run_id = p_run;
  update compra.catalog_sync_runs
     set status = 'completed', finished_at = now(), heartbeat_at = now(), products_seen = n_staged,
         stats = run.stats || v_stats,
         log = log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', 'Catálogo aplicado'))
   where id = p_run;

  -- Limpieza: datos temporales antiguos
  delete from compra.catalog_sync_staging st using compra.catalog_sync_runs r where r.id = st.run_id and r.status in ('failed', 'aborted');
  delete from compra.processed_ops where applied_at < now() - interval '90 days';
  delete from compra.catalog_sync_runs where id in (
    select id from compra.catalog_sync_runs where status in ('completed', 'failed', 'aborted') order by started_at desc offset 120);
  return v_stats;
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución
-- ---------------------------------------------------------------------
revoke execute on all functions in schema compra from public, anon, authenticated;
grant execute on all functions in schema compra to service_role;
grant execute on function
  compra.request_key(), compra.current_household_id(), compra.whoami(),
  compra.save_list_draft(jsonb, text, uuid, uuid), compra.close_list(uuid, text, uuid), compra.reopen_list(uuid, text),
  compra.adjust_closed_list_item(uuid, uuid, text, uuid, text),
  compra.start_shopping(uuid, text, text, timestamptz, uuid), compra.record_item_results(uuid, jsonb, text, uuid),
  compra.finish_shopping(uuid, timestamptz, uuid, boolean), compra.cancel_shopping(uuid, text),
  compra.set_product_zone_overrides(jsonb, text, text, uuid), compra.set_category_rule(integer, integer, text, uuid, boolean, text),
  compra.update_zone(uuid, text, text, boolean, text, text),
  compra.review_new_products(jsonb, text), compra.review_changes(bigint[], text),
  compra.set_setting(text, jsonb, text),
  compra.update_receipt(uuid, uuid, text, numeric, date, text, text), compra.mark_receipt_paid(uuid, text), compra.delete_receipt(uuid, text)
to anon, authenticated;
