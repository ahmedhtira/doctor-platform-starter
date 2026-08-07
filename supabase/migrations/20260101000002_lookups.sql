-- M1: locale and specialty lookup tables. Public, read-only reference data.
create table public.supported_locales (
  code text primary key,
  name text not null,
  is_active boolean not null default true
);

insert into public.supported_locales (code, name) values
  ('fr', 'Français'),
  ('ar', 'العربية');

create table public.specialties (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_fr text not null,
  name_ar text not null,
  created_at timestamptz not null default now()
);

alter table public.supported_locales enable row level security;
alter table public.specialties enable row level security;

create policy "supported_locales_public_read" on public.supported_locales
  for select
  using (true);

create policy "specialties_public_read" on public.specialties
  for select
  using (true);

-- No auto-expose in this CLI version: grant read explicitly. No write
-- grants — these are reference data managed via migration/service_role only.
grant select on public.supported_locales to anon, authenticated;
grant select on public.specialties to anon, authenticated;
