-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 2/4 · Seguridad (RLS y permisos)
-- ---------------------------------------------------------------------
-- La discoteca y la biblioteca no usan Supabase Auth ni clave. La despensa
-- funciona igual por defecto (modo abierto). Si algún día se quiere, se
-- puede activar una CLAVE FAMILIAR opcional con compra.set_household_key():
--   · El navegador la envía en la cabecera «x-compra-key».
--   · En la base de datos solo se guarda sha256(sal || clave).
--   · Todas las políticas RLS comprueban la clave con current_household_id().
--   · El rol anónimo SOLO puede LEER (select) sus filas; todas las escrituras
--     pasan por funciones RPC que validan los datos (y los precios) en el servidor.
--   · El catálogo y los tickets los escriben funciones Edge con la clave
--     service_role, que vive solo en los secretos de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Clave familiar
-- ---------------------------------------------------------------------
create or replace function compra.request_key() returns text
language sql stable set search_path = '' as $$
  select nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-compra-key', '')), '');
$$;

create or replace function compra.household_for_key(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select h.id
  from compra.households h
  where h.deleted_at is null
    and h.access_key_hash is not null
    and char_length(coalesce(p_key, '')) between 8 and 200
    and h.access_key_hash = encode(sha256(convert_to(h.key_salt || p_key, 'UTF8')), 'hex')
  limit 1;
$$;

-- Familia sin clave (modo abierto, como la discoteca y la biblioteca): la primera que no tenga clave puesta.
create or replace function compra.open_household() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from compra.households where deleted_at is null and access_key_hash is null order by created_at limit 1;
$$;

-- Familia de una clave; si la familia no tiene clave, no hace falta enviarla.
create or replace function compra.household_for_request(p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(compra.household_for_key(p_key), compra.open_household());
$$;

-- Familia de la petición actual (null si hace falta clave y no es válida). Se usa en todas las políticas.
create or replace function compra.current_household_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select compra.household_for_request(compra.request_key());
$$;

create or replace function compra.require_household() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare h uuid := compra.current_household_id();
begin
  if h is null then
    raise exception 'clave_familiar_no_valida' using errcode = '42501',
      hint = 'Introduce la clave familiar en Ajustes o configúrala con compra.set_household_key().';
  end if;
  return h;
end $$;

-- OPCIONAL. Solo para el administrador (SQL Editor / service_role). Nunca se concede a anon.
-- Sin clave puesta, la despensa funciona en modo abierto, igual que la discoteca y la biblioteca.
create or replace function compra.set_household_key(p_key text, p_household uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  if char_length(coalesce(p_key, '')) < 10 then
    raise exception 'La clave familiar debe tener al menos 10 caracteres.';
  end if;
  h := coalesce(p_household, (select id from compra.households where deleted_at is null order by created_at limit 1));
  if h is null then raise exception 'No hay ninguna familia creada. Ejecuta antes la migración de datos iniciales.'; end if;
  update compra.households
     set key_salt = replace(gen_random_uuid()::text, '-', '')
   where id = h;
  update compra.households
     set access_key_hash = encode(sha256(convert_to(key_salt || p_key, 'UTF8')), 'hex')
   where id = h;
  insert into compra.audit_log (household_id, actor_label, action, entity, entity_id)
  values (h, 'administrador', 'set_household_key', 'households', h::text);
  return 'Clave familiar actualizada. Escríbela en Ajustes de la aplicación en cada dispositivo.';
end $$;

-- Quitar la clave: la despensa vuelve a abrirse sin clave (como la discoteca y la biblioteca).
create or replace function compra.clear_household_key(p_household uuid default null) returns text
language plpgsql security definer set search_path = '' as $$
declare h uuid;
begin
  h := coalesce(p_household, (select id from compra.households where deleted_at is null order by created_at limit 1));
  update compra.households set access_key_hash = null where id = h;
  insert into compra.audit_log (household_id, actor_label, action, entity, entity_id)
  values (h, 'administrador', 'clear_household_key', 'households', h::text);
  return 'Clave quitada: la despensa se abre sin clave.';
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema compra to anon, authenticated, service_role;

revoke all on all tables in schema compra from anon, authenticated;
revoke all on all functions in schema compra from public, anon, authenticated;
grant all on all tables in schema compra to service_role;
grant all on all sequences in schema compra to service_role;
grant execute on all functions in schema compra to service_role;

-- Lectura (protegida por RLS) para la aplicación
grant select on
  compra.family_profiles, compra.household_members, compra.stores, compra.store_zones, compra.category_zone_rules,
  compra.products, compra.product_images, compra.product_price_history, compra.product_promotions,
  compra.catalog_sync_runs, compra.catalog_changes, compra.product_zone_overrides,
  compra.shopping_lists, compra.shopping_list_items, compra.shopping_sessions, compra.shopping_item_results,
  compra.purchase_receipts, compra.app_settings, compra.audit_log
to anon, authenticated;
-- households, catalog_sync_tasks, catalog_sync_staging y processed_ops: sin acceso directo.

-- Funciones auxiliares usadas por las políticas
grant execute on function compra.request_key() to anon, authenticated;
grant execute on function compra.current_household_id() to anon, authenticated;

-- ---------------------------------------------------------------------
-- Row Level Security en TODAS las tablas
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'households', 'family_profiles', 'household_members', 'stores', 'store_zones', 'category_zone_rules',
    'products', 'product_images', 'product_price_history', 'product_promotions', 'catalog_sync_runs',
    'catalog_sync_tasks', 'catalog_sync_staging', 'catalog_changes', 'product_zone_overrides',
    'shopping_lists', 'shopping_list_items', 'shopping_sessions', 'shopping_item_results',
    'purchase_receipts', 'app_settings', 'audit_log', 'processed_ops'] loop
    execute format('alter table compra.%I enable row level security', t);
  end loop;
end $$;

-- Tablas de la familia: solo las filas de la familia cuya clave llega en la petición.
do $$
declare t text;
begin
  foreach t in array array[
    'family_profiles', 'household_members', 'stores', 'store_zones', 'category_zone_rules', 'product_zone_overrides',
    'shopping_lists', 'shopping_list_items', 'shopping_sessions', 'shopping_item_results',
    'purchase_receipts', 'app_settings', 'audit_log'] loop
    execute format('drop policy if exists family_read on compra.%I', t);
    execute format('create policy family_read on compra.%I for select to anon, authenticated using (household_id = (select compra.current_household_id()))', t);
  end loop;
end $$;

-- Recibos borrados lógicamente: no se listan
drop policy if exists family_read on compra.purchase_receipts;
create policy family_read on compra.purchase_receipts for select to anon, authenticated
  using (household_id = (select compra.current_household_id()) and deleted_at is null);

-- Catálogo compartido: legible con cualquier clave familiar válida.
do $$
declare t text;
begin
  foreach t in array array['products', 'product_images', 'product_price_history', 'product_promotions', 'catalog_sync_runs', 'catalog_changes'] loop
    execute format('drop policy if exists catalog_read on compra.%I', t);
    execute format('create policy catalog_read on compra.%I for select to anon, authenticated using ((select compra.current_household_id()) is not null)', t);
  end loop;
end $$;

-- El rol de servicio (funciones Edge) trabaja sin restricciones de RLS.
do $$
declare t text;
begin
  foreach t in array array[
    'households', 'family_profiles', 'household_members', 'stores', 'store_zones', 'category_zone_rules',
    'products', 'product_images', 'product_price_history', 'product_promotions', 'catalog_sync_runs',
    'catalog_sync_tasks', 'catalog_sync_staging', 'catalog_changes', 'product_zone_overrides',
    'shopping_lists', 'shopping_list_items', 'shopping_sessions', 'shopping_item_results',
    'purchase_receipts', 'app_settings', 'audit_log', 'processed_ops'] loop
    execute format('drop policy if exists service_all on compra.%I', t);
    execute format('create policy service_all on compra.%I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;
