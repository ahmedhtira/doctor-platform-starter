-- M1: derived-availability function. This is how the public site is meant
-- to learn what's bookable — the raw working_hours/breaks/blocked_periods/
-- schedule_exceptions rows are never queried directly by anon.
--
-- It lives in `public` (not `private`) because it must be callable via
-- supabase-js `.rpc()` from a trusted Next.js server route using the
-- service-role client — `.rpc()` always goes through PostgREST, and only
-- `public`/`graphql_public` are exposed to PostgREST (see
-- supabase/config.toml `api.schemas`), so a `private`-schema function
-- would be unreachable that way regardless of grants. Restricting it to
-- service_role via REVOKE/GRANT (below) gets the same "not public" outcome
-- while staying callable by the trusted server.
create or replace function public.compute_available_slots(
  p_doctor_id uuid,
  p_clinic_id uuid,
  p_appointment_type_id uuid,
  p_local_date date,
  p_now timestamptz
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_duration_minutes integer;
  v_notice_minutes integer;
  v_day_of_week integer;
  v_exception record;
  v_window_start time;
  v_window_end time;
  v_range_start timestamptz;
  v_range_end timestamptz;
  v_candidate_start timestamptz;
  v_candidate_end timestamptz;
begin
  select c.timezone into v_timezone
  from public.clinics c
  where c.id = p_clinic_id and c.doctor_id = p_doctor_id;

  if v_timezone is null then
    return;
  end if;

  select at.duration_minutes into v_duration_minutes
  from public.appointment_types at
  where at.id = p_appointment_type_id and at.doctor_id = p_doctor_id;

  if v_duration_minutes is null then
    return;
  end if;

  select d.min_booking_notice_minutes into v_notice_minutes
  from public.doctors d
  where d.id = p_doctor_id;

  v_day_of_week := extract(dow from p_local_date);

  select se.* into v_exception
  from public.schedule_exceptions se
  where se.doctor_id = p_doctor_id
    and se.clinic_id = p_clinic_id
    and se.date = p_local_date;

  if found and v_exception.is_closed then
    return;
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
      return;
    end if;
  end if;

  v_range_start := (p_local_date + v_window_start) at time zone v_timezone;
  v_range_end := (p_local_date + v_window_end) at time zone v_timezone;
  v_candidate_start := v_range_start;

  while v_candidate_start + make_interval(mins => v_duration_minutes) <= v_range_end loop
    v_candidate_end := v_candidate_start + make_interval(mins => v_duration_minutes);

    if v_candidate_start >= p_now + make_interval(mins => coalesce(v_notice_minutes, 0))
      and not exists (
        select 1 from public.breaks b
        where b.doctor_id = p_doctor_id
          and b.clinic_id = p_clinic_id
          and b.day_of_week = v_day_of_week
          and tstzrange(
                (p_local_date + b.start_time) at time zone v_timezone,
                (p_local_date + b.end_time) at time zone v_timezone
              ) && tstzrange(v_candidate_start, v_candidate_end)
      )
      and not exists (
        select 1 from public.blocked_periods bp
        where bp.doctor_id = p_doctor_id
          and (bp.clinic_id is null or bp.clinic_id = p_clinic_id)
          and tstzrange(bp.starts_at, bp.ends_at) && tstzrange(v_candidate_start, v_candidate_end)
      )
      and not exists (
        select 1 from public.appointments a
        where a.doctor_id = p_doctor_id
          and a.status = 'confirmed'
          and tstzrange(a.starts_at, a.ends_at) && tstzrange(v_candidate_start, v_candidate_end)
      )
    then
      slot_start := v_candidate_start;
      slot_end := v_candidate_end;
      return next;
    end if;

    v_candidate_start := v_candidate_end;
  end loop;

  return;
end;
$$;

revoke all on function public.compute_available_slots(uuid, uuid, uuid, date, timestamptz) from public, anon, authenticated;
grant execute on function public.compute_available_slots(uuid, uuid, uuid, date, timestamptz) to service_role;
