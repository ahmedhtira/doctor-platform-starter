-- M1: doctor schedule rules. None of these are exposed to anon — patients
-- only ever see derived availability through compute_available_slots(),
-- never the raw rules (a blocked_periods.reason, for instance, is not
-- public information). Staff (doctor or their secretaries) manage all of
-- these for their own doctor via private.is_staff_for_doctor.

create table public.working_hours (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  clinic_id uuid not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (doctor_id, clinic_id) references public.clinics (doctor_id, id) on delete cascade,
  unique (doctor_id, clinic_id, day_of_week)
);

create table public.breaks (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  clinic_id uuid not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (start_time < end_time),
  foreign key (doctor_id, clinic_id) references public.clinics (doctor_id, id) on delete cascade,
  unique (doctor_id, clinic_id, day_of_week, start_time)
);

create table public.blocked_periods (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  clinic_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  check (starts_at < ends_at),
  foreign key (doctor_id, clinic_id) references public.clinics (doctor_id, id) on delete cascade
);

create table public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null,
  clinic_id uuid not null,
  date date not null,
  is_closed boolean not null default false,
  start_time time,
  end_time time,
  check (
    (is_closed and start_time is null and end_time is null)
    or (not is_closed and start_time is not null and end_time is not null and start_time < end_time)
  ),
  foreign key (doctor_id, clinic_id) references public.clinics (doctor_id, id) on delete cascade,
  unique (doctor_id, clinic_id, date)
);

alter table public.working_hours enable row level security;
alter table public.breaks enable row level security;
alter table public.blocked_periods enable row level security;
alter table public.schedule_exceptions enable row level security;

create policy "working_hours_staff_all" on public.working_hours
  for all
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "breaks_staff_all" on public.breaks
  for all
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "blocked_periods_staff_all" on public.blocked_periods
  for all
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "schedule_exceptions_staff_all" on public.schedule_exceptions
  for all
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

-- authenticated only — no anon grant on any schedule table.
grant select, insert, update, delete on public.working_hours to authenticated;
grant select, insert, update, delete on public.breaks to authenticated;
grant select, insert, update, delete on public.blocked_periods to authenticated;
grant select, insert, update, delete on public.schedule_exceptions to authenticated;
