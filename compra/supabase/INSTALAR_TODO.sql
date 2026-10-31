-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · INSTALACIÓN COMPLETA EN UN SOLO PASO
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Es la unión de las 4 migraciones de supabase/migrations, en orden.
-- Se puede ejecutar varias veces sin duplicar nada. No necesita clave.
-- =====================================================================

-- >>> 20261030120000_compra_esquema.sql
-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 1/4 · Esquema y tablas
-- ---------------------------------------------------------------------
-- Todo vive en un esquema propio («compra») para no mezclarse con las
-- tablas de la discoteca ni de la biblioteca aunque compartan proyecto.
-- Migración reproducible: se puede ejecutar varias veces sin romper nada.
-- =====================================================================

-- Sin extensiones: solo funciones de PostgreSQL de serie (sha256, gen_random_uuid),
-- para que funcione igual en cualquier proyecto (las extensiones pueden estar en otro esquema).

create schema if not exists compra;
comment on schema compra is 'Nuestra despensa familiar: compra semanal en Mercadona (Hogar).';

-- Las funciones nuevas NO se pueden ejecutar por defecto: cada una se concede explícitamente.
alter default privileges in schema compra revoke execute on functions from public;

-- ---------------------------------------------------------------------
-- Utilidad: marca de tiempo de actualización
-- ---------------------------------------------------------------------
create or replace function compra.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
-- FAMILIA
-- =====================================================================
create table if not exists compra.households (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  access_key_hash text,                                   -- sha256(salt || clave familiar); nunca la clave
  key_salt        text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table if not exists compra.family_profiles (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references compra.households(id) on delete cascade,
  code         text not null check (code ~ '^[a-z0-9_]{2,20}$'),   -- identificador estable: papa, mama, adrian
  display_name text not null check (char_length(display_name) between 1 and 40),
  color        text not null default '#687086' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order   smallint not null default 0,
  can_shop     boolean not null default true,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, code),
  unique (household_id, id)
);

create table if not exists compra.household_members (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references compra.households(id) on delete cascade,
  profile_id   uuid not null,
  role         text not null default 'member' check (role in ('admin', 'member')),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (household_id, profile_id),
  foreign key (household_id, profile_id) references compra.family_profiles(household_id, id) on delete cascade
);

-- =====================================================================
-- TIENDA, ZONAS Y REGLAS
-- =====================================================================
create table if not exists compra.stores (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references compra.households(id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 80),
  postal_code    text check (postal_code is null or postal_code ~ '^[0-9]{5}$'),
  warehouse_code text check (warehouse_code is null or warehouse_code ~ '^[a-z0-9]{2,12}$'),
  is_default     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (household_id, id)
);
create unique index if not exists stores_one_default on compra.stores (household_id) where is_default and deleted_at is null;

create table if not exists compra.store_zones (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  store_id     uuid not null,
  code         text not null check (code ~ '^z[0-9]{2}$'),
  route_order  smallint not null check (route_order between 1 and 99),
  name         text not null check (char_length(name) between 1 and 60),
  summary      text not null default '' check (char_length(summary) <= 200),   -- resumen para las flechas
  color        text not null check (color ~ '^#[0-9a-fA-F]{6}$'),
  map_shapes   jsonb not null default '[]'::jsonb check (jsonb_typeof(map_shapes) = 'array'),
  active       boolean not null default true,
  notes        text check (notes is null or char_length(notes) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, route_order),
  unique (store_id, code),
  unique (household_id, id),
  foreign key (household_id, store_id) references compra.stores(household_id, id) on delete cascade
);

-- Asociación por IDENTIFICADOR de categoría externa (nivel 0 sección, 1 categoría, 2 subcategoría).
create table if not exists compra.category_zone_rules (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null,
  store_id             uuid not null,
  zone_id              uuid,                       -- null = categoría explícitamente sin zona
  level                smallint not null check (level in (0, 1, 2)),
  external_category_id integer not null,
  category_name        text not null,
  source               text not null default 'manual' check (source in ('seed', 'manual', 'auto')),
  confirmed            boolean not null default true,
  confirm_manually     boolean not null default false,  -- pedir confirmación para productos nuevos
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (store_id, level, external_category_id),
  foreign key (household_id, store_id) references compra.stores(household_id, id) on delete cascade,
  foreign key (household_id, zone_id) references compra.store_zones(household_id, id) on delete cascade
);

-- =====================================================================
-- CATÁLOGO (compartido; solo lo escribe la función del servidor)
-- =====================================================================
create table if not exists compra.products (
  id                   uuid primary key default gen_random_uuid(),
  external_id          text not null unique check (external_id ~ '^[0-9A-Za-z._-]{1,40}$'),
  ean                  text check (ean is null or ean ~ '^[0-9]{6,14}$'),
  name                 text not null check (char_length(name) between 1 and 300),
  description          text,
  brand                text,
  packaging            text,                       -- formato: Brik, Garrafa, Paquete…
  format_label         text,                       -- «Brik 1 L»
  category_id          integer,
  category_name        text,
  subcategory_id       integer,
  subcategory_name     text,
  subsubcategory_id    integer,
  subsubcategory_name  text,
  price                numeric(10,2) check (price is null or price >= 0),
  unit_price           numeric(10,3) check (unit_price is null or unit_price >= 0),  -- precio por unidad de medida
  unit_of_measure      text,                       -- L, kg, ud…
  unit_size            numeric(10,3),
  size_format          text,
  selling_method       smallint,
  is_bulk              boolean not null default false,
  approx_size          boolean not null default false,
  previous_price       numeric(10,2),              -- precio anterior declarado por la fuente
  price_decreased      boolean not null default false,  -- bajada declarada por la fuente (promoción)
  price_before_change  numeric(10,2),              -- precio anterior detectado por nosotros
  price_change_kind    text check (price_change_kind is null or price_change_kind in ('increase', 'decrease')),
  price_changed_at     timestamptz,
  image_url            text,
  thumbnail_url        text,
  image_hash           text,
  share_url            text,
  is_new_arrival       boolean not null default false,
  new_until            timestamptz,                -- marca «nuevo» en la interfaz
  active               boolean not null default true,
  visible_in_app       boolean not null default true,
  availability         text not null default 'available'
                       check (availability in ('available', 'temporarily_unavailable', 'possibly_removed', 'removed')),
  missing_streak       smallint not null default 0 check (missing_streak >= 0),
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz,
  first_missing_at     timestamptz,
  removed_at           timestamptz,
  detail_fetched_at    timestamptz,
  source               text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);
create index if not exists products_updated_at on compra.products (updated_at);
create index if not exists products_visible on compra.products (visible_in_app, active);
create index if not exists products_cat on compra.products (category_id, subcategory_id, subsubcategory_id);
create index if not exists products_name on compra.products (lower(name));

create table if not exists compra.product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references compra.products(id) on delete cascade,
  url           text,
  thumbnail_url text not null,
  perspective   smallint,
  image_hash    text not null,
  is_primary    boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  replaced_at   timestamptz,
  unique (product_id, image_hash)
);

create table if not exists compra.catalog_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  status            text not null default 'running' check (status in ('running', 'applying', 'completed', 'failed', 'aborted')),
  trigger_kind      text not null default 'auto' check (trigger_kind in ('auto', 'manual')),
  provider          text,
  postal_code       text,
  warehouse_code    text,
  household_id      uuid references compra.households(id) on delete set null,
  requested_by      text,
  lock_token        uuid not null default gen_random_uuid(),
  is_baseline       boolean not null default false,
  started_at        timestamptz not null default now(),
  heartbeat_at      timestamptz not null default now(),
  finished_at       timestamptz,
  categories_total  integer not null default 0,
  categories_done   integer not null default 0,
  categories_failed integer not null default 0,
  products_seen     integer not null default 0,
  stats             jsonb not null default '{}'::jsonb,
  log               jsonb not null default '[]'::jsonb,
  error             text
);
-- Solo una sincronización global a la vez.
create unique index if not exists catalog_sync_one_active on compra.catalog_sync_runs ((true)) where status in ('running', 'applying');
create index if not exists catalog_sync_runs_finished on compra.catalog_sync_runs (status, finished_at desc);

create table if not exists compra.catalog_sync_tasks (
  run_id        uuid not null references compra.catalog_sync_runs(id) on delete cascade,
  category_id   integer not null,
  category_name text,
  section_id    integer,
  status        text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts      smallint not null default 0,
  provider_used text,
  products      integer not null default 0,
  error         text,
  updated_at    timestamptz not null default now(),
  primary key (run_id, category_id)
);

create table if not exists compra.catalog_sync_staging (
  run_id      uuid not null references compra.catalog_sync_runs(id) on delete cascade,
  external_id text not null,
  data        jsonb not null,
  primary key (run_id, external_id)
);

create table if not exists compra.product_price_history (
  id             uuid primary key default gen_random_uuid(),
  product_id     uuid not null references compra.products(id) on delete cascade,
  price          numeric(10,2),
  unit_price     numeric(10,3),
  previous_price numeric(10,2),
  change_eur     numeric(10,2),
  change_pct     numeric(8,2),
  change_type    text not null check (change_type in ('initial', 'increase', 'decrease')),
  promo_declared boolean not null default false,
  sync_run_id    uuid references compra.catalog_sync_runs(id) on delete set null,
  recorded_at    timestamptz not null default now()
);
create index if not exists price_history_product on compra.product_price_history (product_id, recorded_at desc);

create table if not exists compra.product_promotions (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references compra.products(id) on delete cascade,
  kind          text not null default 'source_price_drop' check (kind in ('source_price_drop')),
  promo_price   numeric(10,2),
  regular_price numeric(10,2),
  started_at    timestamptz not null default now(),   -- primera sincronización en la que se vio
  ended_at      timestamptz,                           -- primera sincronización en la que ya no estaba
  start_run_id  uuid references compra.catalog_sync_runs(id) on delete set null,
  end_run_id    uuid references compra.catalog_sync_runs(id) on delete set null
);
create unique index if not exists promotions_one_open on compra.product_promotions (product_id) where ended_at is null;

create table if not exists compra.catalog_changes (
  id           bigint generated always as identity primary key,
  run_id       uuid references compra.catalog_sync_runs(id) on delete set null,
  product_id   uuid not null references compra.products(id) on delete cascade,
  change_type  text not null check (change_type in (
                 'new_product', 'possibly_removed', 'removed', 'reappeared', 'name_change', 'format_change',
                 'category_change', 'subcategory_change', 'price_increase', 'price_decrease', 'promo_start',
                 'promo_end', 'photo_change', 'temporarily_unavailable', 'available_again')),
  old_value    jsonb,
  new_value    jsonb,
  needs_review boolean not null default false,
  detected_at  timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  text
);
create index if not exists catalog_changes_recent on compra.catalog_changes (detected_at desc);
create index if not exists catalog_changes_review on compra.catalog_changes (change_type) where needs_review and reviewed_at is null;

-- Excepción manual de zona para un producto concreto
create table if not exists compra.product_zone_overrides (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  store_id     uuid not null,
  product_id   uuid not null references compra.products(id) on delete cascade,
  zone_id      uuid not null,
  reason       text check (reason is null or char_length(reason) <= 200),
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (store_id, product_id),
  foreign key (household_id, store_id) references compra.stores(household_id, id) on delete cascade,
  foreign key (household_id, zone_id) references compra.store_zones(household_id, id) on delete cascade
);

-- =====================================================================
-- LISTAS Y COMPRAS
-- =====================================================================
create table if not exists compra.shopping_lists (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references compra.households(id) on delete cascade,
  store_id           uuid not null,
  status             text not null default 'draft' check (status in ('draft', 'ready_to_shop', 'shopping', 'completed', 'cancelled')),
  version            integer not null default 1,
  estimated_total    numeric(10,2) not null default 0,
  prices_checked_at  timestamptz,
  created_by         uuid,
  closed_by          uuid,
  created_at         timestamptz not null default now(),
  closed_at          timestamptz,
  reopened_at        timestamptz,
  shopping_started_at timestamptz,
  completed_at       timestamptz,
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (household_id, id),
  foreign key (household_id, store_id) references compra.stores(household_id, id)
);
-- Una lista abierta y una cerrada pendiente (o en curso) como máximo por familia.
create unique index if not exists lists_one_draft on compra.shopping_lists (household_id) where status = 'draft' and deleted_at is null;
create unique index if not exists lists_one_pending on compra.shopping_lists (household_id) where status in ('ready_to_shop', 'shopping') and deleted_at is null;
create index if not exists lists_completed on compra.shopping_lists (household_id, completed_at desc) where status = 'completed';

create table if not exists compra.shopping_list_items (
  id                      uuid primary key default gen_random_uuid(),
  household_id            uuid not null,
  list_id                 uuid not null,
  product_id              uuid not null references compra.products(id),
  quantity                smallint not null check (quantity between 1 and 99),
  unit_price_snapshot     numeric(10,2),        -- lo fija el servidor, nunca el cliente
  regular_price_snapshot  numeric(10,2),        -- precio sin promoción, si la fuente la declaraba
  zone_id_snapshot        uuid,
  notes                   text check (notes is null or char_length(notes) <= 200),
  unavailable_ack_at      timestamptz,          -- «conservar» un producto retirado sin volver a avisar
  added_by                uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (list_id, product_id),
  unique (household_id, id),
  foreign key (household_id, list_id) references compra.shopping_lists(household_id, id) on delete cascade
);
create index if not exists list_items_product on compra.shopping_list_items (product_id);

create table if not exists compra.shopping_sessions (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null,
  list_id               uuid not null unique,          -- una sola sesión por lista
  shopper_profile_id    uuid not null,
  status                text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  device_id             text check (device_id is null or char_length(device_id) <= 64),
  started_at            timestamptz not null default now(),
  ended_at              timestamptz,
  duration_seconds      integer check (duration_seconds is null or duration_seconds >= 0),
  previous_avg_seconds  numeric(12,2),
  deviation_pct         numeric(8,2),
  planned_items         integer,
  collected_items       integer,
  partial_items         integer,
  missing_items         integer,
  initial_estimated_total numeric(10,2),
  final_estimated_total numeric(10,2),
  detected_savings      numeric(10,2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, list_id) references compra.shopping_lists(household_id, id) on delete cascade,
  foreign key (household_id, shopper_profile_id) references compra.family_profiles(household_id, id)
);
create unique index if not exists sessions_one_active on compra.shopping_sessions (household_id) where status = 'active';
create index if not exists sessions_shopper on compra.shopping_sessions (shopper_profile_id, ended_at) where status = 'completed';

create table if not exists compra.shopping_item_results (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  session_id    uuid not null,
  list_item_id  uuid not null,
  product_id    uuid not null references compra.products(id),
  requested_qty smallint not null check (requested_qty between 1 and 99),
  collected_qty smallint not null default 0,
  status        text not null default 'pending' check (status in ('pending', 'collected', 'partial', 'out_of_stock')),
  resolved_at   timestamptz,
  device_id     text,
  updated_at    timestamptz not null default now(),
  unique (session_id, list_item_id),
  foreign key (household_id, session_id) references compra.shopping_sessions(household_id, id) on delete cascade,
  foreign key (household_id, list_item_id) references compra.shopping_list_items(household_id, id) on delete cascade,
  constraint item_result_consistent check (
       (status = 'pending' and collected_qty = 0)
    or (status = 'collected' and collected_qty = requested_qty)
    or (status = 'partial' and collected_qty > 0 and collected_qty < requested_qty)
    or (status = 'out_of_stock' and collected_qty = 0))
);

create table if not exists compra.purchase_receipts (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references compra.households(id) on delete cascade,
  session_id       uuid,
  storage_path     text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f-]{36}\.(jpg|png|webp|heic|pdf)$'),
  file_name        text check (file_name is null or char_length(file_name) <= 160),
  mime_type        text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  size_bytes       integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  paid_by          uuid,
  amount           numeric(10,2) check (amount is null or (amount >= 0 and amount < 100000)),
  receipt_date     date,
  notes            text check (notes is null or char_length(notes) <= 500),
  status           text not null default 'pending' check (status in ('pending', 'paid')),
  marked_paid_by   uuid,
  marked_paid_at   timestamptz,
  ocr_status       text not null default 'not_requested' check (ocr_status in ('not_requested', 'pending', 'done', 'failed')),
  ocr_text         text,
  uploaded_by      uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  foreign key (household_id, session_id) references compra.shopping_sessions(household_id, id) on delete set null (session_id)
);
create index if not exists receipts_pending on compra.purchase_receipts (household_id, status) where deleted_at is null;

create table if not exists compra.app_settings (
  household_id uuid not null references compra.households(id) on delete cascade,
  key          text not null check (key ~ '^[a-z_]{2,40}$'),
  value        jsonb not null,
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (household_id, key)
);

create table if not exists compra.audit_log (
  id           bigint generated always as identity primary key,
  household_id uuid references compra.households(id) on delete cascade,
  actor_id     uuid,
  actor_label  text,
  action       text not null,
  entity       text,
  entity_id    text,
  details      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_recent on compra.audit_log (household_id, created_at desc);

-- Operaciones ya aplicadas (cola sin conexión idempotente)
create table if not exists compra.processed_ops (
  op_id        uuid primary key,
  household_id uuid not null references compra.households(id) on delete cascade,
  kind         text not null,
  result       jsonb,
  applied_at   timestamptz not null default now()
);
create index if not exists processed_ops_age on compra.processed_ops (applied_at);

-- ---------------------------------------------------------------------
-- Disparadores updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['households', 'family_profiles', 'stores', 'store_zones', 'category_zone_rules', 'products',
                            'product_zone_overrides', 'shopping_lists', 'shopping_list_items', 'shopping_sessions',
                            'shopping_item_results', 'purchase_receipts', 'app_settings', 'catalog_sync_tasks'] loop
    execute format('drop trigger if exists touch_%1$s on compra.%1$I', t);
    execute format('create trigger touch_%1$s before update on compra.%1$I for each row execute function compra.touch_updated_at()', t);
  end loop;
end $$;

-- >>> 20261030120100_compra_seguridad.sql
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

-- >>> 20261030120200_compra_funciones.sql
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

-- >>> 20261030120300_compra_datos_iniciales.sql
-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 4/4 · Datos iniciales
-- ---------------------------------------------------------------------
-- Familia, perfiles (Papá, Mamá, Adrián), tienda, las 15 zonas del mapa,
-- reglas de zona por IDENTIFICADOR de categoría de Mercadona, ajustes y
-- el bucket privado de tickets. Idempotente: no duplica nada si se repite.
--
-- Identificadores de categoría comprobados en el catálogo real
-- (datania/mercadona-catalog · categories.json, octubre de 2026).
-- Nivel 0 = sección (p. ej. 5 «Panadería y pastelería»)
-- Nivel 1 = categoría (p. ej. 66 «Bollería envasada»)
-- =====================================================================

-- Identificadores fijos para que la migración sea reproducible
-- familia  00000000-0000-4000-8000-000000000001
-- tienda   00000000-0000-4000-8000-000000000101
insert into compra.households (id, name)
values ('00000000-0000-4000-8000-000000000001', 'Nuestra casa')
on conflict (id) do nothing;

insert into compra.family_profiles (id, household_id, code, display_name, color, sort_order, can_shop) values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'papa',   'Papá',   '#ef6f6c', 1, true),
  ('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'mama',   'Mamá',   '#8f6fc5', 2, true),
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000001', 'adrian', 'Adrián', '#3e9c87', 3, true)
on conflict (household_id, code) do nothing;

insert into compra.household_members (household_id, profile_id, role)
select '00000000-0000-4000-8000-000000000001', id, case when code in ('papa', 'mama') then 'admin' else 'member' end
from compra.family_profiles where household_id = '00000000-0000-4000-8000-000000000001'
on conflict (household_id, profile_id) do nothing;

insert into compra.stores (id, household_id, name, is_default)
values ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001', 'Nuestro Mercadona', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Zonas. map_shapes: rectángulos en una cuadrícula de 100 × 50 celdas
-- (x, y = esquina superior izquierda empezando en 1; w, h = ancho y alto; r = giro en grados;
--  lp = "end" coloca el número y el nombre abajo, p. ej. en fruta y verdura, donde está el arcón).
-- Se reproducen la forma y posición aproximadas del mapa conceptual.
-- ---------------------------------------------------------------------
insert into compra.store_zones (id, household_id, store_id, code, route_order, name, summary, color, map_shapes, notes) values
  ('00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z01', 1,
   'Salsas, agua y caldos', 'Salsas · Aceitunas · Agua · Caldos', '#e5484d',
   '[{"x":8,"y":38,"w":39,"h":5}]', null),
  ('00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z02', 2,
   'Desayunos y yogures', 'Cereales · Yogures · Mantequilla', '#6fbf4a',
   '[{"x":1,"y":14,"w":6,"h":29}]', null),
  ('00000000-0000-4000-8000-000000001003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z03', 3,
   'Panadería', 'Pan · Pastelería', '#1ea5e0',
   '[{"x":1,"y":1,"w":15,"h":12}]', 'Toda la sección de panadería y pastelería excepto la bollería envasada.'),
  ('00000000-0000-4000-8000-000000001004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z04', 4,
   'Leche, zumos y dulces', 'Bollería envasada · Leche · Zumos · Dulces', '#2f3d94',
   '[{"x":9,"y":14,"w":7,"h":23}]', null),
  ('00000000-0000-4000-8000-000000001005', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z05', 5,
   'Charcutería y platos preparados', 'Charcutería · Quesos · Pizzas', '#a58fd6',
   '[{"x":18,"y":22,"w":9,"h":15}]', null),
  ('00000000-0000-4000-8000-000000001006', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z06', 6,
   'Carne, especias y café', 'Carne · Especias · Café', '#b34d5a',
   '[{"x":18,"y":1,"w":9,"h":16}]', null),
  ('00000000-0000-4000-8000-000000001007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z07', 7,
   'Conservas y frutos secos', 'Conservas · Frutos secos', '#f29a1d',
   '[{"x":29,"y":1,"w":8,"h":12}]', null),
  ('00000000-0000-4000-8000-000000001008', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z08', 8,
   'Snacks y refrescos', 'Patatas fritas · Refrescos', '#6b3fa0',
   '[{"x":29,"y":17,"w":8,"h":20}]', null),
  ('00000000-0000-4000-8000-000000001009', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z09', 9,
   'Bodega, huevos y aceite', 'Bodega · Huevos · Aceite', '#5d7c35',
   '[{"x":39,"y":17,"w":8,"h":20}]', null),
  ('00000000-0000-4000-8000-000000001010', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z10', 10,
   'Fruta y verdura', 'Fruta · Verdura', '#ef9f68',
   '[{"x":49,"y":15,"w":14,"h":22,"lp":"end"}]', null),
  ('00000000-0000-4000-8000-000000001011', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z11', 11,
   'Arroz, pasta y papel', 'Arroz · Pasta · Papel · Menaje', '#e3336f',
   '[{"x":65,"y":11,"w":9,"h":26}]', null),
  ('00000000-0000-4000-8000-000000001012', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z12', 12,
   'Limpieza', 'Detergentes · Lejía · Limpieza', '#8fa6c4',
   '[{"x":76,"y":5,"w":8,"h":32}]', null),
  ('00000000-0000-4000-8000-000000001013', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z13', 13,
   'Cuidado personal', 'Maquillaje · Cuidado facial · Cabello', '#2f7f93',
   '[{"x":86,"y":5,"w":14,"h":32}]', null),
  ('00000000-0000-4000-8000-000000001014', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z14', 14,
   'Pescado y marisco', 'Pescado · Marisco', '#7fae8f',
   '[{"x":50,"y":1,"w":50,"h":3}]', null),
  ('00000000-0000-4000-8000-000000001015', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', 'z15', 15,
   'Congelados', 'Congelados', '#f2cf1d',
   '[{"x":38,"y":6,"w":21,"h":3,"r":20},{"x":55,"y":17,"w":3,"h":13},{"x":63,"y":10,"w":2,"h":4}]',
   'Los tres arcones amarillos del mapa forman una sola zona.')
on conflict (store_id, code) do nothing;

-- ---------------------------------------------------------------------
-- Reglas por identificador (nivel 0 = sección, nivel 1 = categoría).
-- La regla más específica gana: «Panadería y pastelería» (sección 5) va a la
-- zona 3, pero «Bollería envasada» (66) tiene su propia regla a la zona 4.
-- ---------------------------------------------------------------------
with z as (select code, id from compra.store_zones where store_id = '00000000-0000-4000-8000-000000000101'),
r(level, cat_id, cat_name, zone_code) as (values
  -- Zona 1 · Salsas · Aceitunas y encurtidos · Agua · Caldos y cremas
  (1, 116, 'Mayonesa, ketchup y mostaza', 'z01'),
  (1, 117, 'Otras salsas', 'z01'),
  (1, 135, 'Aceitunas y encurtidos', 'z01'),
  (1, 156, 'Agua', 'z01'),
  (1, 129, 'Sopa y caldo', 'z01'),
  (1, 130, 'Gazpacho y cremas', 'z01'),
  -- Zona 2 · Cereales y galletas · Postres y yogures · Mantequilla y margarina
  (0,   7, 'Cereales y galletas', 'z02'),
  (0,  11, 'Postres y yogures', 'z02'),
  (1,  75, 'Mantequilla y margarina', 'z02'),
  -- Zona 3 · Panadería y pastelería (excepto Bollería envasada)
  (0,   5, 'Panadería y pastelería', 'z03'),
  -- Zona 4 · Bollería envasada · Leche y bebidas vegetales · Zumos · Azúcar, caramelos y chocolate
  (1,  66, 'Bollería envasada', 'z04'),
  (1,  72, 'Leche y bebidas vegetales', 'z04'),
  (0,  10, 'Zumos', 'z04'),
  (0,   9, 'Azúcar, caramelos y chocolate', 'z04'),
  -- Zona 5 · Charcutería y quesos · Pizzas y platos preparados
  (0,   4, 'Charcutería y quesos', 'z05'),
  (0,  16, 'Pizzas y platos preparados', 'z05'),
  -- Zona 6 · Carne · Especias · Cacao, café e infusiones
  (0,   3, 'Carne', 'z06'),
  (1, 115, 'Especias', 'z06'),
  (0,   8, 'Cacao, café e infusiones', 'z06'),
  -- Zona 7 · Conservas · Frutos secos y fruta desecada
  (0,  14, 'Conservas, caldos y cremas', 'z07'),   -- caldos y cremas tienen regla propia (zona 1)
  (1, 133, 'Frutos secos y fruta desecada', 'z07'),
  -- Zona 8 · Patatas fritas y snacks · Refrescos
  (1, 132, 'Patatas fritas y snacks', 'z08'),
  (0,  18, 'Agua y refrescos', 'z08'),             -- el agua tiene regla propia (zona 1)
  -- Zona 9 · Bodega · Huevos · Aceite, vinagre y sal
  (0,  19, 'Bodega', 'z09'),
  (1,  77, 'Huevos', 'z09'),
  (1, 112, 'Aceite, vinagre y sal', 'z09'),
  -- Zona 10 · Fruta y verdura
  (0,   1, 'Fruta y verdura', 'z10'),
  -- Zona 11 · Arroz, legumbres y pasta · Papel higiénico y celulosa · Menaje y conservación · Pilas y bolsas de basura
  (0,  13, 'Arroz, legumbres y pasta', 'z11'),
  (1, 238, 'Papel higiénico y celulosa', 'z11'),
  (1, 243, 'Menaje y conservación de alimentos', 'z11'),
  (1, 239, 'Pilas y bolsas de basura', 'z11'),
  -- Zona 12 · Limpieza
  (1, 226, 'Detergente y suavizante ropa', 'z12'),
  (1, 237, 'Estropajo, bayeta y guantes', 'z12'),
  (1, 241, 'Insecticida y ambientador', 'z12'),
  (1, 234, 'Lejía y líquidos fuertes', 'z12'),
  (1, 235, 'Limpiacristales', 'z12'),
  (1, 233, 'Limpiahogar y friegasuelos', 'z12'),
  (1, 231, 'Limpieza baño y WC', 'z12'),
  (1, 230, 'Limpieza cocina', 'z12'),
  (1, 232, 'Limpieza muebles y multiusos', 'z12'),
  (1, 229, 'Limpieza vajilla', 'z12'),
  -- Zona 13 · Maquillaje · Cuidado facial y corporal · Cuidado del cabello · Fitoterapia y parafarmacia
  (0,  22, 'Maquillaje', 'z13'),
  (0,  20, 'Cuidado facial y corporal', 'z13'),
  (0,  21, 'Cuidado del cabello', 'z13'),
  (0,  23, 'Fitoterapia y parafarmacia', 'z13'),
  -- Zona 14 · Marisco y pescado
  (0,   2, 'Marisco y pescado', 'z14'),
  -- Zona 15 · Congelados
  (0,  17, 'Congelados', 'z15')
)
insert into compra.category_zone_rules (household_id, store_id, zone_id, level, external_category_id, category_name, source, confirmed)
select '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', z.id, r.level, r.cat_id, r.cat_name, 'seed', true
from r join z on z.code = r.zone_code
on conflict (store_id, level, external_category_id) do nothing;

-- Ajustes iniciales
insert into compra.app_settings (household_id, key, value) values
  ('00000000-0000-4000-8000-000000000001', 'sync_interval_hours', '12'),
  ('00000000-0000-4000-8000-000000000001', 'hidden_category_ids', '[24, 25]'),          -- Bebé y Mascotas
  ('00000000-0000-4000-8000-000000000001', 'hidden_category_names', '["Bebé", "Mascotas"]'),
  ('00000000-0000-4000-8000-000000000001', 'manual_confirm_category_ids', '[]')
on conflict (household_id, key) do nothing;

-- ---------------------------------------------------------------------
-- Bucket PRIVADO para tickets (solo accesible desde la función Edge)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('compra-tickets', 'compra-tickets', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
