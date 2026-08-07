-- M1: appointments — the core bookable record.
--
-- Composite ownership FKs guarantee clinic_id, appointment_type_id, and
-- created_by_secretary_id all actually belong to doctor_id (not just to
-- *some* clinic/type/secretary). created_by_secretary_id's FK is null-safe
-- (MATCH SIMPLE) so patient-initiated bookings, which have no secretary,
-- aren't blocked.
--
-- The exclusion constraint is the final no-overlap invariant: two
-- `confirmed` appointments for the same doctor can't have overlapping
-- [starts_at, ends_at) ranges, regardless of clinic (a doctor can't be in
-- two places at once). Non-confirmed statuses are excluded from the
-- constraint so a cancelled slot can be rebooked and a completed/no_show
-- appointment never blocks anything.
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  clinic_id uuid not null,
  appointment_type_id uuid not null,
  created_by_secretary_id uuid,
  patient_name text not null,
  patient_phone text not null,
  patient_email text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed'
    check (status in ('confirmed', 'cancelled', 'completed', 'no_show')),
  notes text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  check (starts_at < ends_at),
  foreign key (doctor_id, clinic_id) references public.clinics (doctor_id, id),
  foreign key (doctor_id, appointment_type_id) references public.appointment_types (doctor_id, id),
  foreign key (doctor_id, created_by_secretary_id) references public.doctor_secretaries (doctor_id, secretary_user_id),
  exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status = 'confirmed')
);

create index appointments_doctor_starts_at_idx on public.appointments (doctor_id, starts_at);

alter table public.appointments enable row level security;

-- Staff can read their own doctor's appointments. No insert/update/delete
-- policy at all: every mutation, staff-initiated or patient-initiated,
-- goes through the service_role-only functions in migration 0013, so
-- there is exactly one write path into this table.
create policy "appointments_select" on public.appointments
  for select
  using (private.is_staff_for_doctor(auth.uid(), doctor_id));

grant select on public.appointments to authenticated;
