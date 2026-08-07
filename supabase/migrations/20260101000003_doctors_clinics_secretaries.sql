-- M1: core staff identity tables. RLS is enabled here but policies are
-- attached in a later migration (20260101000005) after the private helper
-- functions exist — see that file for why.
create table public.doctors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  specialty_id uuid not null references public.specialties (id),
  full_name text not null,
  bio text,
  phone text,
  slug text not null unique,
  default_locale text not null references public.supported_locales (code),
  timezone text not null,
  min_booking_notice_minutes integer not null default 60
    check (min_booking_notice_minutes >= 0),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.clinics (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  name text not null,
  address text not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  unique (doctor_id, id)
);

create table public.doctor_secretaries (
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  secretary_user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (doctor_id, secretary_user_id)
);

alter table public.doctors enable row level security;
alter table public.clinics enable row level security;
alter table public.doctor_secretaries enable row level security;
