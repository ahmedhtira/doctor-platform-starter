-- M1 hardening pass, prompted by adding direct tests for
-- reschedule_appointment and management tokens:
--
-- 1. book_appointment and reschedule_appointment never actually validated
--    against working_hours/schedule_exceptions/blocked_periods — only the
--    exclusion constraint protected against overlap. PROJECT_SPEC.md
--    already documented book_appointment as doing this; it didn't. Fixed
--    via a new shared helper, private.is_within_working_window.
-- 2. cancel_appointment/reschedule_appointment could be called repeatedly
--    on an already-cancelled/completed/no_show appointment. Now guarded.
-- 3. reschedule_appointment now invalidates the appointment's outstanding
--    management token(s) (a changed appointment shouldn't stay reachable
--    via an old emailed link) and can optionally issue a replacement in
--    the same transaction.

create or replace function private.is_within_working_window(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_local_date date;
  v_day_of_week integer;
  v_exception record;
  v_window_start time;
  v_window_end time;
  v_range_start timestamptz;
  v_range_end timestamptz;
begin
  select c.timezone into v_timezone
  from public.clinics c
  where c.id = p_clinic_id and c.doctor_id = p_doctor_id;

  if v_timezone is null then
    return false;
  end if;

  v_local_date := (p_starts_at at time zone v_timezone)::date;
  v_day_of_week := extract(dow from v_local_date);

  select se.* into v_exception
  from public.schedule_exceptions se
  where se.doctor_id = p_doctor_id
    and se.clinic_id = p_clinic_id
    and se.date = v_local_date;

  if found and v_exception.is_closed then
    return false;
  elsif found then
    v_window_start := v_exception.start_time;
    v_window_end := v_exception.end_time;
  else
    select wh.start_time, wh.end_time into v_window_start, v_window_end
    from public.working_hours wh
    where wh.doctor_id = p_doctor_id
      and wh.clinic_id = p_clinic_id
      and wh.day_of_week = v_day_of_week;

    if v_window_start is null then
      return false;
    end if;
  end if;

  v_range_start := (v_local_date + v_window_start) at time zone v_timezone;
  v_range_end := (v_local_date + v_window_end) at time zone v_timezone;

  if p_starts_at < v_range_start or p_ends_at > v_range_end then
    return false;
  end if;

  if exists (
    select 1 from public.breaks b
    where b.doctor_id = p_doctor_id
      and b.clinic_id = p_clinic_id
      and b.day_of_week = v_day_of_week
      and tstzrange(
            (v_local_date + b.start_time) at time zone v_timezone,
            (v_local_date + b.end_time) at time zone v_timezone
          ) && tstzrange(p_starts_at, p_ends_at)
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.blocked_periods bp
    where bp.doctor_id = p_doctor_id
      and (bp.clinic_id is null or bp.clinic_id = p_clinic_id)
      and tstzrange(bp.starts_at, bp.ends_at) && tstzrange(p_starts_at, p_ends_at)
  ) then
    return false;
  end if;

  return true;
end;
$$;

-- Internal-only: called from book_appointment/reschedule_appointment,
-- which already run as the definer, so no client-facing role needs to
-- invoke it directly — locked down entirely, same as the RLS helpers.
revoke all on function private.is_within_working_window(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.book_appointment(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_created_by_secretary_id uuid default null,
  p_management_token_hash text default null,
  p_management_token_expires_at timestamptz default null
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration_minutes integer;
  v_ends_at timestamptz;
  v_appointment public.appointments;
begin
  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id and at.doctor_id = p_doctor_id;

  if v_duration_minutes is null then
    raise exception 'invalid appointment type for doctor' using errcode = '22023';
  end if;

  if p_created_by_secretary_id is not null and not exists (
    select 1 from public.doctor_secretaries ds
    where ds.doctor_id = p_doctor_id and ds.secretary_user_id = p_created_by_secretary_id
  ) then
    raise exception 'actor is not a secretary for this doctor' using errcode = '42501';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);

  if not private.is_within_working_window(p_doctor_id, p_clinic_id, p_starts_at, v_ends_at) then
    raise exception 'requested time is outside working hours or blocked' using errcode = '55001';
  end if;

  begin
    insert into public.appointments (
      doctor_id, clinic_id, appointment_type_id, created_by_secretary_id,
      patient_name, patient_phone, patient_email, starts_at, ends_at, status
    ) values (
      p_doctor_id, p_clinic_id, p_appointment_type_id, p_created_by_secretary_id,
      p_patient_name, p_patient_phone, p_patient_email, p_starts_at, v_ends_at, 'confirmed'
    )
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  if p_management_token_hash is not null then
    insert into public.appointment_management_tokens (appointment_id, token_hash, expires_at)
    values (v_appointment.id, p_management_token_hash, p_management_token_expires_at);
  end if;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_created_by_secretary_id, 'book_appointment', 'appointments', v_appointment.id, jsonb_build_object('doctor_id', p_doctor_id));

  if p_patient_email is not null then
    insert into public.email_outbox (to_email, locale, template, payload)
    select p_patient_email, d.default_locale, 'appointment_confirmation', jsonb_build_object('appointment_id', v_appointment.id)
    from public.doctors d where d.id = p_doctor_id;
  end if;

  return v_appointment;
end;
$$;

create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_actor_user_id uuid default null,
  p_management_session_id uuid default null
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
  elsif p_management_session_id is not null then
    v_authorized := exists (
      select 1 from public.appointment_management_sessions s
      where s.id = p_management_session_id
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

-- Signature is changing (two new trailing params) — CREATE OR REPLACE
-- would otherwise create a second overload alongside the old 4-arg
-- version instead of replacing it, since Postgres identifies functions by
-- name + parameter types.
drop function if exists public.reschedule_appointment(uuid, timestamptz, uuid, uuid);

create function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
  p_actor_user_id uuid default null,
  p_management_session_id uuid default null,
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
  elsif p_management_session_id is not null then
    v_authorized := exists (
      select 1 from public.appointment_management_sessions s
      where s.id = p_management_session_id
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

  if not private.is_within_working_window(v_appointment.doctor_id, v_appointment.clinic_id, p_new_starts_at, v_new_ends_at) then
    raise exception 'requested time is outside working hours or blocked' using errcode = '55001';
  end if;

  begin
    update public.appointments
    set starts_at = p_new_starts_at, ends_at = v_new_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  -- Invalidate outstanding tokens for this appointment — an old emailed
  -- link shouldn't keep working once the appointment details have
  -- changed. A replacement can be issued in the same call.
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

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid, text, timestamptz) from public, anon, authenticated;

grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, timestamptz) to service_role;
grant execute on function public.cancel_appointment(uuid, uuid, uuid) to service_role;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid, text, timestamptz) to service_role;
