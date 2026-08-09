-- M5: appointment_management_sessions.id was, by construction, the only
-- thing a patient-facing caller would ever hand to cancel_appointment/
-- reschedule_appointment as p_management_session_id — meaning the row's
-- own primary key doubled as the bearer credential for the browser's
-- management session. That conflates "how we identify this row" with
-- "the secret that authorizes access to it": if that id is ever
-- incidentally logged, surfaced in an error message, or exposed via some
-- future unrelated endpoint, it would double as a live credential. No
-- application code has consumed this session path before M5, so this is
-- a same-milestone correction, not a redesign of already-shipped
-- behavior.
--
-- Fix, mirroring how appointment_management_tokens already works: an
-- independent, high-entropy secret is generated in trusted Next.js server
-- code and only its SHA-256 hash ever reaches Postgres. The DB row's `id`
-- remains an internal identifier only and is never again treated as a
-- credential.

alter table public.appointment_management_sessions
  add column session_secret_hash text not null;

alter table public.appointment_management_sessions
  add constraint appointment_management_sessions_session_secret_hash_key unique (session_secret_hash);

-- Signature is changing (new required param) — CREATE OR REPLACE would
-- otherwise create a second overload alongside the old 1-arg version
-- instead of replacing it.
drop function if exists public.redeem_management_token(text);

create function public.redeem_management_token(
  p_token_hash text,
  p_session_secret_hash text
)
returns public.appointment_management_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.appointment_management_tokens;
  v_session public.appointment_management_sessions;
begin
  select * into v_token
  from public.appointment_management_tokens
  where token_hash = p_token_hash and expires_at > now() and used_at is null;

  if v_token.id is null then
    raise exception 'invalid or expired token' using errcode = '42501';
  end if;

  update public.appointment_management_tokens
  set used_at = now()
  where id = v_token.id;

  insert into public.appointment_management_sessions (token_id, appointment_id, expires_at, session_secret_hash)
  values (v_token.id, v_token.appointment_id, now() + interval '30 minutes', p_session_secret_hash)
  returning * into v_session;

  return v_session;
end;
$$;

-- Signature is changing (p_management_session_id uuid -> a text hash
-- param) — CREATE OR REPLACE cannot change a parameter's type in place.
drop function if exists public.cancel_appointment(uuid, uuid, uuid);

create function public.cancel_appointment(
  p_appointment_id uuid,
  p_actor_user_id uuid default null,
  p_management_session_secret_hash text default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_authorized boolean := false;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null then
    v_authorized := exists (
      select 1 from public.doctors d where d.id = v_appointment.doctor_id and d.user_id = p_actor_user_id
    ) or exists (
      select 1 from public.doctor_secretaries ds
      where ds.doctor_id = v_appointment.doctor_id and ds.secretary_user_id = p_actor_user_id
    );
  elsif p_management_session_secret_hash is not null then
    v_authorized := exists (
      select 1 from public.appointment_management_sessions s
      where s.session_secret_hash = p_management_session_secret_hash
        and s.appointment_id = p_appointment_id
        and s.expires_at > now()
    );
  end if;

  if not v_authorized then
    raise exception 'actor is not authorized to cancel this appointment' using errcode = '42501';
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'appointment is not in a cancellable state' using errcode = '55000';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'cancel_appointment', 'appointments', p_appointment_id, '{}'::jsonb);

  return v_appointment;
end;
$$;

-- Same reason: p_management_session_id uuid -> a text hash param.
drop function if exists public.reschedule_appointment(uuid, timestamptz, uuid, uuid, text, timestamptz);

create function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_actor_user_id uuid default null,
  p_management_session_secret_hash text default null,
  p_new_management_token_hash text default null,
  p_new_management_token_expires_at timestamptz default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_duration_minutes integer;
  v_new_ends_at timestamptz;
  v_authorized boolean := false;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null then
    v_authorized := exists (
      select 1 from public.doctors d where d.id = v_appointment.doctor_id and d.user_id = p_actor_user_id
    ) or exists (
      select 1 from public.doctor_secretaries ds
      where ds.doctor_id = v_appointment.doctor_id and ds.secretary_user_id = p_actor_user_id
    );
  elsif p_management_session_secret_hash is not null then
    v_authorized := exists (
      select 1 from public.appointment_management_sessions s
      where s.session_secret_hash = p_management_session_secret_hash
        and s.appointment_id = p_appointment_id
        and s.expires_at > now()
    );
  end if;

  if not v_authorized then
    raise exception 'actor is not authorized to reschedule this appointment' using errcode = '42501';
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'appointment is not in a reschedulable state' using errcode = '55000';
  end if;

  select duration_minutes into v_duration_minutes
  from public.appointment_types where id = v_appointment.appointment_type_id;

  v_new_ends_at := p_new_starts_at + make_interval(mins => v_duration_minutes);

  if not private.is_within_working_window(v_appointment.doctor_id, v_appointment.clinic_id, p_new_starts_at, v_new_ends_at, now()) then
    raise exception 'requested time is outside working hours, too soon, or blocked' using errcode = '55001';
  end if;

  begin
    update public.appointments
    set starts_at = p_new_starts_at, ends_at = v_new_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  update public.appointment_management_tokens
  set used_at = now()
  where appointment_id = p_appointment_id
    and used_at is null
    and expires_at > now();

  if p_new_management_token_hash is not null then
    insert into public.appointment_management_tokens (appointment_id, token_hash, expires_at)
    values (p_appointment_id, p_new_management_token_hash, p_new_management_token_expires_at);
  end if;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'reschedule_appointment', 'appointments', p_appointment_id, jsonb_build_object('new_starts_at', p_new_starts_at));

  return v_appointment;
end;
$$;

revoke all on function public.redeem_management_token(text, text) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.redeem_management_token(text, text) to service_role;
grant execute on function public.cancel_appointment(uuid, uuid, text) to service_role;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, text, text, timestamptz) to service_role;
