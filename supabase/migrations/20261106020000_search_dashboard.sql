-- Full-text search over papers + one-round-trip dashboard + grouped library counts.

create or replace function public.paper_search_document(p_title text, p_authors text[], p_abstract text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(p_title, '')), 'A')
      || pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(pg_catalog.array_to_string(p_authors, ' '), '')), 'B')
      || pg_catalog.setweight(pg_catalog.to_tsvector('english'::pg_catalog.regconfig, coalesce(p_abstract, '')), 'C')
$$;

alter table public.papers
  add column search_tsv tsvector
  generated always as (public.paper_search_document(title, authors, abstract)) stored;

create index papers_search_tsv_idx on public.papers using gin (search_tsv);

-- Ranked library search. Security invoker: RLS on group_papers/papers applies.
-- FTS (websearch syntax) plus a substring fallback so short/partial terms still match.
create or replace function public.search_group_library(p_group_id uuid, p_q text, p_tag text default null)
returns table (paper_id uuid, rank real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select pg_catalog.websearch_to_tsquery('english'::pg_catalog.regconfig, p_q) as tsq,
           '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p_q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select gp.paper_id,
         ((case when p.search_tsv @@ q.tsq then pg_catalog.ts_rank_cd(p.search_tsv, q.tsq) else 0 end)
          + (case when p.title ilike q.pat then 1 else 0 end))::real as rank
    from public.group_papers gp
    join public.papers p on p.id = gp.paper_id
   cross join q
   where gp.group_id = p_group_id
     and (p_tag is null or p_tag = any (gp.tags))
     and (p.search_tsv @@ q.tsq
          or p.title ilike q.pat
          or coalesce(p.abstract, '') ilike q.pat
          or pg_catalog.array_to_string(p.authors, ' ') ilike q.pat)
   order by rank desc, gp.added_at desc
$$;

-- Visible annotation count (RLS hides others' private ones) + review count per paper.
create or replace function public.library_counts(p_group_id uuid, p_paper_ids uuid[])
returns table (paper_id uuid, annotations int, reviews int)
language sql
stable
security invoker
set search_path = ''
as $$
  select ids.pid,
         (select count(*)::int from public.annotations a where a.group_id = p_group_id and a.paper_id = ids.pid),
         (select count(*)::int from public.paper_reviews r where r.group_id = p_group_id and r.paper_id = ids.pid)
    from pg_catalog.unnest(p_paper_ids) as ids(pid)
$$;

-- Dashboard stats, recently annotated paper ids and the merged activity feed in one call.
-- Security invoker: others' private annotations (and comments on them) stay invisible.
create or replace function public.group_dashboard(p_group_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'stats', pg_catalog.jsonb_build_object(
      'papers', (select count(*) from public.group_papers where group_id = p_group_id),
      'annotations', (select count(*) from public.annotations where group_id = p_group_id),
      'comments', (select count(*) from public.comments where group_id = p_group_id and deleted_at is null),
      'reviews', (select count(*) from public.paper_reviews where group_id = p_group_id),
      'members', (select count(*) from public.group_memberships where group_id = p_group_id)
    ),
    'recentlyAnnotated', coalesce((
      select pg_catalog.jsonb_agg(r.paper_id order by r.last_at desc)
        from (
          select e.paper_id, max(e.created_at) as last_at
            from (
              select paper_id, created_at from public.annotations where group_id = p_group_id
              union all
              select paper_id, created_at from public.comments where group_id = p_group_id
            ) e
           group by e.paper_id
           order by last_at desc
           limit 10
        ) r
    ), '[]'::jsonb),
    'activity', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) order by f.at desc)
        from (
          select a.*, p.title as paper_title, pr.display_name as actor_name
            from (
              (select 'paper_added'::text as type, gp.added_at as at, gp.added_by as actor_id, gp.paper_id,
                      null::uuid as annotation_id, null::uuid as comment_id, null::uuid as review_id, null::text as text
                 from public.group_papers gp where gp.group_id = p_group_id
                order by gp.added_at desc limit 30)
              union all
              (select 'annotation_created', an.created_at, an.author_id, an.paper_id,
                      an.id, null, null, an.quote
                 from public.annotations an where an.group_id = p_group_id
                order by an.created_at desc limit 30)
              union all
              (select 'comment_created', c.created_at, c.author_id, c.paper_id,
                      c.annotation_id, c.id, null, pg_catalog.left(c.body, 280)
                 from public.comments c where c.group_id = p_group_id and c.deleted_at is null
                order by c.created_at desc limit 30)
              union all
              (select 'review_saved', rv.updated_at, rv.author_id, rv.paper_id,
                      null, null, rv.id, rv.tldr
                 from public.paper_reviews rv where rv.group_id = p_group_id
                order by rv.updated_at desc limit 30)
            ) a
            left join public.papers p on p.id = a.paper_id
            left join public.profiles pr on pr.id = a.actor_id
           order by a.at desc
           limit 30
        ) f
    ), '[]'::jsonb)
  )
$$;

grant execute on function public.search_group_library(uuid, text, text) to authenticated;
grant execute on function public.library_counts(uuid, uuid[]) to authenticated;
grant execute on function public.group_dashboard(uuid) to authenticated;
