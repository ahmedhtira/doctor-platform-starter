-- Confirmation-email management links are bearer links that patients may
-- reasonably reopen from another browser/device while the link is still valid.
-- Keep random/on-screen management tokens single-use; only tokens minted for a
-- durable email_outbox row (email_outbox_id IS NOT NULL) may create another
-- short-lived management session after their first redemption.
create or replace function public.redeem_management_token(
  p_token_hash text,
  p_session_secret_hash text
)
returns public.appointment_management_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token public.appointment_management_tokens;
  v_session public.appointment_management_sessions;
begin
  select * into v_token
  from public.appointment_management_tokens
  where token_hash = p_token_hash
    and expires_at > now()
    and (used_at is null or email_outbox_id is not null);

  if v_token.id is null then
    raise exception 'invalid or expired token' using errcode = '42501';
  end if;

  -- Preserve first-redemption time for audit purposes. Email-derived tokens
  -- remain redeemable until expires_at; ordinary tokens remain single-use.
  update public.appointment_management_tokens
  set used_at = coalesce(used_at, now())
  where id = v_token.id;

  insert into public.appointment_management_sessions (
    token_id,
    appointment_id,
    expires_at,
    session_secret_hash
  )
  values (
    v_token.id,
    v_token.appointment_id,
    now() + interval '30 minutes',
    p_session_secret_hash
  )
  returning * into v_session;

  return v_session;
end;
$$;

revoke all on function public.redeem_management_token(text, text) from public, anon, authenticated;
grant execute on function public.redeem_management_token(text, text) to service_role;
