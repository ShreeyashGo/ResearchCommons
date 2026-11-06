-- Per-user fixed-window rate limits, enforced in API routes via hit_rate_limit().

create table public.rate_limits (
  bucket text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, user_id, window_start)
);

alter table public.rate_limits enable row level security;
-- No policies: only reachable through hit_rate_limit (security definer).
revoke all on public.rate_limits from anon, authenticated;

create or replace function public.hit_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns table (allowed boolean, retry_after int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_window timestamptz;
  v_count int;
  v_expected_window int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_expected_window := case pg_catalog.split_part(p_bucket, ':', 2) when 'min' then 60 else 86400 end;
  if p_limit < 1
     or p_bucket !~ '^(ask|summary|explain|import|process):(min|day)$'
     or p_window_seconds <> v_expected_window then
    raise exception 'invalid rate limit' using errcode = '22023';
  end if;

  v_window := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits as r (bucket, user_id, window_start, count)
  values (p_bucket, v_uid, v_window, 1)
  on conflict (bucket, user_id, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  delete from public.rate_limits
   where user_id = v_uid and bucket = p_bucket and window_start < v_window;

  allowed := v_count <= p_limit;
  retry_after := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::int)
  end;
  return next;
end;
$$;

revoke all on function public.hit_rate_limit(text, int, int) from public, anon;
grant execute on function public.hit_rate_limit(text, int, int) to authenticated;
