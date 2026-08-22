-- Staff-operated schedule controls: manual appointment creation and
-- explicit cascade delays for overrunning consultations.
--
-- Both mutations remain service-role-only. The actor user id is resolved
-- by the authenticated dashboard Server Action and re-authorized against
-- the doctor inside each SECURITY DEFINER function.

create or replace function private.is_within_staff_working_window(
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

  if v_timezone is null or p_starts_at >= p_ends_at then
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
    select 1
    from public.breaks b
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
    select 1
    from public.blocked_periods bp
    where bp.doctor_id = p_doctor_id
      and (bp.clinic_id is null or bp.clinic_id = p_clinic_id)
      and tstzrange(bp.starts_at, bp.ends_at) && tstzrange(p_starts_at, p_ends_at)
  ) then
    return false;
  end if;

  return true;
end;
$$;

revoke all on function private.is_within_staff_working_window(uuid, uuid, timestamptz, timestamptz) from public;

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
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.suspended_at is null
      and d.deleted_at is null
  ) then
    raise exception 'doctor is not accepting appointments' using errcode = '42501';
  end if;

  if nullif(btrim(p_patient_name), '') is null or nullif(btrim(p_patient_phone), '') is null then
    raise exception 'patient name and phone are required' using errcode = '22023';
  end if;

  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id
    and at.doctor_id = p_doctor_id;

  if v_duration_minutes is null then
    raise exception 'invalid appointment type for doctor' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.clinics c
    where c.id = p_clinic_id
      and c.doctor_id = p_doctor_id
  ) then
    raise exception 'invalid clinic for doctor' using errcode = '22023';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_duration_minutes);
  if v_ends_at <= now() then
    raise exception 'appointment has already ended' using errcode = '55001';
  end if;

  if not private.is_within_staff_working_window(
    p_doctor_id,
    p_clinic_id,
    p_starts_at,
    v_ends_at
  ) then
    raise exception 'requested time is outside working hours or blocked' using errcode = '55001';
  end if;

  select case when exists (
    select 1
    from public.doctor_secretaries ds
    where ds.doctor_id = p_doctor_id
      and ds.secretary_user_id = p_actor_user_id
  ) then p_actor_user_id else null end
  into v_secretary_id;

  v_email := nullif(btrim(coalesce(p_patient_email, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');

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
      status,
      notes
    ) values (
      p_doctor_id,
      p_clinic_id,
      p_appointment_type_id,
      v_secretary_id,
      btrim(p_patient_name),
      btrim(p_patient_phone),
      v_email,
      p_starts_at,
      v_ends_at,
      'confirmed',
      v_notes
    )
    returning * into v_appointment;
  exception when exclusion_violation then
    raise exception 'slot unavailable' using errcode = '23P01';
  end;

  insert into public.audit_log (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    details
  ) values (
    p_actor_user_id,
    'create_staff_appointment',
    'appointments',
    v_appointment.id,
    jsonb_build_object(
      'doctor_id', p_doctor_id,
      'clinic_id', p_clinic_id,
      'appointment_type_id', p_appointment_type_id,
      'source', 'manual'
    )
  );

  if v_email is not null then
    insert into public.email_outbox (
      to_email,
      locale,
      template,
      payload
    )
    select
      v_email,
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
    join public.clinics c on c.id = v_appointment.clinic_id
    join public.appointment_types at on at.id = v_appointment.appointment_type_id
    where d.id = v_appointment.doctor_id;
  end if;

  return v_appointment;
end;
$$;

revoke all on function public.create_staff_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_staff_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text, uuid) to service_role;

create or replace function public.preview_staff_appointment_delay(
  p_appointment_id uuid,
  p_delay_minutes integer,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor public.appointments;
  v_timezone text;
  v_local_date date;
  v_day_end timestamptz;
  v_new_anchor_end timestamptz;
  v_cursor timestamptz;
  v_next public.appointments;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_affected jsonb := '[]'::jsonb;
begin
  if p_delay_minutes < 1 or p_delay_minutes > 240 then
    raise exception 'delay must be between 1 and 240 minutes' using errcode = '22023';
  end if;

  select * into v_anchor
  from public.appointments
  where id = p_appointment_id;

  if v_anchor.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if not private.is_staff_for_doctor(p_actor_user_id, v_anchor.doctor_id) then
    raise exception 'actor is not authorized for this appointment' using errcode = '42501';
  end if;

  if v_anchor.status <> 'confirmed' then
    raise exception 'appointment is not in a delayable state' using errcode = '55000';
  end if;

  select d.timezone into v_timezone
  from public.doctors d
  where d.id = v_anchor.doctor_id;

  if v_timezone is null then
    raise exception 'doctor timezone is not configured' using errcode = '55001';
  end if;

  v_new_anchor_end := v_anchor.ends_at + make_interval(mins => p_delay_minutes);
  if not private.is_within_staff_working_window(
    v_anchor.doctor_id,
    v_anchor.clinic_id,
    v_anchor.starts_at,
    v_new_anchor_end
  ) then
    raise exception 'delay would move the appointment outside the working schedule' using errcode = '55001';
  end if;

  v_local_date := (v_anchor.starts_at at time zone v_timezone)::date;
  v_day_end := ((v_local_date + 1)::timestamp at time zone v_timezone);
  v_cursor := v_new_anchor_end;

  for v_next in
    select a.*
    from public.appointments a
    where a.doctor_id = v_anchor.doctor_id
      and a.id <> v_anchor.id
      and a.status = 'confirmed'
      and a.starts_at >= v_anchor.ends_at
      and a.starts_at < v_day_end
    order by a.starts_at asc
  loop
    if v_next.starts_at < v_cursor then
      v_new_start := v_cursor;
      v_new_end := v_new_start + (v_next.ends_at - v_next.starts_at);

      if not private.is_within_staff_working_window(
        v_next.doctor_id,
        v_next.clinic_id,
        v_new_start,
        v_new_end
      ) then
        raise exception 'delay would push a later appointment outside the working schedule' using errcode = '55001';
      end if;

      v_affected := v_affected || jsonb_build_array(jsonb_build_object(
        'appointment_id', v_next.id,
        'patient_name', v_next.patient_name,
        'patient_phone', v_next.patient_phone,
        'patient_email', v_next.patient_email,
        'old_starts_at', v_next.starts_at,
        'old_ends_at', v_next.ends_at,
        'new_starts_at', v_new_start,
        'new_ends_at', v_new_end,
        'needs_contact', v_next.patient_email is null
      ));
      v_cursor := v_new_end;
    else
      -- The free gap has absorbed the accumulated delay. From here the
      -- schedule continues from this appointment's existing end time.
      v_cursor := v_next.ends_at;
    end if;
  end loop;

  return jsonb_build_object(
    'appointment_id', v_anchor.id,
    'delay_minutes', p_delay_minutes,
    'old_ends_at', v_anchor.ends_at,
    'new_ends_at', v_new_anchor_end,
    'affected_count', jsonb_array_length(v_affected),
    'affected', v_affected
  );
end;
$$;

revoke all on function public.preview_staff_appointment_delay(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.preview_staff_appointment_delay(uuid, integer, uuid) to service_role;

create or replace function public.apply_staff_appointment_delay(
  p_appointment_id uuid,
  p_delay_minutes integer,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anchor public.appointments;
  v_plan jsonb;
  v_item jsonb;
  v_count integer;
  v_index integer;
  v_shifted public.appointments;
begin
  select * into v_anchor
  from public.appointments
  where id = p_appointment_id
  for update;

  if v_anchor.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  if not private.is_staff_for_doctor(p_actor_user_id, v_anchor.doctor_id) then
    raise exception 'actor is not authorized for this appointment' using errcode = '42501';
  end if;

  if v_anchor.status <> 'confirmed' then
    raise exception 'appointment is not in a delayable state' using errcode = '55000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_anchor.doctor_id::text, 0)
  );

  v_plan := public.preview_staff_appointment_delay(
    p_appointment_id,
    p_delay_minutes,
    p_actor_user_id
  );
  v_count := coalesce(jsonb_array_length(v_plan -> 'affected'), 0);

  -- The exclusion constraint is immediate, so move later appointments
  -- from last to first to avoid transient overlap inside this transaction.
  v_index := v_count - 1;
  while v_index >= 0 loop
    v_item := (v_plan -> 'affected') -> v_index;

    begin
      update public.appointments
      set
        starts_at = (v_item ->> 'new_starts_at')::timestamptz,
        ends_at = (v_item ->> 'new_ends_at')::timestamptz
      where id = (v_item ->> 'appointment_id')::uuid
        and status = 'confirmed'
      returning * into v_shifted;
    exception when exclusion_violation then
      raise exception 'slot unavailable while applying delay' using errcode = '23P01';
    end;

    if v_shifted.id is null then
      raise exception 'schedule changed while applying delay' using errcode = '55001';
    end if;

    v_index := v_index - 1;
  end loop;

  begin
    update public.appointments
    set ends_at = (v_plan ->> 'new_ends_at')::timestamptz
    where id = p_appointment_id
      and status = 'confirmed'
    returning * into v_anchor;
  exception when exclusion_violation then
    raise exception 'slot unavailable while extending appointment' using errcode = '23P01';
  end;

  if v_anchor.id is null then
    raise exception 'schedule changed while applying delay' using errcode = '55001';
  end if;

  insert into public.audit_log (
    actor_user_id,
    action,
    entity_table,
    entity_id,
    details
  ) values (
    p_actor_user_id,
    'extend_appointment_delay',
    'appointments',
    p_appointment_id,
    jsonb_build_object(
      'delay_minutes', p_delay_minutes,
      'old_ends_at', v_plan ->> 'old_ends_at',
      'new_ends_at', v_plan ->> 'new_ends_at',
      'affected_count', v_count
    )
  );

  v_index := 0;
  while v_index < v_count loop
    v_item := (v_plan -> 'affected') -> v_index;

    insert into public.audit_log (
      actor_user_id,
      action,
      entity_table,
      entity_id,
      details
    ) values (
      p_actor_user_id,
      'cascade_reschedule_appointment',
      'appointments',
      (v_item ->> 'appointment_id')::uuid,
      jsonb_build_object(
        'caused_by_appointment_id', p_appointment_id,
        'delay_minutes', p_delay_minutes,
        'old_starts_at', v_item ->> 'old_starts_at',
        'new_starts_at', v_item ->> 'new_starts_at'
      )
    );

    if nullif(v_item ->> 'patient_email', '') is not null then
      insert into public.email_outbox (
        to_email,
        locale,
        template,
        payload
      )
      select
        a.patient_email,
        d.default_locale,
        'appointment_reschedule_staff',
        jsonb_build_object(
          'appointment_id', a.id,
          'doctor_name', d.full_name,
          'clinic_name', c.name,
          'clinic_address', c.address,
          'clinic_timezone', c.timezone,
          'appointment_type_name', at.name,
          'patient_name', a.patient_name,
          'starts_at', a.starts_at,
          'ends_at', a.ends_at
        )
      from public.appointments a
      join public.doctors d on d.id = a.doctor_id
      join public.clinics c on c.id = a.clinic_id
      join public.appointment_types at on at.id = a.appointment_type_id
      where a.id = (v_item ->> 'appointment_id')::uuid;
    end if;

    v_index := v_index + 1;
  end loop;

  return v_plan;
end;
$$;

revoke all on function public.apply_staff_appointment_delay(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.apply_staff_appointment_delay(uuid, integer, uuid) to service_role;
