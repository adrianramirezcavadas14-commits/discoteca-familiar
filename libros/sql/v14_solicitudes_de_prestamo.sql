-- =====================================================================
-- Nuestra biblioteca familiar · versión 14 · Solicitudes de préstamo
-- Proyecto Supabase: ravnuggmkypkrcfgfeip, esquema public.
-- Necesita antes v13_prestamos_y_recomendaciones.sql. Seguro de ejecutar varias veces.
-- =====================================================================
do $$
declare id_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into id_type
    from pg_attribute a where a.attrelid = 'public.books'::regclass and a.attname = 'id' and not a.attisdropped;
  execute format($f$
    create table if not exists public.book_loan_requests (
      id          uuid primary key default gen_random_uuid(),
      book_id     %s not null references public.books(id) on delete cascade,
      requester   text not null check (char_length(btrim(requester)) between 1 and 60),
      owner       text not null check (char_length(btrim(owner)) between 1 and 60),
      created_at  timestamptz not null default now()
    )$f$, id_type);
end $$;
create unique index if not exists book_loan_requests_uniq on public.book_loan_requests (book_id, requester);
alter table public.book_loan_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'book_loan_requests' and policyname = 'book_loan_requests_familia') then
    create policy book_loan_requests_familia on public.book_loan_requests for all to anon, authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on public.book_loan_requests to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'book_loan_requests') then
    alter publication supabase_realtime add table public.book_loan_requests;
  end if;
end $$;
alter table public.book_loan_requests replica identity full;
