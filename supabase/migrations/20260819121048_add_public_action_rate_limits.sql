create table if not exists private.rate_limit_buckets (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null
);

create index if not exists rate_limit_buckets_updated_at_idx
  on private.rate_limit_buckets (updated_at);

revoke all on table private.rate_limit_buckets from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if nullif(btrim(p_bucket_key), '') is null then
    raise exception 'bucket key is required' using errcode = '22023';
  end if;

  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;

  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit window' using errcode = '22023';
  end if;

  insert into private.rate_limit_buckets as b (
    bucket_key,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_bucket_key,
    v_now,
    1,
    v_now
  )
  on conflict (bucket_key) do update
  set
    request_count = case
      when b.window_started_at + make_interval(secs => p_window_seconds) <= v_now then 1
      else b.request_count + 1
    end,
    window_started_at = case
      when b.window_started_at + make_interval(secs => p_window_seconds) <= v_now then v_now
      else b.window_started_at
    end,
    updated_at = v_now
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;
