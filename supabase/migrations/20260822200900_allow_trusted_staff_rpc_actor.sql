-- The RLS helper must continue rejecting forged user IDs from anon/authenticated
-- callers, while service-role-only staff RPCs need to validate the user ID that
-- trusted Next.js server code already resolved with supabase.auth.getUser().
--
-- Previously the helper required p_user_id = auth.uid() unconditionally. A
-- service-role JWT has no end-user auth.uid(), so service-role-only staff RPCs
-- that call this helper could reject a legitimate doctor/secretary. Allow only
-- the service_role JWT to supply the already-authenticated actor ID. Public and
-- authenticated callers keep the exact anti-forgery binding they had before.
create or replace function private.is_staff_for_doctor(
  p_user_id uuid,
  p_doctor_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_user_id is not null
    and (
      p_user_id = (select auth.uid())
      or coalesce((select auth.role()) = 'service_role', false)
    )
    and (
      exists (
        select 1
        from public.doctors d
        where d.id = p_doctor_id
          and d.user_id = p_user_id
          and d.suspended_at is null
      )
      or exists (
        select 1
        from public.doctor_secretaries ds
        join public.doctors d on d.id = ds.doctor_id
        where ds.doctor_id = p_doctor_id
          and ds.secretary_user_id = p_user_id
          and d.suspended_at is null
      )
    );
$$;

-- Preserve the existing RLS callers. The function itself still binds
-- anon/authenticated callers to auth.uid(); service_role bypasses RLS and is
-- used only by trusted server-side RPC paths.
grant execute on function private.is_staff_for_doctor(uuid, uuid) to anon, authenticated;
