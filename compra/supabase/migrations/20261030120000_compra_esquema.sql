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
