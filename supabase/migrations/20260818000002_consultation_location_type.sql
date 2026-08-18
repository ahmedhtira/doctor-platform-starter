-- A doctor's consultation location can be a private practice,
-- clinic, hospital, medical centre, or another type of facility.

alter table public.clinics
  add column if not exists location_type text not null default 'other';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clinics_location_type_check'
  ) then
    alter table public.clinics
      add constraint clinics_location_type_check
      check (
        location_type in (
          'private_practice',
          'clinic',
          'hospital',
          'medical_center',
          'other'
        )
      );
  end if;
end
$$;

comment on column public.clinics.location_type is
  'Type of consultation location: private_practice, clinic, hospital, medical_center, or other.';
