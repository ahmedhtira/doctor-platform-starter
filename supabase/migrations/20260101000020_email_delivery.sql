-- M7: transactional email delivery.
--
-- Three additions, explained in more depth in PROJECT_SPEC.md's M7 section:
--
-- 1. email_outbox becomes a real work queue: pending -> processing ->
--    sent/pending/failed, with a claim-token-guarded lease (claim_token,
--    processing_started_at) so two concurrent workers can never process
--    the same row, and a stale-lease recovery window so a crashed worker
--    can't strand a row forever.
--
-- 2. appointment_management_tokens gains an optional link back to the
--    email_outbox row that caused its creation (email_outbox_id, unique
--    when non-null), and create_management_token becomes idempotent per
--    outbox row (upsert, not insert). Paired with a *deterministic*
--    (HMAC-derived, not random) raw token generated in trusted Node code
--    for the email-delivery path specifically (src/lib/email/derive-management-token.ts),
--    this means a worker retry -- even from a different process, after a
--    crash -- always reproduces the exact same management link, which is
--    what makes a single stable Resend idempotency key per outbox event
--    safe to reuse across retries.
--
-- 3. book_appointment/cancel_appointment/reschedule_appointment snapshot
--    the display data an email needs into email_outbox.payload at enqueue
--    time (not just {appointment_id} as before), so a retry never renders
--    from live appointment state that could have changed (the appointment
--    could be rescheduled or cancelled again while an older email is
--    still queued). cancel_appointment and reschedule_appointment also
--    start enqueueing mail at all -- previously only book_appointment did.
--
-- All three functions' *parameter signatures* are unchanged -- only
-- create_management_token's signature changes (drop+create, matching this
-- repo's own established precedent for that situation).

-- ---------------------------------------------------------------------
-- 1. email_outbox: claim/lease columns, extended status, template
--    version, first-send-attempt tracking for the 23h idempotency window.
-- ---------------------------------------------------------------------

alter table public.email_outbox
  drop constraint email_outbox_status_check;

alter table public.email_outbox
  add constraint email_outbox_status_check
    check (status in ('pending', 'processing', 'sent', 'failed'));

alter table public.email_outbox
  add column processing_started_at timestamptz,
  add column claim_token uuid,
  add column last_error text,
  add column template_version integer not null default 1,
  add column first_send_attempt_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. claim_email_outbox_batch -- atomic pending/stale-processing ->
--    processing claim. `for update skip locked` gives concurrent callers
--    disjoint row sets without an application-level mutex; the
--    `processing`-and-stale branch is the lease-recovery path for a
--    crashed worker.
-- ---------------------------------------------------------------------

create function public.claim_email_outbox_batch(
  p_limit integer,
  p_max_attempts integer,
  p_claim_token uuid,
  p_stale_after_minutes integer default 10
)
returns setof public.email_outbox
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.email_outbox
  set status = 'processing',
      processing_started_at = now(),
      claim_token = p_claim_token,
      attempts = attempts + 1
  where id in (
    select id from public.email_outbox
    where (
      status = 'pending'
      or (status = 'processing' and processing_started_at < now() - make_interval(mins => p_stale_after_minutes))
    )
    and attempts < p_max_attempts
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

revoke all on function public.claim_email_outbox_batch(integer, integer, uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox_batch(integer, integer, uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- 3. appointment_management_tokens: traceability link + idempotent
--    upsert for the email-delivery path.
-- ---------------------------------------------------------------------

alter table public.appointment_management_tokens
  add column email_outbox_id uuid references public.email_outbox (id) on delete set null;

alter table public.appointment_management_tokens
  add constraint appointment_management_tokens_email_outbox_id_key unique (email_outbox_id);

-- Signature is changing (new trailing param) -- CREATE OR REPLACE would
-- otherwise create a second overload alongside the old 3-arg version
-- instead of replacing it (same reason migration 19 dropped-then-created
-- cancel_appointment/reschedule_appointment).
drop function if exists public.create_management_token(uuid, text, timestamptz);

create function public.create_management_token(
  p_appointment_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_email_outbox_id uuid default null
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

  if p_email_outbox_id is not null then
    -- Idempotent per outbox row: the caller derives the same raw
    -- token/hash deterministically on every attempt for a given
    -- email_outbox_id (see derive-management-token.ts), so this upsert
    -- is a no-op after the first call -- never a second live row for the
    -- same outbox event. used_at is deliberately never touched here, so
    -- an already-redeemed token can't be resurrected by reprocessing.
    insert into public.appointment_management_tokens (appointment_id, token_hash, expires_at, email_outbox_id)
    values (p_appointment_id, p_token_hash, p_expires_at, p_email_outbox_id)
    on conflict (email_outbox_id) do update
      set token_hash = excluded.token_hash,
          expires_at = excluded.expires_at
    returning * into v_token;
  else
    -- Unchanged: on-screen tokens (book_appointment/reschedule_appointment's
    -- own direct inserts don't even call this function, but this branch
    -- preserves create_management_token's original plain-insert behavior
    -- for any email_outbox_id-less caller).
    insert into public.appointment_management_tokens (appointment_id, token_hash, expires_at)
    values (p_appointment_id, p_token_hash, p_expires_at)
    returning * into v_token;
  end if;

  return v_token;
end;
$$;

revoke all on function public.create_management_token(uuid, text, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.create_management_token(uuid, text, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 4. book_appointment / cancel_appointment / reschedule_appointment:
--    snapshot payload, plus (cancel/reschedule) the enqueue itself.
--    Body-only changes -- parameter signatures are identical to the
--    versions in migrations 18/19, so plain CREATE OR REPLACE (existing
--    grants are preserved automatically; no re-grant needed).
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
