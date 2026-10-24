# Research Commons — Architecture (source of truth)

Owner: lead/orchestrator. Changes only via the lead. Companion: `docs/api-contracts.md`, `src/contracts/**`, `supabase/migrations/*_init.sql`.

## 1. Shape
Single Next.js 15 App Router app (TypeScript strict), modular monolith.

```
src/
  contracts/        zod schemas + TS types shared by client, server, ML (lead-owned)
  app/api/**        thin route handlers: auth -> zod parse -> service -> zod-shaped JSON
  app/(auth)/**     login / signup
  app/(app)/**      dashboard, library, reader
  components/**     UI
  lib/client/**     browser supabase client, typed API client (fetch wrappers over contracts)
  server/
    supabase/       createUserClient (RLS) / createAdminClient (service role, server-only)
    http/           route helpers: requireUser, parseBody, jsonError (ApiError shape)
    groups|papers|annotations|reviews|dashboard|storage/   services
    citations/      extraction, bibliography, resolution, contexts, pipeline
    ai/             providers (mock|gemini|ollama), summarizeWork, explainCitation, cache
supabase/           config.toml, migrations/, seed.sql
tests/              unit (vitest), rls (vitest vs local supabase), e2e (playwright)
```

## 2. Data access rules
1. Browser uses supabase-js only for auth session and Realtime. All data reads/writes go through `/api/**`.
2. Route handlers use `createUserClient()` so RLS applies. `createAdminClient()` is allowed only in: storage (upload/sign), canonical paper upsert + `group_papers` link, citation pipeline writes, AI cache writes. Each admin call must be preceded by an authorization check using the user client (`is_group_member` / `can_read_paper`).
3. Responses are camelCase API shapes from `src/contracts`; DB rows are snake_case and never returned raw.
4. Errors: `{ error: { code, message, details? } }` with status from `HTTP_STATUS`.

## 3. Data model
See migration for exact DDL. Key identity rules:
- `papers` is canonical and shared: dedupe by `arxiv_id` (normalized, no version) or `pdf_sha256`.
- `group_papers` puts a paper into a group library. Annotations, comments, and reviews reference `(group_id, paper_id)` via a composite FK, so they always belong to one group's copy.
- Citation intelligence (`paper_references`, `citation_contexts`, `ai_summaries`) is per canonical paper and readable by anyone who can read the paper. `external_works` is shared metadata.
- Comments: one level of threading; `group_id/paper_id` denormalized by trigger; soft delete (body cleared).
- Immutable on update (enforced by triggers): annotation anchor/quote/page/group/paper/author; comment parent/annotation/author; review group/paper/author; group_paper ids/added_by.

## 4. Authorization (RLS)
Helpers (SECURITY DEFINER, `search_path=''`): `is_group_member`, `is_group_owner`, `can_read_paper`, `can_read_annotation`, `shares_group_with`.
- Groups: create via `create_group()` RPC, join via `join_group(invite_code)` RPC. Members read; owner updates/deletes.
- Annotations: visible if member AND (`visibility='group'` OR author is me). Comments inherit annotation visibility.
- Server-only writes: papers, group_papers insert, references, contexts, external_works, ai_summaries.
- Storage: private bucket `papers`, object key `papers/{paperId}.pdf`; no client storage policies; server returns signed URLs (10 min).
- `anon` has no table access.

## 5. PDF reader and annotation anchoring
- Rendering: `pdfjs-dist` canvas + text layer per page, virtualized (render visible ±2 pages).
- **Page text string** = `textContent.items.map(i => i.str).join("")` for that page (exactly this, no separators). All selector offsets refer to this string, both in the browser and in the server extraction pipeline.
- On selection: compute `AnnotationAnchor` = `{version:1, pageIndex, rects (client rects -> normalized to page viewport at scale 1, merged per line), quote:{exact,prefix(32),suffix(32)}, position:{start,end}}`. Multi-page selections are clipped to the first page in MVP.
- Re-anchoring on load: draw `rects` (scale by current viewport). If page text at `position` ≠ `quote.exact`, search the page text for `exact` (disambiguate with prefix/suffix) and recompute rects from text-layer spans; if not found, show as "orphaned" in side panel.

## 6. UI design
- Reading-first: the PDF is the centre stage. Left rail: group switcher + library (Zotero-like list, collapsible). Right: a collapsible side panel (tabs: Discussion, AI, Reviews).
- Annotations render as translucent highlights plus a **margin badge** (dot with comment count, author colour) next to the line. Clicking a badge opens a popover thread anchored on the page; "Open in panel" pins it to the side panel. A user setting chooses popover vs panel as the default.
- Citation markers detected by the pipeline become clickable hotspots. Clicking opens a small preview card (title, authors, year, status); "Explain" opens the **AI tab in the side panel** in a ChatGPT-style card stream, with a clear "AI" / "Mock AI" badge, grounding label, quoted evidence, and source links. Human content and AI content are visually distinct.
- Realtime: new annotations/comments from others appear live with a subtle pulse.

## 7. Citation intelligence pipeline (`src/server/citations`)
Triggered after import with Next `after()`; idempotent (deletes and rewrites references/contexts for the paper); status in `papers.processing_status`.
1. Extract per-page text items with positions (pdfjs-dist, Node legacy build). Fixtures: `fixtures/papers/<arxivId>/`.
2. In-text markers: (a) PDF link annotations whose destination falls in the bibliography (`cite.*` named dests from hyperref); (b) regex fallback for numeric and author-year markers.
3. Bibliography: locate References/Bibliography heading; split entries; parse title/authors/year.
4. Resolve: arXiv papers → Semantic Scholar `/graph/v1/paper/arXiv:{id}/references` list, match by normalized-title similarity (≥ 0.85, year ±1 if known); else OpenAlex title search with the same thresholds. Below threshold → `unresolved`; multiple close candidates → `ambiguous`. Never fabricate.
5. Contexts: sentence + paragraph around each marker, with marker rects.
6. AI is lazy (on click) and cached; see §8.

## 8. AI layer (`src/server/ai`)
- `LLMProvider` (contracts/ai.ts) with `mock` (default), `gemini`, `ollama`. Selected by `AI_PROVIDER`.
- `summarizeWork(work)` and `explainCitation(input)` are separate services with separate prompts and cache entries.
- Cache key = sha256(kind | subject ids | sha256(inputs) | promptVersion | provider | model). Mock outputs are cached with `is_mock=true` and never served when a real provider is configured.
- Grounding: cited works are `abstract_only` (or `metadata_only` without abstract); the paper being read may be `full_text`. Prompts contain only provided source text; outputs are zod-validated before persistence; supporting evidence must be verbatim quotes from inputs (validated by substring check; mismatches dropped, and if none remain the call fails).
- Mock provider: deterministic, built from real inputs (quotes the actual context sentence, first sentence of the abstract), labelled Mock AI.

## 9. Realtime
See `src/contracts/realtime.ts`. postgres_changes on annotations, comments, paper_reviews filtered by `paper_id`; client drops other groups' rows and refetches via API.

## 10. Ownership (Phase 2)
| Track | Owns |
|---|---|
| Lead | `docs/architecture.md`, `docs/api-contracts.md`, `src/contracts/**`, initial migration, integration, merges |
| Backend | `supabase/**` (new migrations, seed), `src/server/{http,supabase,groups,papers,annotations,reviews,dashboard,storage}/**`, `src/app/api/**` except citations/ai routes |
| Frontend | `src/app/(auth)/**`, `src/app/(app)/**`, `src/components/**`, `src/lib/client/**` |
| ML | `src/server/{citations,ai}/**`, `src/app/api/papers/[pid]/{citations,process,summary}/**`, `fixtures/papers/**` |
| QA | `tests/**`, `scripts/seed-demo.ts`, `docs/demo.md` |
Cross-track needs go to the lead; nobody edits another track's files.
