-- =====================================================================
-- Nuestra biblioteca familiar · versión 13
-- Proyecto Supabase: ravnuggmkypkrcfgfeip (el de la biblioteca), esquema public.
--   · book_loans            → «Libros de viaje» (préstamos)
--   · book_recommendations  → recomendaciones de «Aventuras pendientes»
--   · book_people           → nombres de fuera de la familia que se guardan para la próxima vez
-- Es seguro ejecutarlo varias veces: no borra ni cambia datos que ya existan.
-- Mismo modelo de acceso que el resto de tablas de la biblioteca (la app escribe con la
-- publishable key); no se usa ninguna clave secreta.
-- =====================================================================

do $$
declare
  id_type text;
begin
  -- book_id usa el mismo tipo que books.id (uuid o bigint, según cómo se creó la biblioteca).
  select format_type(a.atttypid, a.atttypmod) into id_type
    from pg_attribute a
   where a.attrelid = 'public.books'::regclass and a.attname = 'id' and not a.attisdropped;
  if id_type is null then raise exception 'No existe public.books.id: ejecuta primero la instalación de la biblioteca.'; end if;

  execute format($f$
    create table if not exists public.book_loans (
      id          uuid primary key default gen_random_uuid(),
      book_id     %s not null references public.books(id) on delete cascade,
      lender      text check (lender is null or char_length(lender) <= 200),
      borrower    text not null check (char_length(btrim(borrower)) between 1 and 60),
      lent_on     date not null default current_date,
      created_at  timestamptz not null default now()
    )$f$, id_type);

  execute format($f$
    create table if not exists public.book_recommendations (
      id              uuid primary key default gen_random_uuid(),
      book_id         %s not null references public.books(id) on delete cascade,
      person          text not null check (char_length(btrim(person)) between 1 and 60),
      recommended_by  text not null check (char_length(btrim(recommended_by)) between 1 and 60),
      note            text check (note is null or char_length(note) <= 500),
      created_at      timestamptz not null default now()
    )$f$, id_type);
end $$;

create table if not exists public.book_people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  name_key    text not null check (char_length(name_key) between 1 and 60),
  created_at  timestamptz not null default now()
);

-- Un libro solo puede estar prestado una vez a la vez; una recomendación por libro y persona.
create unique index if not exists book_loans_book_uniq on public.book_loans (book_id);
create unique index if not exists book_recommendations_book_person_uniq on public.book_recommendations (book_id, person);
create unique index if not exists book_people_name_key_uniq on public.book_people (name_key);
create index if not exists book_recommendations_person_idx on public.book_recommendations (person, created_at);

-- RLS: la familia lee y escribe desde la app (igual que reading_pending y book_wishlist).
alter table public.book_loans enable row level security;
alter table public.book_recommendations enable row level security;
alter table public.book_people enable row level security;

do $$
declare t text;
begin
  foreach t in array array['book_loans', 'book_recommendations', 'book_people'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_familia') then
      execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_familia', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on public.book_loans, public.book_recommendations, public.book_people to anon, authenticated;

-- Tiempo real: los demás dispositivos ven los cambios al momento.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['book_loans', 'book_recommendations', 'book_people'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Para que DELETE en tiempo real lleve el id.
alter table public.book_loans replica identity full;
alter table public.book_recommendations replica identity full;
alter table public.book_people replica identity full;
