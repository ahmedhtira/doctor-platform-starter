-- M1: per-doctor appointment types (name + duration). Duration drives slot
-- computation and the ends_at calculation in book_appointment/reschedule.
create table public.appointment_types (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  created_at timestamptz not null default now(),
  unique (doctor_id, id)
);

alter table public.appointment_types enable row level security;

create policy "appointment_types_select" on public.appointment_types
  for select
  using (
    exists (select 1 from public.doctors d where d.id = doctor_id and d.is_published)
    or private.is_staff_for_doctor(auth.uid(), doctor_id)
  );

create policy "appointment_types_insert" on public.appointment_types
  for insert
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "appointment_types_update" on public.appointment_types
  for update
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "appointment_types_delete" on public.appointment_types
  for delete
  using (private.is_staff_for_doctor(auth.uid(), doctor_id));

grant select, insert, update, delete on public.appointment_types to authenticated;
grant select on public.appointment_types to anon;
