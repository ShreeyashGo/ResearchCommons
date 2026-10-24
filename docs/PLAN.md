# Research Commons — MVP Plan (for approval)

Status: DRAFT, awaiting approval. No implementation starts until approved.

## 1. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Shape | One Next.js 15 (App Router) + TypeScript app, modular monolith | Spec requirement; one deploy, clean module boundaries |
| Package manager | pnpm, Node 20 | Fast, lockfile committed |
| UI | Tailwind + a small set of headless primitives (Radix) | Polished without heavy deps |
| DB / Auth / Storage / Realtime | Supabase. **Local mode = Supabase CLI in Docker** (default). Cloud project is a later env-var swap | $0, no keys needed now |
| API style | REST route handlers under `/api/**`, request/response validated with **zod** schemas in `src/contracts` (single source of truth for types) | Explicit contracts all workstreams build against |
| AI | `LLMProvider` adapter: `mock` (default, deterministic, every output labeled MOCK), `gemini`, `ollama` | Keys optional; swappable |
| PDF | `pdfjs-dist` directly (canvas + text layer + our highlight overlay) | Full control over selection/anchoring |
| Python | Only if needed (e.g. fixture tooling), in repo-local gitignored `.venv` | No global pollution |
| Tests | Vitest (unit + RLS integration vs local Supabase), Playwright (2-user E2E) | Covers P0 flows |

## 2. Architecture

```
Browser (Next.js client)
  ├─ supabase-js: auth session + Realtime subscriptions ONLY
  └─ fetch /api/** for all reads/writes
Next.js server
  ├─ src/app/api/**            thin route handlers: auth → zod validate → service call
  ├─ src/server/<module>/**    services: groups, papers, annotations, reviews, dashboard, storage
  ├─ src/server/citations/**   PDF text extraction, bibliography parse, resolution, contexts
  ├─ src/server/ai/**          LLMProvider adapters, summarize(), explainCitation(), cache
  └─ Supabase clients:
       userClient  (user JWT, RLS enforced)  ← default for everything
       adminClient (service role, server-only) ← only: storage, canonical paper upsert,
                                                 citation pipeline writes, AI cache writes
Supabase (local Docker or cloud): Postgres+RLS, Auth, private Storage bucket, Realtime
External (free): arXiv API, Semantic Scholar, OpenAlex; Gemini optional
```

Rules: service-role key never reaches the client bundle (`server-only` import guard + CI grep). Every admin-client call is preceded by an RLS-checked read with the user client (e.g. "can this user read paper X?").

## 3. Data model (canonical paper vs per-group knowledge)

- `profiles` (id = auth.users.id, display_name) — auto-created on signup.
- `research_groups` (name, description, invite_code, created_by).
- `group_memberships` (group_id, user_id, role owner|member). Create/join via SECURITY DEFINER RPCs `create_group`, `join_group(invite_code)`.
- `papers` — **canonical**, shared across groups: title, authors[], abstract, year, doi, arxiv_id (unique), pdf_sha256 (unique), storage_path, processing_status (pending|processing|ready|failed), processing_error.
- `group_papers` (group_id, paper_id, added_by, tags[]) — a paper in a group's library.
- `annotations` (group_id, paper_id, author_id, visibility group|private, color, page_index, anchor JSON, quote).
- `comments` (annotation_id, parent_id one level of threading, author_id, body, soft delete). group_id/paper_id denormalized by trigger for RLS + realtime filtering.
- `paper_reviews` (group_id, paper_id, author_id, unique per author: tldr, contributions[], strengths[], weaknesses[], findings[], open_questions[], relevance).
- `external_works` — resolved metadata for cited works (source openalex|s2|arxiv, external_id, title, authors, year, abstract, url, oa_pdf_url). Metadata only; we never store cited PDFs.
- `paper_references` (paper_id, ordinal, label e.g. "[12]"/"Madry et al. 2018", raw_text, parsed title/authors/year, external_work_id nullable, match_status resolved|unresolved|ambiguous, match_score, match_method).
- `citation_contexts` (paper_id, reference_id, page_index, marker text, sentence, surrounding paragraph, anchor rects).
- `ai_summaries` (cache): kind paper_summary|citation_explanation, cache_key unique = sha256(kind, subject ids, input hash, prompt_version, model), provider, model, is_mock, grounding full_text|abstract_only|metadata_only, output JSON (zod-validated before insert).

Per-paper intelligence (references, contexts, AI cache) is computed **once per canonical paper** and visible to anyone who can read that paper. Human knowledge (annotations, comments, reviews) is **per group**.

### RLS summary
- Helpers (SECURITY DEFINER, fixed search_path): `is_group_member(g)`, `can_read_paper(p)` (member of any group containing p), `can_read_annotation(a)`.
- groups/memberships: members read; owner manages; self can leave.
- papers: select if `can_read_paper`; writes service-role only (server validates first).
- group_papers: members read; insert service-role (after membership check); delete by owner or adder.
- annotations: select if member AND (visibility=group OR author=me); insert/update/delete author only, must be member; group_id/paper_id immutable.
- comments: select if `can_read_annotation`; author-only writes; soft delete.
- reviews: members read; author-only writes.
- references/contexts/external_works/ai_summaries: read if `can_read_paper` (external_works: any authenticated); writes service-role only.
- Storage bucket `papers` private, no client policies; server issues short-lived signed URLs after `can_read_paper`.
- RLS is tested with two real users (see §7).

## 4. API contracts (all JSON, zod-validated; errors `{ error: { code, message } }`)

| Method & path | Purpose |
|---|---|
| GET `/api/me` | profile + groups |
| POST `/api/groups` · GET `/api/groups` | create (RPC) / list mine |
| POST `/api/groups/join` | `{ inviteCode }` |
| GET `/api/groups/:gid` | group + members |
| GET `/api/groups/:gid/papers?q=&tag=` | library list/search (title/author/abstract ILIKE) |
| POST `/api/groups/:gid/papers/arxiv` | `{ url }` → fetch metadata + PDF, dedupe by arxiv_id, link, kick processing |
| POST `/api/groups/:gid/papers/upload` | multipart PDF (≤20 MB) + optional metadata, dedupe by sha256 |
| GET `/api/papers/:pid?groupId=` | metadata + status + signed PDF URL |
| DELETE `/api/groups/:gid/papers/:pid` | unlink from group |
| GET/POST `/api/groups/:gid/papers/:pid/annotations` | list (with comment threads) / create |
| PATCH/DELETE `/api/annotations/:aid` | edit color/visibility / delete |
| POST `/api/annotations/:aid/comments` · PATCH/DELETE `/api/comments/:cid` | threads |
| GET/PUT/DELETE `/api/groups/:gid/papers/:pid/reviews[/mine]` | list / upsert mine / delete mine |
| GET `/api/papers/:pid/citations` | references + contexts + resolution status |
| POST `/api/papers/:pid/process` | re-run pipeline (idempotent) |
| POST `/api/papers/:pid/citations/:refId/explain` | cached-or-generate contextual explanation |
| GET `/api/groups/:gid/dashboard` | recent papers, annotations, comments, reviews, activity |

Realtime: clients subscribe to `postgres_changes` on `annotations`, `comments`, `paper_reviews` filtered by `paper_id`, drop rows whose `group_id` ≠ current group, then refetch/merge. Deletes of comments are soft (UPDATE), so threads stay consistent.

## 5. Signature feature: citation intelligence pipeline

Runs after import (Next `after()`), status shown in UI; all steps degrade gracefully.
1. **Extract** text per page with pdfjs-dist (Node), keeping item positions.
2. **In-text citations, best source first:**
   a. PDF link annotations pointing at bibliography destinations (arXiv/LaTeX hyperref papers have these, e.g. `cite.madry2018`), giving exact marker positions.
   b. Fallback regex for numeric `[12]`, `[3, 7–9]` and author-year `(Goodfellow et al., 2015)` markers.
3. **Bibliography:** locate References section, split entries (numbered or hanging-indent heuristics), parse title/authors/year.
4. **Resolve:** for arXiv papers, pull the reference list from Semantic Scholar (`/paper/arXiv:{id}/references`) and match entries by normalized title similarity; otherwise OpenAlex title search. Accept only above a similarity threshold + year check; else `unresolved` (show raw entry + Google Scholar/arXiv search link). **Never fabricate a match.**
5. **Context:** sentence + paragraph around each marker → `citation_contexts`.
6. **On click** (lazy, to respect free-tier quotas): `summarizeWork(cited)` (cached per work) then `explainCitation(citingPaper, citedWork, contexts)` (cached per pair+contexts). Separate interfaces. Output fields: `referencedPaper, summary, keyContribution, citationPurpose, relationshipToCurrentPaper, supportingEvidence[] (quoted context), grounding, sourceLinks`. Prompt only includes source text; `grounding` reflects what was actually available (cited works are almost always `abstract_only`).
7. Mock provider builds outputs from real inputs (quotes the actual context sentence, abstract first sentence), clearly badged "Mock AI" in UI.

## 6. Workstreams and ownership

| Workstream | Who | Owns |
|---|---|---|
| A. Architect / contracts | **Me (lead)** | `docs/architecture.md`, `docs/api-contracts.md`, `src/contracts/**`, `supabase/migrations/0001_init.sql` |
| B. Backend / Supabase | Worker agent | `supabase/**` (later migrations, seed), `src/server/{db,groups,papers,annotations,reviews,dashboard,storage}/**`, `src/app/api/**` (except citations) |
| C. Frontend / product | Worker agent | `src/app/(auth|app)/**`, `src/components/**`, `src/lib/client/**` (starts on a mock API client) |
| D. ML / citations | Worker agent | `src/server/{citations,ai}/**`, `src/app/api/papers/[pid]/{citations,process}/**`, `fixtures/papers/**` |
| E. QA / demo | Worker agent | `tests/**`, `scripts/seed-demo.ts`, `docs/demo.md` |
| Review | Cheap reviewer per PR (Devin Review + a Lite review session for logic mismatch vs contracts) | read-only |

Contract changes go through me only. Each workstream = its own branch + PR into `main`; I review every diff and merge.

## 7. Phases

| Phase | Output | Gate |
|---|---|---|
| 0 Audit | Repo is empty → greenfield; VM toolchain ready | done |
| 1 Contracts + scaffold (me) | Next.js skeleton, Tailwind, local Supabase config, migration 0001 + RLS, zod contracts, provider interfaces, `.env.example`, README setup, CI (typecheck/lint/test) | **You approve** contracts PR |
| 2 Parallel build | B, C, D, E in parallel against contracts | each PR: green CI + review pass + my review |
| 3 Continuous integration | merge as ready; wire frontend to real API; one full journey working early | E2E smoke green |
| 4 Validation | 2-user Playwright flow: signup → group → join → import arXiv → highlight+comment → other user sees it live → reply → click citation → explanation → review → dashboard | all P0 green |
| 5 Demo | seed script (2 users, "Robustness Lab" group, Madry et al. 2017 arXiv:1706.06083 + 1–2 related papers), 3-min demo script, known limitations | recorded walkthrough |

Priority: P0 (auth, groups, import/upload, reader, shared annotations/comments, persistence, basic citation previews) → P1 (AI explanations, reviews, realtime, dashboard, caching) → P2 only if time remains.

## 8. Risks and mitigations
- **Annotation anchoring:** store page index + normalized rects (zoom-independent) + text-quote selector (exact/prefix/suffix) → re-anchor by quote if rects drift.
- **Bibliography parsing is messy:** link-annotation path + Semantic Scholar reference list covers most arXiv papers; heuristic fallback; unresolved shown honestly. (Optional upgrade: GROBID in Docker, free, if heuristics underperform.)
- **External API rate limits:** cache `external_works`, throttle, fixtures for tests/offline.
- **Free-tier AI quotas:** lazy generation + cache; mock default.
- **Serverless time limits on processing:** pipeline is idempotent and resumable; status visible; re-run endpoint.

## 9. Decisions needed from you
1. Deadline / demo time (drives how much P1/P2 we take on).
2. Parallelism: (a) parallel child sessions per workstream B–E (fastest, more ACUs) or (b) one worker in sequence (cheaper, slower). I recommend (a) for B, C, D, with E in the worker in this session.
3. Anything to cut or add in scope above.
