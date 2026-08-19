-- Public lifecycle invariant:
-- a doctor can only be published while active and not deleted.
alter table public.doctors
  add constraint doctors_published_requires_active
  check (
    not is_published
    or (
      suspended_at is null
      and deleted_at is null
    )
  );

-- Harden the privileged booking function.
--
-- Public bookings (no secretary actor) require a genuinely public doctor:
-- published + not suspended + not deleted.
--
-- A future authenticated secretary booking may still work while the doctor
-- is unpublished, but never while suspended/deleted.
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
  if p_created_by_secretary_id is null then
    if not exists (
      select 1
      from public.doctors d
      where d.id = p_doctor_id
        and d.is_published = true
        and d.suspended_at is null
        and d.deleted_at is null
    ) then
      raise exception 'doctor is not accepting bookings'
        using errcode = '42501';
    end if;
  else
    if not exists (
      select 1
      from public.doctors d
      where d.id = p_doctor_id
        and d.suspended_at is null
        and d.deleted_at is null
    ) then
      raise exception 'doctor is not accepting bookings'
        using errcode = '42501';
    end if;
  end if;

  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id
    and at.doctor_id = p_doctor_id;

  if v_duration_minutes is null then
    raise exception 'invalid appointment type for doctor'
      using errcode = '22023';
  end if;

  if p_created_by_secretary_id is not null and not exists (
    select 1
    from public.doctor_secretaries ds
    where ds.doctor_id = p_doctor_id
      and ds.secretary_user_id = p_created_by_secretary_id
  ) then
    raise exception 'actor is not a secretary for this doctor'
      using errcode = '42501';
  end if;

  v_ends_at :=
    p_starts_at + make_interval(mins => v_duration_minutes);

  if not private.is_within_working_window(
    p_doctor_id,
    p_clinic_id,
    p_starts_at,
    v_ends_at,
    now()
  ) then
    raise exception
      'requested time is outside working hours, too soon, or blocked'
      using errcode = '55001';
  end if;

  begin
    insert into public.appointments (
      doctor_id,
      clinic_id,
      appointment_type_id,
      created_by_secretary_id,
      patient_name,
      patient_phone,
      patient_email,
      starts_at,
      ends_at,
      status
    )
    values (
      p_doctor_id,
      p_clinic_id,
      p_appointment_type_id,
      p_created_by_secretary_id,
      p_patient_name,
      p_patient_phone,
      p_patient_email,
      p_starts_at,
      v_ends_at,
      'confirmed'
    )
    returning * into v_appointment;
  exception
    when exclusion_violation then
      raise exception 'slot unavailable'
        using errcode = '23P01';
  end;

  if p_management_token_hash is not null then
    insert into public.appointment_management_tokens (
      appointment_id,
      token_hash,
      expires_at
    )
    values (
      v_appointment.id,
      p_management_token_hash,
      p_management_token_expires_at
    );
  end if;

  insert into public.audit_log (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    details
  )
  values (
    p_created_by_secretary_id,
    'book_appointment',
    'appointments',
    v_appointment.id,
    jsonb_build_object('doctor_id', p_doctor_id)
  );

  if p_patient_email is not null then
    insert into public.email_outbox (
      to_email,
      locale,
      template,
      payload
    )
    select
      p_patient_email,
      d.default_locale,
      'appointment_confirmation',
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
    join public.clinics c
      on c.id = v_appointment.clinic_id
    join public.appointment_types at
      on at.id = v_appointment.appointment_type_id
    where d.id = p_doctor_id;
  end if;

  return v_appointment;
end;
$$;

revoke all on function public.book_appointment(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.book_appointment(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text,
  text,
  text,
  uuid,
  text,
  timestamptz
) to service_role;
