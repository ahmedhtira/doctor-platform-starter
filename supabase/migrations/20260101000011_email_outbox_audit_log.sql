-- M1: internal bookkeeping tables. Both are written only by the
-- service_role-only functions in migration 0013 and never read by
-- anon/authenticated — no RLS policies (default deny) plus an explicit
-- REVOKE as a second, independent lock.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  locale text references public.supported_locales (code),
  template text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null,
  entity_table text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.email_outbox enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.email_outbox from public, anon, authenticated;
revoke all on public.audit_log from public, anon, authenticated;
