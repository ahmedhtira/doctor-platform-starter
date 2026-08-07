-- M1: RLS policies for doctors/clinics/doctor_secretaries, now that the
-- private.* helpers exist. Also the explicit table grants this CLI version
-- requires (auto_expose_new_tables is off by default here).

-- doctors: public sees published profiles; a doctor sees/edits their own
-- row; their secretaries can see it too. No insert/delete policy —
-- provisioning is out-of-band via service_role, not self-signup.
create policy "doctors_select" on public.doctors
  for select
  using (
    is_published
    or user_id = auth.uid()
    or private.is_staff_for_doctor(auth.uid(), id)
  );

create policy "doctors_update_own" on public.doctors
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, update on public.doctors to authenticated;
grant select on public.doctors to anon;

-- clinics: public sees clinics of published doctors; staff manage their
-- own doctor's clinics.
create policy "clinics_select" on public.clinics
  for select
  using (
    exists (select 1 from public.doctors d where d.id = doctor_id and d.is_published)
    or private.is_staff_for_doctor(auth.uid(), doctor_id)
  );

create policy "clinics_insert" on public.clinics
  for insert
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "clinics_update" on public.clinics
  for update
  using (private.is_staff_for_doctor(auth.uid(), doctor_id))
  with check (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "clinics_delete" on public.clinics
  for delete
  using (private.is_staff_for_doctor(auth.uid(), doctor_id));

grant select, insert, update, delete on public.clinics to authenticated;
grant select on public.clinics to anon;

-- doctor_secretaries: any staff member of the doctor can see the roster;
-- only the doctor themselves can manage it (a secretary can't add/remove
-- other secretaries).
create policy "doctor_secretaries_select" on public.doctor_secretaries
  for select
  using (private.is_staff_for_doctor(auth.uid(), doctor_id));

create policy "doctor_secretaries_insert" on public.doctor_secretaries
  for insert
  with check (private.is_doctor_owner(auth.uid(), doctor_id));

create policy "doctor_secretaries_delete" on public.doctor_secretaries
  for delete
  using (private.is_doctor_owner(auth.uid(), doctor_id));

grant select, insert, delete on public.doctor_secretaries to authenticated;
