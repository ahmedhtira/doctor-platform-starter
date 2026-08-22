-- Targeted correctness follow-up for patient self-service and staff-created
-- appointments. This migration deliberately does not change public search,
-- doctor lifecycle, booking notice rules, or unrelated dashboard behavior.

-- Keep appointment origin explicit. Existing/public bookings are online by
-- default; any historical staff-created rows are recovered from the audit log.
alter table public.appointments
  add column source text not null default 'online';

alter table public.appointments
  add constraint appointments_source_check check (source in ('online', 'manual'));

update public.appointments a
set source = 'manual'
where exists (
  select 1
  from public.audit_log l
  where l.entity_table = 'appointments'
    and l.entity_id = a.id
    and l.action = 'create_staff_appointment'
);

-- Patients may still open their management page after the appointment has
-- started, but they may no longer mutate the appointment. Staff actions keep
-- their existing override behavior.
create or replace function public.cancel_appointment(
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
    v_authorized := private.is_staff_for_doctor(p_actor_user_id, v_appointment.doctor_id);
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

  if p_actor_user_id is null and v_appointment.starts_at <= now() then
    raise exception 'patient changes are closed after the appointment starts' using errcode = '55003';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now()
  where id = p_appointment_id
  returning * into v_appointment;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'cancel_appointment', 'appointments', p_appointment_id, '{}'::jsonb);

  if v_appointment.patient_email is not null then
    insert into public.email_outbox (to_email, locale, template, payload)
    select
      v_appointment.patient_email,
      d.default_locale,
      'appointment_cancellation',
      jsonb_build_object(
        'appointment_id', v_appointment.id,
        'doctor_name', d.full_name,
        'clinic_name', c.name,
        'clinic_address', c.address,
        'clinic_timezone', c.timezone,
        'appointment_type_name', at.name,
        'patient_name', v_appointment.patient_name,
        'starts_at', v_appointment.starts_at,
        'ends_at', v_appointment.ends_at
      )
    from public.doctors d
    join public.clinics c on c.id = v_appointment.clinic_id
    join public.appointment_types at on at.id = v_appointment.appointment_type_id
    where d.id = v_appointment.doctor_id;
  end if;

  return v_appointment;
end;
$$;

create or replace function public.reschedule_appointment(
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
  v_template text;
begin
  select * into v_appointment from public.appointments where id = p_appointment_id;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if p_actor_user_id is not null then
    v_authorized := private.is_staff_for_doctor(p_actor_user_id, v_appointment.doctor_id);
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

  if p_actor_user_id is null and v_appointment.starts_at <= now() then
    raise exception 'patient changes are closed after the appointment starts' using errcode = '55003';
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

  if v_appointment.patient_email is not null then
    v_template := case when p_actor_user_id is not null
      then 'appointment_reschedule_staff'
      else 'appointment_reschedule_patient'
    end;

    insert into public.email_outbox (to_email, locale, template, payload)
    select
      v_appointment.patient_email,
      d.default_locale,
      v_template,
      jsonb_build_object(
        'appointment_id', v_appointment.id,
        'doctor_name', d.full_name,
        'clinic_name', c.name,
        'clinic_address', c.address,
        'clinic_timezone', c.timezone,
        'appointment_type_name', at.name,
        'patient_name', v_appointment.patient_name,
        'starts_at', v_appointment.starts_at,
        'ends_at', v_appointment.ends_at
      )
    from public.doctors d
    join public.clinics c on c.id = v_appointment.clinic_id
    join public.appointment_types at on at.id = v_appointment.appointment_type_id
    where d.id = v_appointment.doctor_id;
  end if;

  return v_appointment;
end;
$$;

revoke all on function public.cancel_appointment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reschedule_appointment(uuid, timestamptz, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_appointment(uuid, uuid, text) to service_role;
grant execute on function public.reschedule_appointment(uuid, timestamptz, uuid, text, text, timestamptz) to service_role;

-- Recreate staff appointment creation only to persist the already-audited
-- manual source directly on the appointment row.
create or replace function public.create_staff_appointment(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_appointment_type_id uuid,
  p_starts_at timestamptz,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_notes text,
  p_actor_user_id uuid
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
  v_secretary_id uuid;
  v_email text;
  v_notes text;
begin
  if not private.is_staff_for_doctor(p_actor_user_id, p_doctor_id) then
    raise exception 'actor is not authorized for this doctor' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.doctors d
    where d.id = p_doctor_id and d.suspended_at is null and d.deleted_at is null
  ) then
    raise exception 'doctor is not accepting appointments' using errcode = '42501';
  end if;

  if nullif(btrim(p_patient_name), '') is null or nullif(btrim(p_patient_phone), '') is null then
    raise exception 'patient name and phone are required' using errcode = '22023';
  end if;

  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id and at.doctor_id = p_doctor_id;

  if v_duration_minutes is null then
    raise exception 'invalid appointment type for doctor' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.clinics c
    where c.id = p_clinic_id and c.doctor_id = p_doctor_id
  ) then
    raise exception 'invalid clinic for doctor' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);
  if v_ends_at <= now() then
    raise exception 'appointment has already ended' using errcode = '55001';
  end if;

  if not private.is_within_staff_working_window(p_doctor_id, p_clinic_id, p_starts_at, v_ends_at) then
    raise exception 'requested time is outside working hours or blocked' using errcode = '55001';
  end if;

  select case when exists (
    select 1 from public.doctor_secretaries ds
    where ds.doctor_id = p_doctor_id and ds.secretary_user_id = p_actor_user_id
  ) then p_actor_user_id else null end
  into v_secretary_id;

  v_email := nullif(btrim(coalesce(p_patient_email, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  begin
    insert into public.appointments (
      doctor_id, clinic_id, appointment_type_id, created_by_secretary_id,
      patient_name, patient_phone, patient_email, starts_at, ends_at,
      status, notes, source
    ) values (
      p_doctor_id, p_clinic_id, p_appointment_type_id, v_secretary_id,
      btrim(p_patient_name), btrim(p_patient_phone), v_email, p_starts_at,
      v_ends_at, 'confirmed', v_notes, 'manual'
    ) returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (
    p_actor_user_id, 'create_staff_appointment', 'appointments', v_appointment.id,
    jsonb_build_object('doctor_id', p_doctor_id, 'clinic_id', p_clinic_id,
      'appointment_type_id', p_appointment_type_id, 'source', 'manual')
  );

  if v_email is not null then
    insert into public.email_outbox (to_email, locale, template, payload)
    select
      v_email, d.default_locale, 'appointment_confirmation',
      jsonb_build_object(
        'appointment_id', v_appointment.id,
        'doctor_name', d.full_name,
        'clinic_name', c.name,
        'clinic_address', c.address,
        'clinic_timezone', c.timezone,
        'appointment_type_name', at.name,
        'patient_name', v_appointment.patient_name,
        'starts_at', v_appointment.starts_at,
        'ends_at', v_appointment.ends_at
      )
    from public.doctors d
    join public.clinics c on c.id = v_appointment.clinic_id
    join public.appointment_types at on at.id = v_appointment.appointment_type_id
    where d.id = v_appointment.doctor_id;
  end if;

  return v_appointment;
end;
$$;

revoke all on function public.create_staff_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_staff_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) to service_role;

-- Manual appointment details can be corrected by authorized staff without
-- opening direct UPDATE grants on appointments. Time/clinic changes continue
-- to use the existing reschedule flow; appointment-type changes are allowed
-- only when the new duration still fits the schedule and does not overlap.
create function public.update_staff_appointment_details(
  p_appointment_id uuid,
  p_appointment_type_id uuid,
  p_patient_name text,
  p_patient_phone text,
  p_patient_email text,
  p_notes text,
  p_actor_user_id uuid
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
  v_email text;
  v_notes text;
begin
  select * into v_appointment
  from public.appointments
  where id = p_appointment_id
  for update;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if not private.is_staff_for_doctor(p_actor_user_id, v_appointment.doctor_id) then
    raise exception 'actor is not authorized for this appointment' using errcode = '42501';
  end if;

  if v_appointment.source <> 'manual' or v_appointment.status <> 'confirmed' then
    raise exception 'appointment details are not editable' using errcode = '55000';
  end if;

  if v_appointment.starts_at <= now() then
    raise exception 'appointment has already started' using errcode = '55003';
  end if;

  if nullif(btrim(p_patient_name), '') is null or nullif(btrim(p_patient_phone), '') is null then
    raise exception 'patient name and phone are required' using errcode = '22023';
  end if;

  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id
    and at.doctor_id = v_appointment.doctor_id;

  if v_duration_minutes is null then
    raise exception 'invalid appointment type for doctor' using errcode = '22023';
  end if;

  v_new_ends_at := v_appointment.starts_at + make_interval(mins => v_duration_minutes);

  if not private.is_within_staff_working_window(
    v_appointment.doctor_id,
    v_appointment.clinic_id,
    v_appointment.starts_at,
    v_new_ends_at
  ) then
    raise exception 'updated duration would fall outside working hours or a blocked period' using errcode = '55001';
  end if;

  v_email := nullif(btrim(coalesce(p_patient_email, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

  begin
    update public.appointments
    set appointment_type_id = p_appointment_type_id,
        patient_name = btrim(p_patient_name),
        patient_phone = btrim(p_patient_phone),
        patient_email = v_email,
        notes = v_notes,
        ends_at = v_new_ends_at
    where id = p_appointment_id
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'updated duration overlaps another appointment' using errcode = '23P01';
  end;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (
    p_actor_user_id,
    'update_staff_appointment_details',
    'appointments',
    p_appointment_id,
    jsonb_build_object('appointment_type_id', p_appointment_type_id, 'source', 'manual')
  );

  return v_appointment;
end;
$$;

revoke all on function public.update_staff_appointment_details(uuid, uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.update_staff_appointment_details(uuid, uuid, text, text, text, text, uuid) to service_role;
