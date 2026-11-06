-- =====================================================================
-- Nuestra discoteca familiar · Discos de viaje (préstamos y solicitudes) y Álbumes pendientes
-- Proyecto Supabase: ravnuggmkypkrcfgfeip (el mismo de la biblioteca), esquema public.
-- La colección de discos sigue donde está; aquí solo se guarda una copia de los datos
-- necesarios para mostrar cada disco (álbum, artista, formato, portada y dueños).
-- Los nombres de fuera de la familia se comparten con la biblioteca (book_people).
-- Seguro de ejecutar varias veces; no borra ni cambia datos existentes.
-- =====================================================================
create table if not exists public.disc_loans (
  id          uuid primary key default gen_random_uuid(),
  disc_key    text not null check (char_length(disc_key) between 1 and 600),
  album       text not null default '' check (char_length(album) <= 300),
  artist      text not null default '' check (char_length(artist) <= 300),
  category    text check (category is null or char_length(category) <= 40),
  cover       text check (cover is null or char_length(cover) <= 2000),
  owners      text[] not null default '{}',
  borrower    text not null check (char_length(btrim(borrower)) between 1 and 60),
  lent_on     date not null default current_date,
  created_at  timestamptz not null default now()
);
create unique index if not exists disc_loans_key_uniq on public.disc_loans (disc_key);

create table if not exists public.disc_loan_requests (
  id          uuid primary key default gen_random_uuid(),
  disc_key    text not null check (char_length(disc_key) between 1 and 600),
  album       text not null default '' check (char_length(album) <= 300),
  artist      text not null default '' check (char_length(artist) <= 300),
  category    text check (category is null or char_length(category) <= 40),
  cover       text check (cover is null or char_length(cover) <= 2000),
  owners      text[] not null default '{}',
  requester   text not null check (char_length(btrim(requester)) between 1 and 60),
  owner       text not null check (char_length(btrim(owner)) between 1 and 60),
  created_at  timestamptz not null default now()
);
create unique index if not exists disc_loan_requests_uniq on public.disc_loan_requests (disc_key, requester);

create table if not exists public.disc_pending (
  id          uuid primary key default gen_random_uuid(),
  person      text not null check (char_length(btrim(person)) between 1 and 60),
  disc_key    text not null check (char_length(disc_key) between 1 and 600),
  in_home     boolean not null default true,
  album       text not null default '' check (char_length(album) <= 300),
  artist      text not null default '' check (char_length(artist) <= 300),
  category    text check (category is null or char_length(category) <= 40),
  cover       text check (cover is null or char_length(cover) <= 2000),
  owners      text[] not null default '{}',
  added_by    text not null check (char_length(btrim(added_by)) between 1 and 60),
  created_at  timestamptz not null default now()
);
create unique index if not exists disc_pending_uniq on public.disc_pending (person, disc_key);
create index if not exists disc_pending_person_idx on public.disc_pending (person, created_at);

-- Nombres guardados (si aún no se ejecutó el SQL de la biblioteca v13)
create table if not exists public.book_people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  name_key    text not null check (char_length(name_key) between 1 and 60),
  created_at  timestamptz not null default now()
);
create unique index if not exists book_people_name_key_uniq on public.book_people (name_key);

do $$
declare t text;
begin
  foreach t in array array['disc_loans', 'disc_loan_requests', 'disc_pending', 'book_people'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_familia') then
      execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', t || '_familia', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to anon, authenticated', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
