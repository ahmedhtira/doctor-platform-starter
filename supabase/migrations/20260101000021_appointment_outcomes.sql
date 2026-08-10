-- M8: closes the one remaining appointment-status gap open since M1 —
-- appointments.status has allowed 'completed'/'no_show' since the original
-- check constraint (migration 0008), but no function has ever written
-- either value. This is that write path: staff mark a past 'confirmed'
-- appointment as one or the other after it happens. No patient path
-- exists (a patient has no reason to record their own attendance), so
-- unlike cancel_appointment/reschedule_appointment this takes a single
-- required p_actor_user_id rather than an optional actor-or-session pair.
--
-- One function, not two ('complete_appointment' / 'mark_no_show'):
-- 'completed' and 'no_show' share every precondition (authorization,
-- current status must be 'confirmed', the appointment must already have
-- ended) and differ only in the status value written. Splitting would
-- duplicate that whole precondition chain for a one-string difference —
-- unlike cancel_appointment/reschedule_appointment, which genuinely differ
-- in what they write and so earn separate functions despite a similar-
-- looking authorization block.
--
-- Enforced here, not just in the dashboard UI: the appointment must
-- already be over (ends_at <= now()) before an outcome can be recorded.
-- Same write-layer-is-the-authority stance as is_within_working_window and
-- the 'confirmed'-status precondition below — a UI-only guard is a
-- convenience the write path must not rely on (a client's clock is not
-- authoritative). New errcode 55002, continuing the class-55 ("object not
-- in prerequisite state") numbering 55000/55001 already use.
--
-- Deliberately no email_outbox enqueue: this is an internal clinic record
-- (was the patient seen or not), not something that changes what the
-- patient was told to expect — nothing about their appointment moved or
-- was cancelled.

create function public.record_appointment_outcome(
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

  -- Locks the row before any precondition check, not just before the
  -- update: without this, a concurrent cancel/reschedule/outcome request
  -- could change the row between this function's checks and its write
  -- (classic check-then-act race). Every check below (authorization,
  -- status, ends_at) runs against the now-locked row.
  select * into v_appointment from public.appointments where id = p_appointment_id for update;

  if v_appointment.id is null then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;

  v_authorized := exists (
    select 1 from public.doctors d where d.id = v_appointment.doctor_id and d.user_id = p_actor_user_id
  ) or exists (
    select 1 from public.doctor_secretaries ds
    where ds.doctor_id = v_appointment.doctor_id and ds.secretary_user_id = p_actor_user_id
  );

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

revoke all on function public.record_appointment_outcome(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_appointment_outcome(uuid, uuid, text) to service_role;
