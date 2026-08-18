-- Public doctor profile photo.
-- Only the object path inside the doctor-photos bucket is stored here.

alter table public.doctors
  add column if not exists photo_path text;

comment on column public.doctors.photo_path is
  'Object path inside the public doctor-photos Supabase Storage bucket.';
