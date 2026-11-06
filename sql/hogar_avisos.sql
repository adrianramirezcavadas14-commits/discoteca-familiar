-- =====================================================================
-- HOGAR · AVISOS (notificaciones push) y usuario de Hogar
-- Proyecto Supabase: ravnuggmkypkrcfgfeip (biblioteca, despensa y extras de la discoteca).
-- Necesita antes: biblioteca v13 y v14, discos_prestamos_y_pendientes.sql y buzon_sugerencias.sql.
-- Es seguro ejecutarlo varias veces: no borra datos.
--
-- Cómo funciona:
--   · Cada dispositivo con usuario (Papá, Mamá, María o Adrián) guarda su suscripción en
--     hogar_push_subs (Invitado no recibe nada).
--   · Unos disparadores apuntan cada aviso en hogar_push_outbox y llaman a la función
--     «hogar-push» (con pg_net), que los cifra y los envía. Si la llamada falla, un trabajo de
--     pg_cron lo reintenta cada 15 minutos; y cada día revisa los préstamos de más de 30 días.
--   · Las claves VAPID las genera la propia función la primera vez y se guardan aquí, en una tabla
--     que la app no puede leer. La clave que firma las llamadas de la base de datos a la función se
--     genera al ejecutar este SQL.
-- =====================================================================

-- Extensiones de Supabase (si no se pueden activar aquí, actívalas en Database → Extensions).
do $$ begin
  begin create extension if not exists pg_net with schema extensions; exception when others then raise notice 'pg_net no disponible: %', sqlerrm; end;
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron no disponible: %', sqlerrm; end;
end $$;

-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------
create table if not exists public.hogar_push_subs (
  endpoint     text primary key check (char_length(endpoint) between 20 and 2000 and endpoint like 'https://%'),
  person       text not null check (person in ('Papá', 'Mamá', 'María', 'Adrián')),
  p256dh       text not null check (char_length(p256dh) between 40 and 200),
  auth         text not null check (char_length(auth) between 10 and 100),
  user_agent   text check (user_agent is null or char_length(user_agent) <= 400),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  last_ok_at   timestamptz,
  fail_count   int not null default 0
);
create index if not exists hogar_push_subs_person_idx on public.hogar_push_subs (person);

create table if not exists public.hogar_push_outbox (
  id          bigint generated always as identity primary key,
  person      text not null,
  endpoint    text,                       -- solo para el aviso de prueba de un dispositivo
  title       text not null,
  body        text not null default '',
  url         text not null default 'index.html',
  tag         text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0,
  last_error  text
);
create index if not exists hogar_push_outbox_pending_idx on public.hogar_push_outbox (id) where sent_at is null;

-- hogar_private ya existe (buzón); por si acaso:
create table if not exists public.hogar_private (key text primary key, value text not null);

alter table public.hogar_push_subs enable row level security;
alter table public.hogar_push_outbox enable row level security;
alter table public.hogar_private enable row level security;
revoke all on public.hogar_push_subs, public.hogar_push_outbox, public.hogar_private from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on public.hogar_push_subs, public.hogar_push_outbox, public.hogar_private to service_role;
  end if;
end $$;

-- Clave para las llamadas de la base de datos a la función y dirección de la función.
insert into public.hogar_private (key, value)
  values ('push_secret', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
insert into public.hogar_private (key, value)
  values ('push_url', 'https://ravnuggmkypkrcfgfeip.supabase.co/functions/v1/hogar-push')
  on conflict (key) do nothing;

-- Quién hace cada cosa en el buzón (para no avisar a quien la escribe o la acepta)
alter table public.hogar_suggestions add column if not exists created_by text check (created_by is null or char_length(created_by) <= 30);
alter table public.hogar_suggestions add column if not exists resolved_by text check (resolved_by is null or char_length(resolved_by) <= 30);

-- Recordatorios de préstamos cada 30 días
alter table public.book_loans add column if not exists last_reminder_at timestamptz;
alter table public.disc_loans add column if not exists last_reminder_at timestamptz;

-- ---------------------------------------------------------------------
-- Envío (interno)
-- ---------------------------------------------------------------------
create or replace function public.hogar_family() returns text[] language sql immutable set search_path = '' as $$
  select array['Papá', 'Mamá', 'María', 'Adrián']::text[]
$$;

/** Llama a la función hogar-push (una vez por transacción). Nunca hace fallar lo que la dispara. */
create or replace function public.hogar_push_kick() returns void language plpgsql security definer set search_path = '' as $$
declare
  u text;
  s text;
begin
  if coalesce(current_setting('hogar.push_kicked', true), '') = '1' then return; end if;
  perform set_config('hogar.push_kicked', '1', true);
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') then return; end if;
  select value into u from public.hogar_private where key = 'push_url';
  select value into s from public.hogar_private where key = 'push_secret';
  if u is null or s is null then return; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 15000)'
      using u, jsonb_build_object('action', 'send'), jsonb_build_object('Content-Type', 'application/json', 'x-hogar-secret', s);
  exception when others then
    raise warning 'Hogar: no se pudo avisar a la función de avisos: %', sqlerrm;
  end;
end $$;

/** Apunta un aviso para una persona de la familia (Invitado y nombres de fuera, nada). */
create or replace function public.hogar_push_queue(p_person text, p_title text, p_body text, p_url text, p_tag text default null, p_endpoint text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_person is null or not (p_person = any (public.hogar_family())) then return; end if;
  insert into public.hogar_push_outbox (person, endpoint, title, body, url, tag)
  values (p_person, p_endpoint, left(coalesce(p_title, 'Hogar'), 120), left(coalesce(p_body, ''), 300), left(coalesce(p_url, 'index.html'), 300), left(p_tag, 80));
  perform public.hogar_push_kick();
end $$;

create or replace function public.hogar_push_kick_pending() returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.hogar_push_outbox where sent_at is null and attempts < 5) then perform public.hogar_push_kick(); end if;
end $$;

-- ---------------------------------------------------------------------
-- Desde la app (anon): registrar el dispositivo, quitarlo, clave pública y aviso de prueba
-- ---------------------------------------------------------------------
create or replace function public.hogar_push_register(p_person text, p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 2000 then
    return jsonb_build_object('ok', false, 'message', 'Suscripción no válida.');
  end if;
  if p_person is null or not (p_person = any (public.hogar_family())) then
    delete from public.hogar_push_subs where endpoint = p_endpoint;      -- Invitado: este dispositivo no recibe avisos
    return jsonb_build_object('ok', true, 'registered', false);
  end if;
  insert into public.hogar_push_subs (endpoint, person, p256dh, auth, user_agent)
  values (p_endpoint, p_person, p_p256dh, p_auth, left(p_ua, 400))
  on conflict (endpoint) do update set person = excluded.person, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, updated_at = now(), fail_count = 0;
  return jsonb_build_object('ok', true, 'registered', true);
end $$;

create or replace function public.hogar_push_unregister(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from public.hogar_push_subs where endpoint = p_endpoint;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.hogar_push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select value from public.hogar_private where key = 'vapid_public'
$$;

create or replace function public.hogar_push_test(p_endpoint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text;
begin
  select person into who from public.hogar_push_subs where endpoint = p_endpoint;
  if who is null then return jsonb_build_object('ok', false, 'message', 'Este dispositivo no está registrado para recibir avisos.'); end if;
  if (select count(*) from public.hogar_push_outbox where endpoint = p_endpoint and created_at > now() - interval '10 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'message', 'Ya se han enviado varias pruebas. Espera unos minutos.');
  end if;
  perform public.hogar_push_queue(who, '🔔 Aviso de prueba', 'Si ves esto, los avisos de Hogar funcionan en este dispositivo.', 'index.html', 'prueba', p_endpoint);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Para la función hogar-push (solo service_role)
-- ---------------------------------------------------------------------
create or replace function public.hogar_push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'secret', (select value from public.hogar_private where key = 'push_secret'),
    'vapid_public', (select value from public.hogar_private where key = 'vapid_public'),
    'vapid_private', (select value from public.hogar_private where key = 'vapid_private'))
$$;

create or replace function public.hogar_push_set_vapid(p_public text, p_private text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  insert into public.hogar_private (key, value) values ('vapid_public', p_public) on conflict (key) do nothing;
  insert into public.hogar_private (key, value) values ('vapid_private', p_private) on conflict (key) do nothing;
  return public.hogar_push_config();
end $$;

/** Reserva hasta p_limit avisos pendientes con los dispositivos de cada persona. */
create or replace function public.hogar_push_claim(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with picked as (
    select o.id from public.hogar_push_outbox o
     where o.sent_at is null and o.attempts < 5
     order by o.id limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  ), bumped as (
    update public.hogar_push_outbox o set attempts = o.attempts + 1 from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'title', b.title, 'body', b.body, 'url', b.url, 'tag', b.tag,
      'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                          from public.hogar_push_subs s
                         where s.person = b.person and (b.endpoint is null or s.endpoint = b.endpoint)), '[]'::jsonb)
    ) order by b.id), '[]'::jsonb)
    into out from bumped b;
  return out;
end $$;

/** Resultado del envío: p_results = [{id, ok, error}], p_gone = dispositivos que ya no existen, p_ok = los que han recibido. */
create or replace function public.hogar_push_done(p_results jsonb, p_gone text[] default '{}', p_ok text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.hogar_push_outbox o
     set sent_at = case when coalesce((r->>'ok')::boolean, false) then now() else o.sent_at end,
         last_error = case when coalesce((r->>'ok')::boolean, false) then null else left(r->>'error', 300) end
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where o.id = (r->>'id')::bigint;
  delete from public.hogar_push_subs where endpoint = any (coalesce(p_gone, '{}'));
  update public.hogar_push_subs set last_ok_at = now(), fail_count = 0 where endpoint = any (coalesce(p_ok, '{}'));
  delete from public.hogar_push_outbox where sent_at < now() - interval '30 days' or (sent_at is null and created_at < now() - interval '7 days');
end $$;

revoke all on function public.hogar_family() from public;
revoke all on function public.hogar_push_kick() from public, anon, authenticated;
revoke all on function public.hogar_push_queue(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.hogar_push_kick_pending() from public, anon, authenticated;
revoke all on function public.hogar_push_config() from public, anon, authenticated;
revoke all on function public.hogar_push_set_vapid(text, text) from public, anon, authenticated;
revoke all on function public.hogar_push_claim(int) from public, anon, authenticated;
revoke all on function public.hogar_push_done(jsonb, text[], text[]) from public, anon, authenticated;
revoke all on function public.hogar_push_register(text, text, text, text, text) from public;
revoke all on function public.hogar_push_unregister(text) from public;
revoke all on function public.hogar_push_public_key() from public;
revoke all on function public.hogar_push_test(text) from public;
grant execute on function public.hogar_push_register(text, text, text, text, text), public.hogar_push_unregister(text),
  public.hogar_push_public_key(), public.hogar_push_test(text) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.hogar_push_config(), public.hogar_push_set_vapid(text, text), public.hogar_push_claim(int),
      public.hogar_push_done(jsonb, text[], text[]) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Qué avisa y a quién (disparadores). Un fallo aquí nunca impide guardar.
-- ---------------------------------------------------------------------
create or replace function public.hogar_av_book_request() returns trigger language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  begin
    select title into t from public.books where id = new.book_id;
    perform public.hogar_push_queue(new.owner, '🙋 Te piden un libro', format('%s te pide «%s»', new.requester, coalesce(t, 'un libro')), 'libros/#loans', 'pedir-libro');
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

create or replace function public.hogar_av_disc_request() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.hogar_push_queue(new.owner, '🙋 Te piden un disco', format('%s te pide «%s»%s', new.requester, new.album, case when coalesce(new.artist, '') <> '' then ' de ' || new.artist else '' end), 'index.html?abrir=discLoans', 'pedir-disco');
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

create or replace function public.hogar_av_book_rec() returns trigger language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  begin
    if new.recommended_by is distinct from new.person then
      select title into t from public.books where id = new.book_id;
      perform public.hogar_push_queue(new.person, format('💌 %s te recomienda un libro', new.recommended_by), format('«%s»', coalesce(t, 'Un libro')), 'libros/#pending', 'recomendacion');
    end if;
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

create or replace function public.hogar_av_disc_rec() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.added_by is distinct from new.person then
      perform public.hogar_push_queue(new.person, format('💌 %s te recomienda un álbum', new.added_by), format('«%s»%s', new.album, case when coalesce(new.artist, '') <> '' then ' · ' || new.artist else '' end), 'index.html?abrir=discPending', 'recomendacion');
    end if;
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

create or replace function public.hogar_av_suggestion_new() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.created_by is distinct from 'Adrián' then
      perform public.hogar_push_queue('Adrián', '📮 Nueva sugerencia en el buzón', left(new.body, 160) || case when new.created_by is not null and new.created_by <> '' then ' — ' || new.created_by else '' end, 'index.html?abrir=buzon', 'buzon');
    end if;
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

create or replace function public.hogar_av_suggestion_done() returns trigger language plpgsql security definer set search_path = '' as $$
declare p text;
begin
  begin
    if old.status = 'pending' and new.status = 'accepted' then
      foreach p in array public.hogar_family() loop
        if p is distinct from new.resolved_by then
          perform public.hogar_push_queue(p, '🎉 Novedad en Hogar', left(new.body, 160), 'index.html', 'novedad');
        end if;
      end loop;
    end if;
  exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
  return new;
end $$;

drop trigger if exists hogar_av on public.book_loan_requests;
create trigger hogar_av after insert on public.book_loan_requests for each row execute function public.hogar_av_book_request();
drop trigger if exists hogar_av on public.disc_loan_requests;
create trigger hogar_av after insert on public.disc_loan_requests for each row execute function public.hogar_av_disc_request();
drop trigger if exists hogar_av on public.book_recommendations;
create trigger hogar_av after insert on public.book_recommendations for each row execute function public.hogar_av_book_rec();
drop trigger if exists hogar_av on public.disc_pending;
create trigger hogar_av after insert on public.disc_pending for each row execute function public.hogar_av_disc_rec();
drop trigger if exists hogar_av_new on public.hogar_suggestions;
create trigger hogar_av_new after insert on public.hogar_suggestions for each row execute function public.hogar_av_suggestion_new();
drop trigger if exists hogar_av_done on public.hogar_suggestions;
create trigger hogar_av_done after update of status on public.hogar_suggestions for each row execute function public.hogar_av_suggestion_done();

-- Despensa: solo a Adrián, cuando otra persona marca un producto para revisar.
do $$ begin
  if to_regclass('compra.product_review_flags') is not null then
    execute $f$
      create or replace function public.hogar_av_compra_flag() returns trigger language plpgsql security definer set search_path = '' as $b$
      declare who text; code text; prod text;
      begin
        begin
          select fp.display_name, fp.code into who, code from compra.family_profiles fp where fp.id = new.flagged_by;
          if code is distinct from 'adrian' then
            select name into prod from compra.products where id = new.product_id;
            perform public.hogar_push_queue('Adrián', '🚩 Producto para revisar', format('%s ha marcado «%s»', coalesce(who, 'Alguien'), coalesce(prod, 'un producto')), 'compra/#lista', 'revisar');
          end if;
        exception when others then raise warning 'Hogar avisos: %', sqlerrm; end;
        return new;
      end $b$ $f$;
    execute 'drop trigger if exists hogar_av on compra.product_review_flags';
    execute 'create trigger hogar_av after insert on compra.product_review_flags for each row execute function public.hogar_av_compra_flag()';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Recordatorios: cada 30 días que un libro o disco siga prestado
-- ---------------------------------------------------------------------
create or replace function public.hogar_push_reminders() returns int language plpgsql security definer set search_path = '' as $$
declare
  r record;
  owners text[];
  o text;
  days int;
  n int := 0;
begin
  for r in select l.id, l.lender, l.borrower, l.lent_on, b.title from public.book_loans l join public.books b on b.id = l.book_id
            where coalesce(l.last_reminder_at, l.lent_on::timestamptz) <= now() - interval '30 days' for update of l skip locked loop
    days := current_date - r.lent_on;
    owners := coalesce(string_to_array(r.lender, ' y '), '{}');
    foreach o in array owners loop
      perform public.hogar_push_queue(btrim(o), format('⏰ Libro prestado hace %s días', days), format('«%s» sigue con %s.', r.title, r.borrower), 'libros/#loans', 'recordatorio');
    end loop;
    if not (r.borrower = any (owners)) then
      perform public.hogar_push_queue(r.borrower, format('⏰ Tienes un libro desde hace %s días', days), format('«%s» es de %s.', r.title, coalesce(nullif(r.lender, ''), 'casa')), 'libros/#loans', 'recordatorio');
    end if;
    update public.book_loans set last_reminder_at = now() where id = r.id;
    n := n + 1;
  end loop;
  for r in select l.id, l.owners, l.borrower, l.lent_on, l.album from public.disc_loans l
            where coalesce(l.last_reminder_at, l.lent_on::timestamptz) <= now() - interval '30 days' for update skip locked loop
    days := current_date - r.lent_on;
    foreach o in array coalesce(r.owners, '{}') loop
      perform public.hogar_push_queue(o, format('⏰ Disco prestado hace %s días', days), format('«%s» sigue con %s.', r.album, r.borrower), 'index.html?abrir=discLoans', 'recordatorio');
    end loop;
    if not (r.borrower = any (coalesce(r.owners, '{}'))) then
      perform public.hogar_push_queue(r.borrower, format('⏰ Tienes un disco desde hace %s días', days), format('«%s» es de %s.', r.album, coalesce(nullif(array_to_string(r.owners, ' y '), ''), 'casa')), 'index.html?abrir=discLoans', 'recordatorio');
    end if;
    update public.disc_loans set last_reminder_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.hogar_push_reminders() from public, anon, authenticated;

-- Trabajos programados (hora UTC): recordatorios cada día a las 9:00 y reintentos cada 15 minutos.
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'cron' and p.proname = 'schedule') then
    perform cron.schedule('hogar-recordatorios', '0 9 * * *', 'select public.hogar_push_reminders()');
    perform cron.schedule('hogar-avisos-reintento', '*/15 * * * *', 'select public.hogar_push_kick_pending()');
  else
    raise notice 'pg_cron no está activo: actívalo en Database → Extensions y vuelve a ejecutar este archivo para los recordatorios.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Buzón: quién escribe y quién acepta (para no avisarse a uno mismo)
-- ---------------------------------------------------------------------
drop function if exists public.hogar_suggestion_add(text);
drop function if exists public.hogar_suggestion_resolve(uuid, text, text);

create or replace function public.hogar_suggestion_add(p_body text, p_user text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  txt text := btrim(coalesce(p_body, ''));
  r public.hogar_suggestions;
begin
  if char_length(txt) < 3 then return public.hogar_buzon_error('sugerencia_corta'); end if;
  if char_length(txt) > 2000 then return public.hogar_buzon_error('sugerencia_larga'); end if;
  if (select count(*) from public.hogar_suggestions where created_at > now() - interval '1 hour') >= 40 then
    return public.hogar_buzon_error('demasiadas_sugerencias');
  end if;
  insert into public.hogar_suggestions (body, created_by) values (txt, left(nullif(btrim(p_user), ''), 30)) returning * into r;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $$;

create or replace function public.hogar_suggestion_resolve(p_id uuid, p_status text, p_pin text, p_user text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hogar_suggestions;
  err text;
begin
  if p_status not in ('accepted', 'rejected') then return public.hogar_buzon_error('estado_no_valido'); end if;
  err := public.hogar_check_pin(p_pin);
  if err is not null then return public.hogar_buzon_error(err); end if;
  update public.hogar_suggestions set status = p_status, resolved_at = now(), resolved_by = left(nullif(btrim(p_user), ''), 30)
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then return public.hogar_buzon_error('ya_resuelta'); end if;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $$;

revoke all on function public.hogar_suggestion_add(text, text) from public;
revoke all on function public.hogar_suggestion_resolve(uuid, text, text, text) from public;
grant execute on function public.hogar_suggestion_add(text, text) to anon, authenticated;
grant execute on function public.hogar_suggestion_resolve(uuid, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
