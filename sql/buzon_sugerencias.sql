-- =====================================================================
-- HOGAR · BUZÓN DE SUGERENCIAS (menú inicial)
-- Proyecto Supabase: ravnuggmkypkrcfgfeip (el de la biblioteca y la despensa), esquema public.
-- Es seguro ejecutarlo varias veces: no borra sugerencias ni cambia la contraseña ya guardada.
--
-- Seguridad:
--   · La tabla solo se puede LEER desde la app. Escribir, aceptar, rechazar y eliminar se hace
--     con funciones del servidor (no hay permisos de escritura directa).
--   · La contraseña para aceptar, rechazar o borrar resueltas se comprueba en el servidor.
--     Aquí solo se guarda su huella SHA-256 con sal (la contraseña no aparece en este archivo
--     ni en la app). Tras 8 intentos fallidos en 10 minutos se bloquea un rato.
--   · Si ya existían versiones anteriores de estas funciones con otro tipo de respuesta, se
--     sustituyen (drop + create) sin tocar las sugerencias guardadas.
-- Sin extensiones: solo funciones de PostgreSQL de serie (sha256, gen_random_uuid).
-- =====================================================================

create table if not exists public.hogar_suggestions (
  id           uuid primary key default gen_random_uuid(),
  body         text not null check (char_length(btrim(body)) between 3 and 2000),
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index if not exists hogar_suggestions_status_idx on public.hogar_suggestions (status, created_at desc);

-- Datos privados del buzón (huella de la contraseña) e intentos fallidos: nadie los lee desde la app.
create table if not exists public.hogar_private (
  key    text primary key,
  value  text not null
);
create table if not exists public.hogar_pin_failures (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now()
);

insert into public.hogar_private (key, value) values
  ('buzon_pin_salt', '543f073fef0e45ebf05f162a82444cb6'),
  ('buzon_pin_sha256', '1188dd25ef879c485dd3a8af97e15959a4f5c2adabf331016d414244e41c76a3')
on conflict (key) do nothing;

alter table public.hogar_suggestions enable row level security;
alter table public.hogar_private enable row level security;
alter table public.hogar_pin_failures enable row level security;

revoke all on public.hogar_suggestions, public.hogar_private, public.hogar_pin_failures from anon, authenticated;
grant select on public.hogar_suggestions to anon, authenticated;

drop policy if exists hogar_suggestions_leer on public.hogar_suggestions;
create policy hogar_suggestions_leer on public.hogar_suggestions for select to anon, authenticated using (true);
-- hogar_private y hogar_pin_failures: RLS activo y sin políticas → inaccesibles desde la app.

drop function if exists public.hogar_suggestion_add(text);
drop function if exists public.hogar_suggestion_resolve(uuid, text, text);
drop function if exists public.hogar_suggestion_delete(uuid, text);
drop function if exists public.hogar_check_pin(text);

-- ---------------------------------------------------------------------
-- Comprobación de la contraseña (interna: no se puede llamar desde la app).
-- Devuelve null si es correcta o el código del error. No lanza excepción para que
-- el intento fallido quede guardado (una excepción desharía también ese registro).
-- ---------------------------------------------------------------------
create or replace function public.hogar_check_pin(p_pin text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  salt text;
  hash text;
begin
  delete from public.hogar_pin_failures where at < now() - interval '1 day';
  if (select count(*) from public.hogar_pin_failures where at > now() - interval '10 minutes') >= 8 then
    return 'demasiados_intentos';
  end if;
  select value into salt from public.hogar_private where key = 'buzon_pin_salt';
  select value into hash from public.hogar_private where key = 'buzon_pin_sha256';
  if salt is null or hash is null
     or encode(sha256(convert_to(salt || coalesce(p_pin, ''), 'UTF8')), 'hex') <> hash then
    insert into public.hogar_pin_failures default values;
    return 'contrasena_incorrecta';
  end if;
  return null;
end $$;
revoke all on function public.hogar_check_pin(text) from public, anon, authenticated;

-- Respuesta común: { ok, code, message, row }
create or replace function public.hogar_buzon_error(p_code text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', case p_code
    when 'contrasena_incorrecta' then 'La contraseña no es correcta.'
    when 'demasiados_intentos' then 'Demasiados intentos fallidos. Espera unos minutos y vuelve a probar.'
    when 'sugerencia_corta' then 'Escribe un poco más (al menos 3 letras).'
    when 'sugerencia_larga' then 'La sugerencia no puede pasar de 2000 caracteres.'
    when 'demasiadas_sugerencias' then 'Se han enviado muchas sugerencias seguidas. Prueba dentro de un rato.'
    when 'ya_resuelta' then 'Esa sugerencia ya no está pendiente (quizá la ha resuelto otra persona).'
    when 'no_existe' then 'Esa sugerencia ya no existe (quizá la ha borrado otra persona).'
    else 'No se ha podido completar.' end)
$$;
revoke all on function public.hogar_buzon_error(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Enviar una sugerencia (queda pendiente)
-- ---------------------------------------------------------------------
create or replace function public.hogar_suggestion_add(p_body text)
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
  insert into public.hogar_suggestions (body) values (txt) returning * into r;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $$;

-- ---------------------------------------------------------------------
-- Aceptar (ya está en el programa) o rechazar: con contraseña
-- ---------------------------------------------------------------------
create or replace function public.hogar_suggestion_resolve(p_id uuid, p_status text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hogar_suggestions;
  err text;
begin
  if p_status not in ('accepted', 'rejected') then return public.hogar_buzon_error('estado_no_valido'); end if;
  err := public.hogar_check_pin(p_pin);
  if err is not null then return public.hogar_buzon_error(err); end if;
  update public.hogar_suggestions set status = p_status, resolved_at = now()
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then return public.hogar_buzon_error('ya_resuelta'); end if;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $$;

-- ---------------------------------------------------------------------
-- Eliminar: las pendientes sin contraseña; las resueltas, con contraseña
-- ---------------------------------------------------------------------
create or replace function public.hogar_suggestion_delete(p_id uuid, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  st text;
  err text;
begin
  select status into st from public.hogar_suggestions where id = p_id for update;
  if st is null then return public.hogar_buzon_error('no_existe'); end if;
  if st <> 'pending' then
    err := public.hogar_check_pin(p_pin);
    if err is not null then return public.hogar_buzon_error(err); end if;
  end if;
  delete from public.hogar_suggestions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.hogar_suggestion_add(text) from public;
revoke all on function public.hogar_suggestion_resolve(uuid, text, text) from public;
revoke all on function public.hogar_suggestion_delete(uuid, text) from public;
grant execute on function public.hogar_suggestion_add(text) to anon, authenticated;
grant execute on function public.hogar_suggestion_resolve(uuid, text, text) to anon, authenticated;
grant execute on function public.hogar_suggestion_delete(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
