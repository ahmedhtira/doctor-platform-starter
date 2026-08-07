-- M1: patient self-service tokens/sessions. Raw tokens are generated only
-- in trusted Next.js server code (crypto.randomBytes) and never sent to
-- Postgres — only their SHA-256 hash is stored here, via
-- create_management_token()/book_appointment() (migration 0013). No
-- function or policy ever selects token_hash back out to anon/authenticated;
-- these tables carry no RLS policies at all (default deny) and their table
-- grants are revoked from anon/authenticated as a second, independent lock —
-- only service_role (which bypasses RLS and grants both) can touch them.
create table public.appointment_management_tokens (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.appointment_management_sessions (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.appointment_management_tokens (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.appointment_management_tokens enable row level security;
alter table public.appointment_management_sessions enable row level security;

revoke all on public.appointment_management_tokens from public, anon, authenticated;
revoke all on public.appointment_management_sessions from public, anon, authenticated;
