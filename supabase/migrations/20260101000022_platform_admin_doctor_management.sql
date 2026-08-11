-- M10: doctor provisioning by the platform admin, comprehensive
-- suspend, and admin-confirmed delete (delete itself needs no schema
-- here beyond the deleted_at column -- it's an app-layer saga, see
-- src/lib/admin/delete-doctor.ts). No new privileged SQL function for
-- provisioning itself -- creating a doctor is low-frequency, human-
-- supervised, single-trusted-actor, unlike book_appointment's high-
-- frequency/adversarial-input/concurrency-race context. Plain
-- service-role table writes from a requirePlatformAdmin()-gated Server
-- Action are sufficient; atomicity is a TypeScript-level compensating
-- rollback rather than a wrapping SQL function. See PROJECT_SPEC.md's
-- M10 section.

alter table public.doctors
  add column suspended_at timestamptz,
  add column deleted_at timestamptz,
  add column page_variant text not null default 'standard'
    check (page_variant in ('standard', 'custom')),
  add column custom_template_key text;

-- No check tying custom_template_key's presence/validity to
-- page_variant: the registry lookup
-- (src/components/doctors/templates/registry.ts) is the single source
-- of truth for "valid," and must already tolerate a null/unregistered
-- key by falling back to the standard template -- a DB constraint here
-- would just duplicate logic the app layer must have regardless.

-- ---------------------------------------------------------------------
-- Suspension must be immediate and comprehensive -- not just "hidden
-- from the dashboard" -- so the fix goes into the two helper functions
-- nearly every staff-scoped RLS policy in the schema already calls
-- (doctors_select, clinics_*, appointment_types_*, working_hours/
-- breaks/blocked_periods/schedule_exceptions, doctor_secretaries_*,
-- doctor_qualifications/publications/books/media_appearances), rather
-- than touching each policy individually. cancel_appointment/
-- reschedule_appointment/record_appointment_outcome are updated below
-- to call this same helper instead of duplicating the check, so they
-- inherit the fix too instead of needing a third copy of it.
-- ---------------------------------------------------------------------

create or replace function private.is_doctor_owner(p_user_id uuid, p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.user_id = p_user_id
      and d.suspended_at is null
  );
$$;

create or replace function private.is_staff_for_doctor(p_user_id uuid, p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.user_id = p_user_id
      and d.suspended_at is null
  )
  or exists (
    select 1
    from public.doctor_secretaries ds
    join public.doctors d on d.id = ds.doctor_id
    where ds.doctor_id = p_doctor_id
      and ds.secretary_user_id = p_user_id
      and d.suspended_at is null
  );
$$;

-- doctors_select's standalone `user_id = auth.uid()` branch was
-- redundant with what is_staff_for_doctor already checks internally --
-- dropped so the one helper change above covers this policy completely,
-- not partially (a raw, un-gated branch left in place would have kept
-- letting a suspended doctor read their own row).
drop policy "doctors_select" on public.doctors;
create policy "doctors_select" on public.doctors
  for select
  using (
    is_published
    or private.is_staff_for_doctor(auth.uid(), id)
  );

-- "Only the admin can add/edit/suspend doctors" is a blanket product
-- decision, not just a rule for the four columns above --
-- doctors_update_own predates any dashboard profile-edit UI ever being
-- built (repo-wide grep: nothing performs a doctor self-update).
-- Dropped rather than narrowed to a column allow-list, which would
-- silently need remembering to update every time a future admin-only
-- column is added -- exactly the mistake that would leave
-- suspended_at/deleted_at self-writable if this migration only added
-- columns and left the table-level grant alone.
drop policy "doctors_update_own" on public.doctors;
revoke update on public.doctors from authenticated;

-- ---------------------------------------------------------------------
-- book_appointment runs as service_role, which bypasses RLS entirely --
-- the RLS changes above don't protect a direct, forged Server Action
-- call, so this needs its own explicit check. Body-only change, same
-- signature, plain CREATE OR REPLACE.
-- ---------------------------------------------------------------------

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
  if exists (select 1 from public.doctors d where d.id = p_doctor_id and d.suspended_at is not null) then
    raise exception 'doctor is not accepting bookings' using errcode = '42501';
  end if;

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

  if not private.is_within_working_window(p_doctor_id, p_clinic_id, p_starts_at, v_ends_at, now()) then
    raise exception 'requested time is outside working hours, too soon, or blocked' using errcode = '55001';
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
    join public.clinics c on c.id = v_appointment.clinic_id
    join public.appointment_types at on at.id = v_appointment.appointment_type_id
    where d.id = p_doctor_id;
  end if;

  return v_appointment;
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_appointment / reschedule_appointment / record_appointment_outcome:
-- replace each one's duplicated inline
-- "exists(owner) or exists(secretary)" authorization block with a
-- single call to private.is_staff_for_doctor -- a real dedup (three
-- functions were repeating the same two-branch check verbatim) that
-- also means the suspension fix above applies to all three
-- automatically, not as three separately-maintained copies. Everything
-- else in each function body is unchanged. Same signatures, plain
-- CREATE OR REPLACE.
-- ---------------------------------------------------------------------

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

create or replace function public.record_appointment_outcome(
  p_appointment_id uuid,
  p_actor_user_id uuid,
  p_outcome text
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
  if p_outcome not in ('completed', 'no_show') then
    raise exception 'invalid outcome value' using errcode = '22023';
  end if;

  select * into v_appointment from public.appointments where id = p_appointment_id for update;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  v_authorized := private.is_staff_for_doctor(p_actor_user_id, v_appointment.doctor_id);

  if not v_authorized then
    raise exception 'actor is not authorized to record an outcome for this appointment' using errcode = '42501';
  end if;

  if v_appointment.status <> 'confirmed' then
    raise exception 'appointment is not in a recordable state' using errcode = '55000';
  end if;

  if v_appointment.ends_at > now() then
    raise exception 'appointment has not ended yet' using errcode = '55002';
  end if;

  update public.appointments
  set status = p_outcome
  where id = p_appointment_id
  returning * into v_appointment;

  insert into public.audit_log (actor_user_id, action, entity_table, entity_id, details)
  values (p_actor_user_id, 'record_appointment_outcome', 'appointments', p_appointment_id, jsonb_build_object('outcome', p_outcome));

  return v_appointment;
end;
$$;
