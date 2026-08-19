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
    and p_user_id = (select auth.uid())
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

-- RLS policies on public-readable doctor tables call this helper even when
-- the caller is anonymous. The function itself now binds p_user_id to the
-- caller's auth.uid(), so anonymous callers always receive false and an
-- authenticated caller can only test their own staff membership.
grant execute on function private.is_staff_for_doctor(uuid, uuid) to anon, authenticated;
