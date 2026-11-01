-- =====================================================================
-- HOGAR · NUESTRA DESPENSA FAMILIAR · 8 · Pendientes, segunda lista y menú semanal
-- ---------------------------------------------------------------------
--  · «Pendientes de revisar»: marca por producto (una sola vez por familia).
--  · «Pendientes no urgentes»: segunda lista, siempre abierta, con cantidades.
--    Mover entre listas es UNA transacción: o se mueve todo o no se mueve nada.
--  · «Menú semanal»: recetas (nombre normalizado + imagen obligatoria) y su
--    uso en cada día (comida / cena). Nada se borra al cambiar de semana.
--  · Bucket público «compra-recetas» para las fotos que se suban a mano.
-- Se puede ejecutar varias veces. No borra ni modifica datos existentes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nombre normalizado: sin mayúsculas, tildes ni espacios repetidos (la ñ se conserva)
-- ---------------------------------------------------------------------
create or replace function compra.norm_key(p text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(p, ''), 'ÁÀÂÄÃáàâäãÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÇçÑ', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcñ')),
    '[^a-z0-9ñ]+', ' ', 'g'));
$$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists compra.product_review_flags (
  household_id uuid not null references compra.households(id) on delete cascade,
  product_id   uuid not null references compra.products(id) on delete cascade,
  note         text check (note is null or char_length(note) <= 200),
  flagged_by   uuid references compra.family_profiles(id) on delete set null,
  flagged_at   timestamptz not null default now(),
  primary key (household_id, product_id)
);

create table if not exists compra.backlog_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references compra.households(id) on delete cascade,
  product_id   uuid not null references compra.products(id) on delete cascade,
  quantity     smallint not null default 1 check (quantity between 1 and 99),
  notes        text check (notes is null or char_length(notes) <= 200),
  added_by     uuid references compra.family_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (household_id, product_id)
);

create table if not exists compra.recipes (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references compra.households(id) on delete cascade,
  name           text not null check (char_length(btrim(name)) between 1 and 120),
  name_key       text not null check (char_length(name_key) between 1 and 120),
  image_url      text not null check (image_url ~ '^https://' and char_length(image_url) <= 2000),
  image_source   text check (image_source is null or char_length(image_source) <= 60),
  image_page_url text check (image_page_url is null or (image_page_url ~ '^https?://' and char_length(image_page_url) <= 2000)),
  image_credit   text check (image_credit is null or char_length(image_credit) <= 300),
  for_lunch      boolean not null default false,
  for_dinner     boolean not null default false,
  category       text generated always as (case when for_lunch and for_dinner then 'ambas' when for_lunch then 'comida' when for_dinner then 'cena' else 'sin_usar' end) stored,
  created_by     uuid references compra.family_profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (household_id, name_key)
);

create table if not exists compra.menu_entries (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references compra.households(id) on delete cascade,
  recipe_id    uuid not null references compra.recipes(id) on delete restrict,
  menu_date    date not null,
  week_start   date not null,                                   -- lunes de esa semana
  weekday      smallint not null check (weekday between 1 and 7), -- 1 = lunes … 7 = domingo
  slot         text not null check (slot in ('comida', 'cena')),
  position     smallint not null default 0,
  created_by   uuid references compra.family_profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (week_start = menu_date - (weekday - 1)),
  unique (household_id, menu_date, slot, recipe_id)
);
create index if not exists menu_entries_week on compra.menu_entries (household_id, week_start);
create index if not exists backlog_items_household on compra.backlog_items (household_id);

do $$
declare t text;
begin
  foreach t in array array['backlog_items', 'recipes'] loop
    execute format('drop trigger if exists touch_%1$s on compra.%1$I', t);
    execute format('create trigger touch_%1$s before update on compra.%1$I for each row execute function compra.touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Seguridad: lectura solo de la propia familia; escrituras solo por funciones
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['product_review_flags', 'backlog_items', 'recipes', 'menu_entries'] loop
    execute format('alter table compra.%I enable row level security', t);
    execute format('revoke all on compra.%I from public, anon, authenticated', t);
    execute format('grant select on compra.%I to anon, authenticated', t);
    execute format('grant all on compra.%I to service_role', t);
    execute format('drop policy if exists family_read on compra.%I', t);
    execute format('create policy family_read on compra.%I for select to anon, authenticated using (household_id = (select compra.current_household_id()))', t);
    execute format('drop policy if exists service_all on compra.%I', t);
    execute format('create policy service_all on compra.%I for all to service_role using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Pendientes de revisar
-- ---------------------------------------------------------------------
create or replace function compra.set_review_flag(p_product_id uuid, p_flagged boolean, p_note text default null, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  f compra.product_review_flags%rowtype;
begin
  if p_product_id is null or not exists (select 1 from compra.products where id = p_product_id and deleted_at is null) then
    perform compra.fail('producto_no_existe', 'Ese producto no existe en el catálogo.');
  end if;
  if coalesce(p_flagged, false) then
    insert into compra.product_review_flags (household_id, product_id, note, flagged_by)
    values (h, p_product_id, left(nullif(btrim(p_note), ''), 200), actor)
    on conflict (household_id, product_id) do update
      set note = coalesce(excluded.note, compra.product_review_flags.note)
    returning * into f;
    perform compra.audit(h, actor, 'flag_review', 'products', p_product_id::text, '{}'::jsonb);
    return jsonb_build_object('flagged', true, 'flag', to_jsonb(f));
  end if;
  delete from compra.product_review_flags where household_id = h and product_id = p_product_id;
  perform compra.audit(h, actor, 'unflag_review', 'products', p_product_id::text, '{}'::jsonb);
  return jsonb_build_object('flagged', false, 'product_id', p_product_id);
end $$;

-- ---------------------------------------------------------------------
-- Pendientes no urgentes
-- ---------------------------------------------------------------------
create or replace function compra.backlog_payload(p_household uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]'::jsonb)
  from compra.backlog_items b where b.household_id = p_household;
$$;

-- [{product_id, quantity (0 = quitar), notes}] · cantidades absolutas · op_id idempotente
create or replace function compra.save_backlog(p_changes jsonb, p_actor text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  c record; r jsonb;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 400 then
    perform compra.fail('cambios_no_validos', 'La lista de cambios no tiene el formato esperado.');
  end if;
  for c in select * from jsonb_to_recordset(p_changes) as x(product_id uuid, quantity integer, notes text) loop
    if c.product_id is null or c.quantity is null or c.quantity < 0 or c.quantity > 99 then
      perform compra.fail('cantidad_no_valida', 'Cada producto necesita una cantidad entre 0 y 99.');
    end if;
    if c.quantity = 0 then
      delete from compra.backlog_items where household_id = h and product_id = c.product_id;
    else
      if not exists (select 1 from compra.products where id = c.product_id and deleted_at is null) then
        perform compra.fail('producto_no_existe', 'Un producto ya no existe en el catálogo.');
      end if;
      insert into compra.backlog_items (household_id, product_id, quantity, notes, added_by)
      values (h, c.product_id, c.quantity, left(nullif(btrim(c.notes), ''), 200), actor)
      on conflict (household_id, product_id) do update
        set quantity = excluded.quantity, notes = coalesce(excluded.notes, compra.backlog_items.notes);
    end if;
  end loop;
  if (select count(*) from compra.backlog_items where household_id = h) > 400 then
    perform compra.fail('lista_demasiado_grande', 'Los pendientes no urgentes no pueden tener más de 400 productos distintos.');
  end if;
  r := jsonb_build_object('backlog', compra.backlog_payload(h));
  return compra.op_store(h, p_op_id, 'save_backlog', r);
end $$;

-- Mueve un producto entre la lista principal (borrador) y «Pendientes no urgentes».
-- p_to: 'backlog' | 'main'. Se quita del origen y se suma en el destino (sin duplicar).
create or replace function compra.move_between_lists(p_product_id uuid, p_to text, p_actor text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  l compra.shopping_lists%rowtype;
  it compra.shopping_list_items%rowtype;
  b compra.backlog_items%rowtype;
  p record; r jsonb; moved integer;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_to not in ('backlog', 'main') then perform compra.fail('destino_no_valido', 'Destino no válido.'); end if;
  select * into l from compra.shopping_lists where household_id = h and status = 'draft' and deleted_at is null for update;

  if p_to = 'backlog' then
    if l.id is not null then select * into it from compra.shopping_list_items where list_id = l.id and product_id = p_product_id for update; end if;
    if it.id is null then perform compra.fail('no_esta_en_la_lista', 'Ese producto ya no está en la lista principal.'); end if;
    moved := it.quantity;
    delete from compra.shopping_list_items where id = it.id;
    insert into compra.backlog_items (household_id, product_id, quantity, notes, added_by)
    values (h, p_product_id, least(99, moved), it.notes, actor)
    on conflict (household_id, product_id) do update
      set quantity = least(99, compra.backlog_items.quantity + excluded.quantity),
          notes = coalesce(compra.backlog_items.notes, excluded.notes);
    perform compra.recalc_list(l.id);
  else
    select * into b from compra.backlog_items where household_id = h and product_id = p_product_id for update;
    if b.id is null then perform compra.fail('no_esta_en_pendientes', 'Ese producto ya no está en «Pendientes no urgentes».'); end if;
    select id, price, previous_price, price_decreased, visible_in_app into p from compra.products where id = p_product_id and deleted_at is null;
    if p.id is null then perform compra.fail('producto_no_existe', 'Ese producto ya no existe en el catálogo.'); end if;
    if not p.visible_in_app then perform compra.fail('producto_oculto', 'Ese producto pertenece a una categoría oculta.'); end if;
    if l.id is null then
      insert into compra.shopping_lists (household_id, store_id, created_by) values (h, compra.default_store(h), actor) returning * into l;
    end if;
    moved := b.quantity;
    delete from compra.backlog_items where id = b.id;
    insert into compra.shopping_list_items (household_id, list_id, product_id, quantity, unit_price_snapshot, regular_price_snapshot, notes, added_by)
    values (h, l.id, p_product_id, least(99, moved), p.price, case when p.price_decreased then p.previous_price end, b.notes, actor)
    on conflict (list_id, product_id) do update
      set quantity = least(99, compra.shopping_list_items.quantity + excluded.quantity),
          notes = coalesce(compra.shopping_list_items.notes, excluded.notes);
    if (select count(*) from compra.shopping_list_items where list_id = l.id) > 400 then
      perform compra.fail('lista_demasiado_grande', 'La lista no puede tener más de 400 productos distintos.');
    end if;
    perform compra.recalc_list(l.id);
  end if;

  perform compra.audit(h, actor, 'move_between_lists', 'products', p_product_id::text, jsonb_build_object('to', p_to, 'quantity', moved));
  r := jsonb_build_object('to', p_to, 'quantity', moved,
         'draft', case when l.id is null then null else compra.list_payload(l.id) end,
         'backlog', compra.backlog_payload(h));
  return compra.op_store(h, p_op_id, 'move_between_lists', r);
end $$;

-- ---------------------------------------------------------------------
-- Menú semanal
-- ---------------------------------------------------------------------
-- Añade una receta a un día. Si p_recipe_id es null se busca por nombre normalizado:
-- si ya existe se reutiliza (con su imagen); si no, se crea y la imagen es obligatoria.
create or replace function compra.menu_add(p_date date, p_slot text, p_recipe_id uuid default null, p_name text default null,
  p_image_url text default null, p_image_source text default null, p_image_page_url text default null, p_image_credit text default null,
  p_actor text default null, p_op_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  rc compra.recipes%rowtype;
  e compra.menu_entries%rowtype;
  k text; wd smallint; r jsonb;
begin
  if p_op_id is not null then r := compra.op_result(h, p_op_id); if r is not null then return r; end if; end if;
  if p_date is null or p_slot not in ('comida', 'cena') then perform compra.fail('menu_no_valido', 'Falta el día o si es comida o cena.'); end if;
  if p_date < date '2000-01-01' or p_date > date '2100-12-31' then perform compra.fail('menu_no_valido', 'Fecha fuera de rango.'); end if;

  if p_recipe_id is not null then
    select * into rc from compra.recipes where id = p_recipe_id and household_id = h for update;
    if rc.id is null then perform compra.fail('receta_no_existe', 'Esa receta no existe.'); end if;
  else
    k := compra.norm_key(p_name);
    if k = '' or char_length(btrim(coalesce(p_name, ''))) > 120 then perform compra.fail('receta_no_valida', 'Escribe el nombre de la receta (máximo 120 caracteres).'); end if;
    select * into rc from compra.recipes where household_id = h and name_key = k for update;
    if rc.id is null then
      if p_image_url is null or p_image_url !~ '^https://' then
        perform compra.fail('imagen_obligatoria', 'Elige una imagen para la receta antes de guardarla.');
      end if;
      insert into compra.recipes (household_id, name, name_key, image_url, image_source, image_page_url, image_credit, created_by)
      values (h, btrim(regexp_replace(p_name, '\s+', ' ', 'g')), k, left(p_image_url, 2000), left(p_image_source, 60),
              case when p_image_page_url ~ '^https?://' then left(p_image_page_url, 2000) end, left(p_image_credit, 300), actor)
      returning * into rc;
    end if;
  end if;

  -- La receta queda guardada en la categoría en la que se usa (comida, cena o ambas).
  update compra.recipes set for_lunch = for_lunch or p_slot = 'comida', for_dinner = for_dinner or p_slot = 'cena'
   where id = rc.id returning * into rc;

  wd := extract(isodow from p_date)::smallint;
  insert into compra.menu_entries (household_id, recipe_id, menu_date, week_start, weekday, slot, position, created_by)
  values (h, rc.id, p_date, p_date - (wd - 1), wd, p_slot,
          coalesce((select max(position) + 1 from compra.menu_entries where household_id = h and menu_date = p_date and slot = p_slot), 0), actor)
  on conflict (household_id, menu_date, slot, recipe_id) do nothing
  returning * into e;
  if e.id is null then
    select * into e from compra.menu_entries where household_id = h and menu_date = p_date and slot = p_slot and recipe_id = rc.id;
  end if;
  perform compra.audit(h, actor, 'menu_add', 'menu_entries', e.id::text, jsonb_build_object('recipe', rc.name, 'date', p_date, 'slot', p_slot));
  r := jsonb_build_object('entry', to_jsonb(e), 'recipe', to_jsonb(rc));
  return compra.op_store(h, p_op_id, 'menu_add', r);
end $$;

create or replace function compra.menu_remove(p_entry_id uuid, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  e compra.menu_entries%rowtype;
begin
  delete from compra.menu_entries where id = p_entry_id and household_id = h returning * into e;
  if e.id is not null then
    perform compra.audit(h, actor, 'menu_remove', 'menu_entries', e.id::text, jsonb_build_object('date', e.menu_date, 'slot', e.slot));
  end if;
  return jsonb_build_object('removed', e.id is not null, 'id', p_entry_id);
end $$;

-- Cambiar la imagen de una receta (por ejemplo, si la original deja de verse).
create or replace function compra.recipe_set_image(p_recipe_id uuid, p_image_url text, p_image_source text default null,
  p_image_page_url text default null, p_image_credit text default null, p_actor text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  h uuid := compra.require_household();
  actor uuid := compra.profile_id(h, p_actor);
  rc compra.recipes%rowtype;
begin
  if p_image_url is null or p_image_url !~ '^https://' then perform compra.fail('imagen_obligatoria', 'La imagen no es válida.'); end if;
  update compra.recipes
     set image_url = left(p_image_url, 2000), image_source = left(p_image_source, 60),
         image_page_url = case when p_image_page_url ~ '^https?://' then left(p_image_page_url, 2000) end,
         image_credit = left(p_image_credit, 300)
   where id = p_recipe_id and household_id = h
  returning * into rc;
  if rc.id is null then perform compra.fail('receta_no_existe', 'Esa receta no existe.'); end if;
  perform compra.audit(h, actor, 'recipe_set_image', 'recipes', rc.id::text, '{}'::jsonb);
  return to_jsonb(rc);
end $$;

-- ---------------------------------------------------------------------
-- Permisos de ejecución (como el resto: anon con la clave familiar, si está activada)
-- ---------------------------------------------------------------------
revoke execute on function
  compra.set_review_flag(uuid, boolean, text, text), compra.save_backlog(jsonb, text, uuid),
  compra.move_between_lists(uuid, text, text, uuid),
  compra.menu_add(date, text, uuid, text, text, text, text, text, text, uuid), compra.menu_remove(uuid, text),
  compra.recipe_set_image(uuid, text, text, text, text, text), compra.backlog_payload(uuid)
from public;
grant execute on function
  compra.set_review_flag(uuid, boolean, text, text), compra.save_backlog(jsonb, text, uuid),
  compra.move_between_lists(uuid, text, text, uuid),
  compra.menu_add(date, text, uuid, text, text, text, text, text, text, uuid), compra.menu_remove(uuid, text),
  compra.recipe_set_image(uuid, text, text, text, text, text)
to anon, authenticated;
grant execute on function compra.norm_key(text) to anon, authenticated, service_role;
grant execute on function
  compra.set_review_flag(uuid, boolean, text, text), compra.save_backlog(jsonb, text, uuid),
  compra.move_between_lists(uuid, text, text, uuid),
  compra.menu_add(date, text, uuid, text, text, text, text, text, text, uuid), compra.menu_remove(uuid, text),
  compra.recipe_set_image(uuid, text, text, text, text, text), compra.backlog_payload(uuid)
to service_role;

-- ---------------------------------------------------------------------
-- Bucket PÚBLICO para fotos de recetas subidas a mano (solo escribe la función Edge)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('compra-recetas', 'compra-recetas', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- Avisar a la API de Supabase de que hay tablas y funciones nuevas
notify pgrst, 'reload schema';
