-- M1: privileged write path for appointments. Every one of these is
-- SECURITY DEFINER and REVOKE'd from PUBLIC/anon/authenticated, granted to
-- service_role only — called exclusively from trusted Next.js server
-- routes/actions (see src/lib/supabase/service-role.ts). Because they run
-- as service_role (which itself bypasses RLS) there is no auth.uid(); an
-- explicit actor parameter is passed in by the server after it has already
-- authenticated the caller through the normal session flow.

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

  update public.appointments
  set status = 'cancelled', cancelled_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'cancel_appointment', 'appointments', p_appointment_id, '{}'::jsonb);

  return v_appointment;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_starts_at timestamptz,
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

  select duration_minutes into v_duration_minutes
  from public.appointment_types where id = v_appointment.appointment_type_id;

  v_new_ends_at := p_new_starts_at + make_interval(mins => v_duration_minutes);

  begin
    update public.appointments
    set starts_at = p_new_starts_at, ends_at = v_new_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'reschedule_appointment', 'appointments', p_appointment_id, jsonb_build_object('new_starts_at', p_new_starts_at));

  return v_appointment;
end;
$$;

create or replace function public.create_management_token(
  p_appointment_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns public.appointment_management_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.appointment_management_tokens;
begin
  if not exists (select 1 from public.appointments where id = p_appointment_id) then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  insert into public.appointment_management_tokens (appointment_id, token_hash, expires_at)
  values (p_appointment_id, p_token_hash, p_expires_at)
  returning * into v_token;

  return v_token;
end;
$$;

create or replace function public.redeem_management_token(
  p_token_hash text
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

  insert into public.appointment_management_sessions (token_id, appointment_id, expires_at)
  values (v_token.id, v_token.appointment_id, now() + interval '30 minutes')
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.cancel_appointment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_management_token(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.redeem_management_token(text) from public, anon, authenticated;

grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz, text, text, text, uuid, text, timestamptz) to service_role;
grant execute on function public.cancel_appointment(uuid, uuid, uuid) to service_role;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, uuid) to service_role;
grant execute on function public.create_management_token(uuid, text, timestamptz) to service_role;
grant execute on function public.redeem_management_token(text) to service_role;
