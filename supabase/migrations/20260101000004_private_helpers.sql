-- M1: hardened RLS helper functions in a dedicated, non-API-exposed schema.
-- `private` is not in api.schemas (see supabase/config.toml), so these are
-- unreachable via PostgREST/.rpc() regardless of grants — they only exist
-- to be called from inside RLS policy expressions and other functions.
--
-- Both are SECURITY DEFINER with a locked-down search_path and fully
-- qualified table references. SECURITY DEFINER makes them run as the
-- defining role (the migration role, which owns these tables and is not
-- subject to its own RLS policies), which is what avoids the recursive
-- RLS evaluation a SECURITY INVOKER helper would trigger when policies on
-- doctors/clinics/etc. call back into doctors/doctor_secretaries.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_doctor_owner(p_user_id uuid, p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.user_id = p_user_id
  );
$$;

create or replace function private.is_staff_for_doctor(p_user_id uuid, p_doctor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.doctors d
    where d.id = p_doctor_id
      and d.user_id = p_user_id
  )
  or exists (
    select 1
    from public.doctor_secretaries ds
    where ds.doctor_id = p_doctor_id
      and ds.secretary_user_id = p_user_id
  );
$$;

revoke all on function private.is_doctor_owner(uuid, uuid) from public;
revoke all on function private.is_staff_for_doctor(uuid, uuid) from public;
grant execute on function private.is_doctor_owner(uuid, uuid) to authenticated;
grant execute on function private.is_staff_for_doctor(uuid, uuid) to authenticated;
