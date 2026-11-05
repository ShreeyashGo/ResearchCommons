-- Durable Postgres job queue. Replaces fire-and-forget after() processing:
-- routes enqueue, a worker claims with FOR UPDATE SKIP LOCKED under a lease,
-- and expired leases (crashed workers) are reclaimed. Service-role only.

create type public.job_status as enum ('queued', 'running', 'done', 'failed');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts > 0),
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live processing job per paper.
create unique index jobs_paper_process_active
  on public.jobs ((payload->>'paperId'))
  where kind = 'paper.process' and status in ('queued', 'running');

create index jobs_claimable on public.jobs (run_after) where status in ('queued', 'running');

alter table public.jobs enable row level security; -- no policies: service role only
revoke all on public.jobs from anon, authenticated;

-- Claim up to p_limit due jobs: queued ones whose run_after has passed, plus
-- running ones whose lease expired (worker crashed). A job whose lease expired
-- with no attempts left is marked failed instead of being reclaimed.
create or replace function public.claim_jobs(p_limit int default 1, p_lease_seconds int default 600)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  with dead as (
    update public.jobs
       set status = 'failed',
           last_error = coalesce(last_error, 'lease expired'),
           locked_until = null,
           updated_at = now()
     where status = 'running' and locked_until < now() and attempts >= max_attempts
    returning kind, payload
  )
  update public.papers p
     set processing_status = 'failed',
         processing_error = 'processing timed out'
    from dead
   where dead.kind = 'paper.process'
     and p.id::text = dead.payload->>'paperId'
     and p.processing_status in ('pending', 'processing');

  return query
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where j.id in (
     select c.id from public.jobs c
      where (c.status = 'queued' and c.run_after <= now())
         or (c.status = 'running' and c.locked_until < now() and c.attempts < c.max_attempts)
      order by c.run_after
      limit greatest(p_limit, 0)
      for update skip locked
   )
  returning j.*;
end $$;

revoke all on function public.claim_jobs(int, int) from public, anon, authenticated;
grant execute on function public.claim_jobs(int, int) to service_role;
