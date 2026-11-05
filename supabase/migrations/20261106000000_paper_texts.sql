-- Cached per-page text of a canonical paper, written by the processing
-- pipeline so Ask AI / summaries don't re-download and re-parse the PDF.
-- pages: [{ "pageIndex": 0, "text": "..." }, ...] (whitespace-normalized)

create table public.paper_texts (
  paper_id uuid primary key references public.papers(id) on delete cascade,
  pages jsonb not null default '[]'::jsonb,
  extracted_at timestamptz not null default now()
);

alter table public.paper_texts enable row level security;

-- Readable by anyone who can read the paper; writes are service-role only.
create policy paper_texts_select on public.paper_texts for select to authenticated
  using (public.can_read_paper(paper_id));

revoke all on public.paper_texts from anon;
revoke insert, update, delete, truncate on public.paper_texts from authenticated;
