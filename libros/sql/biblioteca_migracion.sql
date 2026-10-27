-- =====================================================================
--  HOGAR · NUESTRA BIBLIOTECA FAMILIAR
--  Migración completa, acumulativa e idempotente para Supabase.
--
--  · Se ejecuta en Supabase → SQL Editor → New query → pegar → Run.
--  · Puede ejecutarse tantas veces como se quiera: NO borra tablas,
--    NO borra registros y NO usa DROP TABLE.
--  · Solo añade lo que falte (tablas, columnas, índices, restricciones,
--    políticas, triggers, bucket de portadas y publicación realtime).
--  · Si la tabla public.books ya existía con otro formato, la adapta sin
--    perder datos (convierte textos separados por comas en listas y copia
--    columnas antiguas como author/owner/genre/isbn/cover/year/format).
--
--  Proyecto: el indicado en libros/supabase-config.js (biblioteca).
--  La aplicación usa la publishable key con el rol "anon": sin login.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Funciones auxiliares
-- ---------------------------------------------------------------------

-- Mantiene created_at intacto en las ediciones y actualiza updated_at.
create or replace function public.biblioteca_touch_row()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at, now());
  else
    new.created_at := old.created_at;  -- la fecha de incorporación nunca cambia
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Familia (mismos nombres que la aplicación de discos)
-- ---------------------------------------------------------------------
create table if not exists public.book_family_members (
  name        text primary key,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.book_family_members (name, sort_order) values
  ('Papá', 1), ('Mamá', 2), ('María', 3), ('Adrián', 4)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- 2. Libros: una fila por ejemplar físico
-- ---------------------------------------------------------------------
create table if not exists public.books (
  id                      uuid primary key default gen_random_uuid(),
  title                   text not null,
  subtitle                text,
  authors                 text[] not null default '{}',
  isbn10                  text,
  isbn13                  text,
  publisher               text,
  published_year          integer,
  published_date          text,
  edition                 text,
  pages                   integer,
  genres                  text[] not null default '{}',
  language                text,
  cover_url               text,
  cover_path              text,
  openlibrary_work_id     text,
  openlibrary_edition_id  text,
  google_books_id         text,
  owners                  text[] not null default '{}',
  location                text,
  physical_format         text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- 2.1 Clave primaria "id" si la tabla existía sin ella.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'books' and column_name = 'id') then
    alter table public.books add column id uuid not null default gen_random_uuid();
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.books'::regclass and contype = 'p') then
    alter table public.books add primary key (id);
  end if;
end $$;

-- 2.2 Columnas de lista guardadas antes como texto → text[] (sin perder datos).
do $$
declare
  col    text;
  v_type text;
begin
  foreach col in array array['authors', 'genres', 'owners'] loop
    select data_type into v_type
      from information_schema.columns
     where table_schema = 'public' and table_name = 'books' and column_name = col;
    if v_type is not null and v_type <> 'ARRAY' then
      execute format('alter table public.books alter column %I drop default', col);
      execute format(
        'alter table public.books alter column %1$I type text[] using (
           case when %1$I is null or btrim(%1$I::text) = '''' then ''{}''::text[]
                else regexp_split_to_array(btrim(%1$I::text), ''\s*[,;]\s*'') end)', col);
    end if;
  end loop;
end $$;

-- 2.3 Columnas que puedan faltar en una tabla books antigua.
alter table public.books add column if not exists title                  text;
alter table public.books add column if not exists subtitle               text;
alter table public.books add column if not exists authors                text[];
alter table public.books add column if not exists isbn10                 text;
alter table public.books add column if not exists isbn13                 text;
alter table public.books add column if not exists publisher              text;
alter table public.books add column if not exists published_year         integer;
alter table public.books add column if not exists published_date         text;
alter table public.books add column if not exists edition                text;
alter table public.books add column if not exists pages                  integer;
alter table public.books add column if not exists genres                 text[];
alter table public.books add column if not exists language               text;
alter table public.books add column if not exists cover_url              text;
alter table public.books add column if not exists cover_path             text;
alter table public.books add column if not exists openlibrary_work_id    text;
alter table public.books add column if not exists openlibrary_edition_id text;
alter table public.books add column if not exists google_books_id        text;
alter table public.books add column if not exists owners                 text[];
alter table public.books add column if not exists location               text;
alter table public.books add column if not exists physical_format        text;
alter table public.books add column if not exists notes                  text;
alter table public.books add column if not exists created_at             timestamptz;
alter table public.books add column if not exists updated_at             timestamptz;

-- 2.4 Copia de columnas antiguas (si existen) a las nuevas, sin borrarlas.
do $$
declare
  has_col boolean;
begin
  -- author → authors
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='author') into has_col;
  if has_col then
    execute $q$update public.books set authors = regexp_split_to_array(btrim(author::text), '\s*[,;]\s*')
               where (authors is null or authors = '{}') and author is not null and btrim(author::text) <> ''$q$;
  end if;
  -- owner → owners
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='owner') into has_col;
  if has_col then
    execute $q$update public.books set owners = regexp_split_to_array(btrim(owner::text), '\s*[,;]\s*')
               where (owners is null or owners = '{}') and owner is not null and btrim(owner::text) <> ''$q$;
  end if;
  -- genre → genres
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='genre') into has_col;
  if has_col then
    execute $q$update public.books set genres = regexp_split_to_array(btrim(genre::text), '\s*[,;]\s*')
               where (genres is null or genres = '{}') and genre is not null and btrim(genre::text) <> ''$q$;
  end if;
  -- isbn → isbn13 / isbn10 (solo dígitos y X)
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='isbn') into has_col;
  if has_col then
    execute $q$update public.books set isbn13 = regexp_replace(isbn::text, '[^0-9Xx]', '', 'g')
               where isbn13 is null and length(regexp_replace(isbn::text, '[^0-9Xx]', '', 'g')) = 13$q$;
    execute $q$update public.books set isbn10 = upper(regexp_replace(isbn::text, '[^0-9Xx]', '', 'g'))
               where isbn10 is null and length(regexp_replace(isbn::text, '[^0-9Xx]', '', 'g')) = 10$q$;
  end if;
  -- cover → cover_url
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='cover') into has_col;
  if has_col then
    execute $q$update public.books set cover_url = cover::text where cover_url is null and cover is not null and btrim(cover::text) <> ''$q$;
  end if;
  -- year → published_year
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='year') into has_col;
  if has_col then
    execute $q$update public.books set published_year = substring(year::text from '(\d{4})')::integer
               where published_year is null and year::text ~ '\d{4}'$q$;
  end if;
  -- format → physical_format
  select exists (select 1 from information_schema.columns where table_schema='public' and table_name='books' and column_name='format') into has_col;
  if has_col then
    execute $q$update public.books set physical_format = format::text where physical_format is null and format::text in ('Tapa dura','Tapa blanda','Bolsillo')$q$;
  end if;
end $$;

-- 2.5 Valores por defecto y nulos coherentes.
update public.books set authors    = '{}'  where authors    is null;
update public.books set genres     = '{}'  where genres     is null;
update public.books set owners     = '{}'  where owners     is null;
update public.books set created_at = now() where created_at is null;
update public.books set updated_at = created_at where updated_at is null;

alter table public.books alter column authors    set default '{}';
alter table public.books alter column genres     set default '{}';
alter table public.books alter column owners     set default '{}';
alter table public.books alter column created_at set default now();
alter table public.books alter column updated_at set default now();
alter table public.books alter column authors    set not null;
alter table public.books alter column genres     set not null;
alter table public.books alter column owners     set not null;
alter table public.books alter column created_at set not null;
alter table public.books alter column updated_at set not null;

-- 2.6 Restricciones (NOT VALID: no fallan por datos antiguos, sí controlan los nuevos).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'books_title_not_blank') then
    alter table public.books add constraint books_title_not_blank
      check (title is not null and btrim(title) <> '') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_pages_positive') then
    alter table public.books add constraint books_pages_positive
      check (pages is null or pages > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_year_range') then
    alter table public.books add constraint books_year_range
      check (published_year is null or published_year between 0 and 2100) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_physical_format_values') then
    alter table public.books add constraint books_physical_format_values
      check (physical_format is null or physical_format in ('Tapa dura', 'Tapa blanda', 'Bolsillo')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_isbn13_clean') then
    alter table public.books add constraint books_isbn13_clean
      check (isbn13 is null or isbn13 ~ '^[0-9]{13}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'books_isbn10_clean') then
    alter table public.books add constraint books_isbn10_clean
      check (isbn10 is null or isbn10 ~ '^[0-9]{9}[0-9X]$') not valid;
  end if;
end $$;

-- 2.7 Índices de búsqueda frecuentes.
create index if not exists books_created_at_idx      on public.books (created_at desc);
create index if not exists books_isbn13_idx          on public.books (isbn13);
create index if not exists books_isbn10_idx          on public.books (isbn10);
create index if not exists books_location_idx        on public.books (location);
create index if not exists books_physical_format_idx on public.books (physical_format);
create index if not exists books_authors_gin_idx     on public.books using gin (authors);
create index if not exists books_genres_gin_idx      on public.books using gin (genres);
create index if not exists books_owners_gin_idx      on public.books using gin (owners);
create index if not exists books_cover_path_idx      on public.books (cover_path);

create or replace trigger books_touch
  before insert or update on public.books
  for each row execute function public.biblioteca_touch_row();

-- ---------------------------------------------------------------------
-- 3. Tablas relacionadas. book_id usa el mismo tipo que books.id
--    (uuid en una instalación nueva; se respeta si ya era otro tipo).
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  select format_type(a.atttypid, a.atttypmod) into t
    from pg_attribute a
   where a.attrelid = 'public.books'::regclass and a.attname = 'id' and not a.attisdropped;

  -- 3.1 Destinos de papel (wishlist). No depende de books: es un libro que aún no tenemos.
  execute $sql$
    create table if not exists public.book_wishlist (
      id                      uuid primary key default gen_random_uuid(),
      person                  text not null references public.book_family_members(name) on update cascade,
      title                   text not null check (btrim(title) <> ''),
      subtitle                text,
      authors                 text[] not null default '{}',
      isbn10                  text,
      isbn13                  text,
      publisher               text,
      published_year          integer,
      published_date          text,
      edition                 text,
      pages                   integer,
      genres                  text[] not null default '{}',
      language                text,
      cover_url               text,
      openlibrary_work_id     text,
      openlibrary_edition_id  text,
      google_books_id         text,
      source                  text,
      created_at              timestamptz not null default now(),
      updated_at              timestamptz not null default now()
    )$sql$;

  -- 3.2 Califica tu viaje: una valoración por libro y persona (0 a 5, saltos de 0,5).
  execute format($sql$
    create table if not exists public.book_ratings (
      id          uuid primary key default gen_random_uuid(),
      book_id     %s not null references public.books(id) on delete cascade,
      person      text not null references public.book_family_members(name) on update cascade,
      rating      numeric(2,1) not null,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      constraint book_ratings_book_person_key unique (book_id, person),
      constraint book_ratings_rating_range check (rating >= 0 and rating <= 5 and rating * 2 = trunc(rating * 2))
    )$sql$, t);

  -- 3.3 Ciclos de lectura (reading_journey_id): permiten relecturas sin mezclar progresos.
  execute format($sql$
    create table if not exists public.reading_journeys (
      id           uuid primary key default gen_random_uuid(),
      book_id      %s not null references public.books(id) on delete cascade,
      person       text not null references public.book_family_members(name) on update cascade,
      status       text not null default 'reading' check (status in ('reading', 'finished')),
      started_on   date,
      finished_on  date,
      created_at   timestamptz not null default now(),
      updated_at   timestamptz not null default now()
    )$sql$, t);

  -- 3.4 Sesiones de lectura (Mi ruta de lectura).
  execute format($sql$
    create table if not exists public.reading_sessions (
      id          uuid primary key default gen_random_uuid(),
      journey_id  uuid not null references public.reading_journeys(id) on delete cascade,
      book_id     %s not null references public.books(id) on delete cascade,
      person      text not null references public.book_family_members(name) on update cascade,
      read_on     date not null,
      page        integer not null check (page >= 0),
      finished    boolean not null default false,
      notes       text,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      constraint reading_sessions_no_accidental_duplicate unique (journey_id, read_on, page, finished)
    )$sql$, t);

  -- 3.5 Próximas paradas (pendientes de leer).
  execute format($sql$
    create table if not exists public.reading_pending (
      id          uuid primary key default gen_random_uuid(),
      book_id     %s not null references public.books(id) on delete cascade,
      person      text not null references public.book_family_members(name) on update cascade,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now(),
      constraint reading_pending_book_person_key unique (book_id, person)
    )$sql$, t);
end $$;

-- Columnas que puedan faltar si alguna tabla relacionada se creó antes a mano.
alter table public.book_wishlist    add column if not exists subtitle               text;
alter table public.book_wishlist    add column if not exists isbn10                 text;
alter table public.book_wishlist    add column if not exists isbn13                 text;
alter table public.book_wishlist    add column if not exists publisher              text;
alter table public.book_wishlist    add column if not exists published_year         integer;
alter table public.book_wishlist    add column if not exists published_date         text;
alter table public.book_wishlist    add column if not exists edition                text;
alter table public.book_wishlist    add column if not exists pages                  integer;
alter table public.book_wishlist    add column if not exists genres                 text[] not null default '{}';
alter table public.book_wishlist    add column if not exists language               text;
alter table public.book_wishlist    add column if not exists cover_url              text;
alter table public.book_wishlist    add column if not exists openlibrary_work_id    text;
alter table public.book_wishlist    add column if not exists openlibrary_edition_id text;
alter table public.book_wishlist    add column if not exists google_books_id        text;
alter table public.book_wishlist    add column if not exists source                 text;
alter table public.book_wishlist    add column if not exists created_at             timestamptz not null default now();
alter table public.book_wishlist    add column if not exists updated_at             timestamptz not null default now();
alter table public.book_ratings     add column if not exists created_at             timestamptz not null default now();
alter table public.book_ratings     add column if not exists updated_at             timestamptz not null default now();
alter table public.reading_journeys add column if not exists started_on             date;
alter table public.reading_journeys add column if not exists finished_on            date;
alter table public.reading_journeys add column if not exists created_at             timestamptz not null default now();
alter table public.reading_journeys add column if not exists updated_at             timestamptz not null default now();
alter table public.reading_sessions add column if not exists notes                  text;
alter table public.reading_sessions add column if not exists created_at             timestamptz not null default now();
alter table public.reading_sessions add column if not exists updated_at             timestamptz not null default now();
alter table public.reading_pending  add column if not exists created_at             timestamptz not null default now();
alter table public.reading_pending  add column if not exists updated_at             timestamptz not null default now();

-- Índices por book_id, persona y fechas.
create index if not exists book_wishlist_person_idx       on public.book_wishlist (person, created_at desc);
create index if not exists book_wishlist_isbn13_idx       on public.book_wishlist (isbn13);
create index if not exists book_ratings_book_idx          on public.book_ratings (book_id);
create index if not exists book_ratings_person_idx        on public.book_ratings (person);
create index if not exists reading_journeys_book_idx      on public.reading_journeys (book_id);
create index if not exists reading_journeys_person_idx    on public.reading_journeys (person, finished_on);
create unique index if not exists reading_journeys_one_open_idx
  on public.reading_journeys (book_id, person) where status = 'reading';
create index if not exists reading_sessions_journey_idx   on public.reading_sessions (journey_id);
create index if not exists reading_sessions_book_idx      on public.reading_sessions (book_id);
create index if not exists reading_sessions_person_day_idx on public.reading_sessions (person, read_on);
create index if not exists reading_pending_book_idx       on public.reading_pending (book_id);
create index if not exists reading_pending_person_idx     on public.reading_pending (person, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Coherencia de las sesiones y fechas de inicio / fin
-- ---------------------------------------------------------------------

-- Una sesión debe pertenecer al mismo libro y a la misma persona que su ciclo.
create or replace function public.reading_sessions_check_journey()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  j record;
begin
  select book_id, person into j from public.reading_journeys where id = new.journey_id;
  if not found then
    raise exception 'Sesión de lectura incoherente: el ciclo de lectura no existe' using errcode = '23503';
  end if;
  if j.book_id::text <> new.book_id::text or j.person <> new.person then
    raise exception 'Sesión de lectura incoherente: libro o persona distintos a los del ciclo' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Recalcula inicio (primera sesión), fin (sesión terminada) y estado del ciclo.
-- Si un ciclo se queda sin sesiones, se elimina para no dejar viajes vacíos.
create or replace function public.reading_journey_refresh(p_journey uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_first   date;
  v_finish  date;
  v_count   integer;
begin
  if p_journey is null or not exists (select 1 from public.reading_journeys where id = p_journey) then
    return;
  end if;
  select min(read_on), max(read_on) filter (where finished), count(*)
    into v_first, v_finish, v_count
    from public.reading_sessions where journey_id = p_journey;
  if v_count = 0 then
    delete from public.reading_journeys where id = p_journey;
    return;
  end if;
  update public.reading_journeys
     set started_on  = v_first,
         finished_on = v_finish,
         status      = case when v_finish is null then 'reading' else 'finished' end
   where id = p_journey
     and (started_on is distinct from v_first
          or finished_on is distinct from v_finish
          or status <> case when v_finish is null then 'reading' else 'finished' end);
end;
$$;

create or replace function public.reading_sessions_after_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.reading_journey_refresh(old.journey_id);
  elsif tg_op = 'UPDATE' then
    if old.journey_id is distinct from new.journey_id then
      perform public.reading_journey_refresh(old.journey_id);
    end if;
    perform public.reading_journey_refresh(new.journey_id);
  else
    perform public.reading_journey_refresh(new.journey_id);
  end if;
  return null;
end;
$$;

create or replace trigger book_wishlist_touch    before insert or update on public.book_wishlist    for each row execute function public.biblioteca_touch_row();
create or replace trigger book_ratings_touch     before insert or update on public.book_ratings     for each row execute function public.biblioteca_touch_row();
create or replace trigger reading_journeys_touch before insert or update on public.reading_journeys for each row execute function public.biblioteca_touch_row();
create or replace trigger reading_sessions_touch before insert or update on public.reading_sessions for each row execute function public.biblioteca_touch_row();
create or replace trigger reading_pending_touch  before insert or update on public.reading_pending  for each row execute function public.biblioteca_touch_row();

create or replace trigger reading_sessions_check
  before insert or update on public.reading_sessions
  for each row execute function public.reading_sessions_check_journey();

create or replace trigger reading_sessions_refresh_journey
  after insert or update or delete on public.reading_sessions
  for each row execute function public.reading_sessions_after_change();

-- ---------------------------------------------------------------------
-- 5. Seguridad: RLS + grants para el rol público (anon) de la app familiar
--    Las políticas solo se crean si todavía no existen (no se borran).
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

do $$
declare
  t   text;
  act text;
  pol text;
begin
  foreach t in array array['books', 'book_family_members', 'book_wishlist', 'book_ratings',
                           'reading_journeys', 'reading_sessions', 'reading_pending'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on table public.%I to anon, authenticated', t);
    foreach act in array array['select', 'insert', 'update', 'delete'] loop
      pol := format('hogar_%s_%s', t, act);
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = pol) then
        if act = 'select' or act = 'delete' then
          execute format('create policy %I on public.%I for %s to anon, authenticated using (true)', pol, t, act);
        elsif act = 'insert' then
          execute format('create policy %I on public.%I for insert to anon, authenticated with check (true)', pol, t);
        else
          execute format('create policy %I on public.%I for update to anon, authenticated using (true) with check (true)', pol, t);
        end if;
      end if;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Portadas: bucket público "book-covers" en Supabase Storage
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public)
    values ('book-covers', 'book-covers', true)
    on conflict (id) do nothing;

    if exists (select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='file_size_limit') then
      update storage.buckets
         set file_size_limit = coalesce(file_size_limit, 5242880),
             allowed_mime_types = coalesce(allowed_mime_types, array['image/jpeg', 'image/png', 'image/webp'])
       where id = 'book-covers';
    end if;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hogar_book_covers_select') then
      create policy hogar_book_covers_select on storage.objects for select to anon, authenticated using (bucket_id = 'book-covers');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hogar_book_covers_insert') then
      create policy hogar_book_covers_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'book-covers');
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hogar_book_covers_delete') then
      create policy hogar_book_covers_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'book-covers');
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Sincronización en tiempo real entre móviles (Supabase Realtime)
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['books', 'book_wishlist', 'book_ratings', 'reading_journeys',
                             'reading_sessions', 'reading_pending'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Comentarios descriptivos
-- ---------------------------------------------------------------------
comment on table public.books               is 'Biblioteca familiar: una fila por ejemplar físico. created_at = incorporación (inmutable), updated_at = última edición.';
comment on table public.book_family_members is 'Familiares de Hogar (mismos nombres que la discoteca).';
comment on table public.book_wishlist       is 'Destinos de papel: libros deseados por cada persona.';
comment on table public.book_ratings        is 'Califica tu viaje: una valoración (0-5, saltos de 0,5) por libro y persona.';
comment on table public.reading_journeys    is 'Ciclos de lectura (reading_journey_id). Permiten relecturas. Inicio/fin calculados desde reading_sessions.';
comment on table public.reading_sessions    is 'Mi ruta de lectura: página leída por persona, libro y día.';
comment on table public.reading_pending     is 'Próximas paradas: libros pendientes de leer por persona.';

-- Pide a la API de Supabase que relea el esquema.
notify pgrst, 'reload schema';

commit;
