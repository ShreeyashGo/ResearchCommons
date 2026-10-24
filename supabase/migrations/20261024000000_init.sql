-- Research Commons: initial schema, RLS, RPCs, realtime.
-- Source of truth for the data model is docs/architecture.md (§Data model).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.group_role as enum ('owner', 'member');
create type public.paper_source as enum ('arxiv', 'upload');
create type public.processing_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.annotation_visibility as enum ('group', 'private');
create type public.match_status as enum ('resolved', 'unresolved', 'ambiguous');
create type public.external_source as enum ('semantic_scholar', 'openalex', 'arxiv');
create type public.ai_kind as enum ('paper_summary', 'citation_explanation');
create type public.grounding_level as enum ('full_text', 'abstract_only', 'metadata_only');

-- ---------------------------------------------------------------------------
-- Utility triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
                  split_part(new.email, '@', 1), 'Researcher'), 80)
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Groups and memberships
-- ---------------------------------------------------------------------------
create table public.research_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  invite_code text not null unique default encode(extensions.gen_random_bytes(6), 'hex'),
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger research_groups_updated_at before update on public.research_groups
  for each row execute function public.set_updated_at();

create table public.group_memberships (
  group_id uuid not null references public.research_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.group_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_memberships_user_idx on public.group_memberships (user_id);

-- ---------------------------------------------------------------------------
-- Papers (canonical, shared across groups) and group libraries
-- ---------------------------------------------------------------------------
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  source public.paper_source not null,
  title text not null check (char_length(title) between 1 and 1000),
  authors text[] not null default '{}',
  abstract text,
  year int check (year between 1600 and 2200),
  doi text,
  arxiv_id text unique,           -- normalized, no version suffix, e.g. '1706.06083'
  pdf_sha256 text unique,
  storage_path text,              -- object key in private bucket 'papers'
  page_count int,
  processing_status public.processing_status not null default 'pending',
  processing_error text,
  processed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index papers_doi_idx on public.papers (lower(doi));

create trigger papers_updated_at before update on public.papers
  for each row execute function public.set_updated_at();

create table public.group_papers (
  group_id uuid not null references public.research_groups (id) on delete cascade,
  paper_id uuid not null references public.papers (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  tags text[] not null default '{}',
  added_at timestamptz not null default now(),
  primary key (group_id, paper_id)
);
create index group_papers_paper_idx on public.group_papers (paper_id);

-- ---------------------------------------------------------------------------
-- Annotations and comments (per group)
-- ---------------------------------------------------------------------------
create table public.annotations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  paper_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete cascade,
  visibility public.annotation_visibility not null default 'group',
  color text not null default 'yellow' check (color in ('yellow', 'green', 'blue', 'pink', 'purple')),
  page_index int not null check (page_index >= 0),
  anchor jsonb not null,          -- AnnotationAnchor, see src/contracts/annotations.ts
  quote text not null check (char_length(quote) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (group_id, paper_id) references public.group_papers (group_id, paper_id) on delete cascade
);
create index annotations_paper_group_idx on public.annotations (paper_id, group_id);
create index annotations_group_created_idx on public.annotations (group_id, created_at desc);

create trigger annotations_updated_at before update on public.annotations
  for each row execute function public.set_updated_at();

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null references public.annotations (id) on delete cascade,
  parent_id uuid references public.comments (id) on delete cascade,
  group_id uuid not null,         -- denormalized from annotation by trigger
  paper_id uuid not null,         -- denormalized from annotation by trigger
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) <= 10000),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (deleted_at is not null or char_length(body) >= 1)
);
create index comments_annotation_idx on public.comments (annotation_id, created_at);
create index comments_group_created_idx on public.comments (group_id, created_at desc);

create or replace function public.comments_before_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a record;
  p record;
begin
  if tg_op = 'INSERT' then
    select group_id, paper_id into a from public.annotations where id = new.annotation_id;
    if not found then
      raise exception 'annotation not found' using errcode = '23503';
    end if;
    new.group_id := a.group_id;
    new.paper_id := a.paper_id;
    if new.parent_id is not null then
      select annotation_id, parent_id into p from public.comments where id = new.parent_id;
      if not found or p.annotation_id <> new.annotation_id then
        raise exception 'parent comment must belong to the same annotation' using errcode = '23514';
      end if;
      if p.parent_id is not null then
        raise exception 'only one level of replies is supported' using errcode = '23514';
      end if;
    end if;
  else
    -- immutable columns
    new.annotation_id := old.annotation_id;
    new.parent_id := old.parent_id;
    new.group_id := old.group_id;
    new.paper_id := old.paper_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if old.deleted_at is not null then
      new.deleted_at := old.deleted_at;   -- cannot undelete
    end if;
    if new.deleted_at is not null then
      new.body := '';
    end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger comments_before_write before insert or update on public.comments
  for each row execute function public.comments_before_write();

create or replace function public.annotations_immutable_cols()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.group_id := old.group_id;
  new.paper_id := old.paper_id;
  new.author_id := old.author_id;
  new.page_index := old.page_index;
  new.anchor := old.anchor;
  new.quote := old.quote;
  new.created_at := old.created_at;
  return new;
end $$;

create trigger annotations_immutable before update on public.annotations
  for each row execute function public.annotations_immutable_cols();

-- ---------------------------------------------------------------------------
-- Reviews (per group, one per author per paper)
-- ---------------------------------------------------------------------------
create table public.paper_reviews (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  paper_id uuid not null,
  author_id uuid not null references public.profiles (id) on delete cascade,
  tldr text not null check (char_length(tldr) between 1 and 1000),
  contributions text[] not null default '{}',
  strengths text[] not null default '{}',
  weaknesses text[] not null default '{}',
  findings text[] not null default '{}',
  open_questions text[] not null default '{}',
  relevance text not null default '' check (char_length(relevance) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, paper_id, author_id),
  foreign key (group_id, paper_id) references public.group_papers (group_id, paper_id) on delete cascade
);
create index paper_reviews_group_updated_idx on public.paper_reviews (group_id, updated_at desc);

create trigger paper_reviews_updated_at before update on public.paper_reviews
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Citation intelligence (per canonical paper; written by server only)
-- ---------------------------------------------------------------------------
create table public.external_works (
  id uuid primary key default gen_random_uuid(),
  source public.external_source not null,
  external_id text not null,
  title text not null,
  authors text[] not null default '{}',
  year int,
  venue text,
  abstract text,
  doi text,
  arxiv_id text,
  url text,
  open_access_pdf_url text,
  fetched_at timestamptz not null default now(),
  unique (source, external_id)
);

create table public.paper_references (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  ordinal int not null check (ordinal >= 1),
  label text,                     -- e.g. '12' or 'Madry et al., 2018'
  raw_text text not null,
  parsed_title text,
  parsed_authors text[] not null default '{}',
  parsed_year int,
  external_work_id uuid references public.external_works (id) on delete set null,
  match_status public.match_status not null default 'unresolved',
  match_score real check (match_score between 0 and 1),
  match_method text,              -- e.g. 's2_reference_list', 'openalex_title_search'
  created_at timestamptz not null default now(),
  unique (paper_id, ordinal),
  check (match_status <> 'resolved' or external_work_id is not null)
);

create table public.citation_contexts (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers (id) on delete cascade,
  reference_id uuid not null references public.paper_references (id) on delete cascade,
  page_index int not null check (page_index >= 0),
  marker_text text not null,      -- e.g. '[12]'
  sentence text not null,
  paragraph text,
  rects jsonb not null default '[]',   -- NormalizedRect[] of the marker on the page
  detection_method text not null check (detection_method in ('pdf_link', 'regex')),
  created_at timestamptz not null default now()
);
create index citation_contexts_paper_page_idx on public.citation_contexts (paper_id, page_index);
create index citation_contexts_reference_idx on public.citation_contexts (reference_id);

create table public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  kind public.ai_kind not null,
  cache_key text not null unique,
  paper_id uuid references public.papers (id) on delete cascade,              -- citing paper (citation_explanation) or subject paper
  reference_id uuid references public.paper_references (id) on delete cascade,
  external_work_id uuid references public.external_works (id) on delete cascade,
  provider text not null,
  model text not null,
  is_mock boolean not null,
  prompt_version text not null,
  grounding public.grounding_level not null,
  output jsonb not null,          -- validated against src/contracts/ai.ts before insert
  created_at timestamptz not null default now(),
  check (paper_id is not null or external_work_id is not null),
  check (kind <> 'citation_explanation' or (paper_id is not null and reference_id is not null))
);

-- ---------------------------------------------------------------------------
-- RLS helper functions (SECURITY DEFINER to avoid recursive policy evaluation)
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = gid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_group_owner(gid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_memberships m
    where m.group_id = gid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

create or replace function public.can_read_paper(pid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_papers gp
    join public.group_memberships m on m.group_id = gp.group_id
    where gp.paper_id = pid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.can_read_annotation(aid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.annotations a
    join public.group_memberships m on m.group_id = a.group_id and m.user_id = (select auth.uid())
    where a.id = aid and (a.visibility = 'group' or a.author_id = (select auth.uid()))
  );
$$;

create or replace function public.shares_group_with(uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select uid = (select auth.uid()) or exists (
    select 1 from public.group_memberships a
    join public.group_memberships b on a.group_id = b.group_id
    where a.user_id = (select auth.uid()) and b.user_id = uid
  );
$$;

revoke all on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.can_read_paper(uuid), public.can_read_annotation(uuid), public.shares_group_with(uuid)
  from public, anon;
grant execute on function public.is_group_member(uuid), public.is_group_owner(uuid),
  public.can_read_paper(uuid), public.can_read_annotation(uuid), public.shares_group_with(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_group(p_name text, p_description text default '')
returns public.research_groups language plpgsql security definer set search_path = '' as $$
declare
  g public.research_groups;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.research_groups (name, description, created_by)
  values (trim(p_name), coalesce(p_description, ''), (select auth.uid()))
  returning * into g;
  insert into public.group_memberships (group_id, user_id, role)
  values (g.id, (select auth.uid()), 'owner');
  return g;
end $$;

create or replace function public.join_group(p_invite_code text)
returns public.research_groups language plpgsql security definer set search_path = '' as $$
declare
  g public.research_groups;
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into g from public.research_groups where invite_code = lower(trim(p_invite_code));
  if not found then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  insert into public.group_memberships (group_id, user_id, role)
  values (g.id, (select auth.uid()), 'member')
  on conflict (group_id, user_id) do nothing;
  return g;
end $$;

revoke all on function public.create_group(text, text), public.join_group(text) from public, anon;
grant execute on function public.create_group(text, text), public.join_group(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.research_groups enable row level security;
alter table public.group_memberships enable row level security;
alter table public.papers enable row level security;
alter table public.group_papers enable row level security;
alter table public.annotations enable row level security;
alter table public.comments enable row level security;
alter table public.paper_reviews enable row level security;
alter table public.external_works enable row level security;
alter table public.paper_references enable row level security;
alter table public.citation_contexts enable row level security;
alter table public.ai_summaries enable row level security;

-- profiles: see yourself and people you share a group with; edit yourself
create policy profiles_select on public.profiles for select to authenticated
  using (public.shares_group_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- research_groups: members read; owner updates/deletes; creation via RPC only
create policy groups_select on public.research_groups for select to authenticated
  using (public.is_group_member(id));
create policy groups_update on public.research_groups for update to authenticated
  using (public.is_group_owner(id)) with check (public.is_group_owner(id));
create policy groups_delete on public.research_groups for delete to authenticated
  using (public.is_group_owner(id));

-- group_memberships: members see co-members; leave yourself; owner removes others
create policy memberships_select on public.group_memberships for select to authenticated
  using (public.is_group_member(group_id));
create policy memberships_delete on public.group_memberships for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_group_owner(group_id));

-- papers: readable through any group library you belong to; writes by server (service role)
create policy papers_select on public.papers for select to authenticated
  using (public.can_read_paper(id));

-- group_papers: members read; owner or adder unlinks/retags; linking done by server
create policy group_papers_select on public.group_papers for select to authenticated
  using (public.is_group_member(group_id));
create policy group_papers_update on public.group_papers for update to authenticated
  using (public.is_group_member(group_id)) with check (public.is_group_member(group_id));
create policy group_papers_delete on public.group_papers for delete to authenticated
  using (public.is_group_owner(group_id) or added_by = (select auth.uid()));

-- annotations
create policy annotations_select on public.annotations for select to authenticated
  using (public.is_group_member(group_id)
         and (visibility = 'group' or author_id = (select auth.uid())));
create policy annotations_insert on public.annotations for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy annotations_update on public.annotations for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy annotations_delete on public.annotations for delete to authenticated
  using (author_id = (select auth.uid()));

-- comments (soft delete via update; hard delete only by author)
create policy comments_select on public.comments for select to authenticated
  using (public.can_read_annotation(annotation_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = (select auth.uid()) and public.can_read_annotation(annotation_id));
create policy comments_update on public.comments for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and public.can_read_annotation(annotation_id));
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = (select auth.uid()));

-- reviews
create policy reviews_select on public.paper_reviews for select to authenticated
  using (public.is_group_member(group_id));
create policy reviews_insert on public.paper_reviews for insert to authenticated
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy reviews_update on public.paper_reviews for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()) and public.is_group_member(group_id));
create policy reviews_delete on public.paper_reviews for delete to authenticated
  using (author_id = (select auth.uid()));

-- citation intelligence: read-only for users who can read the paper; server writes
create policy external_works_select on public.external_works for select to authenticated
  using (true);
create policy paper_references_select on public.paper_references for select to authenticated
  using (public.can_read_paper(paper_id));
create policy citation_contexts_select on public.citation_contexts for select to authenticated
  using (public.can_read_paper(paper_id));
create policy ai_summaries_select on public.ai_summaries for select to authenticated
  using (case when paper_id is not null then public.can_read_paper(paper_id) else true end);

-- Prevent reviews/annotations from moving between groups/papers/authors on update.
create or replace function public.reviews_immutable_cols()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.group_id := old.group_id;
  new.paper_id := old.paper_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  return new;
end $$;
create trigger paper_reviews_immutable before update on public.paper_reviews
  for each row execute function public.reviews_immutable_cols();

create or replace function public.group_papers_immutable_cols()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.group_id := old.group_id;
  new.paper_id := old.paper_id;
  new.added_by := old.added_by;
  new.added_at := old.added_at;
  return new;
end $$;
create trigger group_papers_immutable before update on public.group_papers
  for each row execute function public.group_papers_immutable_cols();

-- anon gets nothing
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Realtime (postgres_changes honours RLS for subscribers)
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.annotations, public.comments, public.paper_reviews;
alter table public.annotations replica identity full;
alter table public.comments replica identity full;
alter table public.paper_reviews replica identity full;
