# Research Commons — API Contracts (source of truth)

Types and zod schemas live in `src/contracts/**`; this file is the index. All bodies JSON unless noted. Auth: Supabase session cookie; every route requires a signed-in user (401 `unauthenticated` otherwise). Non-members get 404 `not_found` (not 403) so resource existence isn't leaked. Validation errors: 422 `validation_failed` with zod issues in `details`.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/me` | — | `MeResponse` | |
| GET | `/api/groups` | — | `ListGroupsResponse` | |
| POST | `/api/groups` | `CreateGroupRequest` | 201 `CreateGroupResponse` | RPC `create_group` |
| POST | `/api/groups/join` | `JoinGroupRequest` | `JoinGroupResponse` | 404 invalid code; idempotent |
| GET | `/api/groups/:gid` | — | `GetGroupResponse` | |
| GET | `/api/groups/:gid/papers` | query `ListLibraryQuery` | `ListLibraryResponse` | ILIKE on title/authors/abstract |
| POST | `/api/groups/:gid/papers/arxiv` | `ImportArxivRequest` | 201 `ImportPaperResponse` | dedupe by arxivId; 409 if already in this group; starts pipeline |
| POST | `/api/groups/:gid/papers/upload` | multipart `file` + `metadata` (`UploadPaperMetadata` JSON) | 201 `ImportPaperResponse` | PDF magic bytes checked; ≤ 20 MiB; dedupe by sha256 |
| PATCH | `/api/groups/:gid/papers/:pid` | `UpdateLibraryPaperRequest` | `{ paper: LibraryPaper }` | tags |
| DELETE | `/api/groups/:gid/papers/:pid` | — | 204 | owner or adder; unlinks only |
| GET | `/api/papers/:pid?groupId=` | — | `GetPaperResponse` | signed PDF URL, 10 min |
| GET | `/api/groups/:gid/papers/:pid/annotations` | — | `ListAnnotationsResponse` | own private + group |
| POST | `/api/groups/:gid/papers/:pid/annotations` | `CreateAnnotationRequest` | 201 `AnnotationResponse` | anchor.pageIndex must equal page_index; optional first comment |
| PATCH | `/api/annotations/:aid` | `UpdateAnnotationRequest` | `AnnotationResponse` | author only |
| DELETE | `/api/annotations/:aid` | — | 204 | author only, cascades comments |
| POST | `/api/annotations/:aid/comments` | `CreateCommentRequest` | 201 `CommentResponse` | one reply level |
| PATCH | `/api/comments/:cid` | `UpdateCommentRequest` | `CommentResponse` | author only |
| DELETE | `/api/comments/:cid` | — | 204 | soft delete |
| GET | `/api/groups/:gid/papers/:pid/reviews` | — | `ListReviewsResponse` | |
| PUT | `/api/groups/:gid/papers/:pid/reviews/mine` | `ReviewInput` | `ReviewResponse` | upsert |
| DELETE | `/api/groups/:gid/papers/:pid/reviews/mine` | — | 204 | |
| GET | `/api/papers/:pid/citations` | — | `GetCitationsResponse` | requires `can_read_paper` |
| POST | `/api/papers/:pid/process` | — | 202 `ProcessPaperResponse` | idempotent re-run; 409 if processing |
| POST | `/api/papers/:pid/citations/:refId/explain` | `ExplainCitationRequest` | `ExplainCitationResponse` | cached-or-generate; `unavailable` when unresolved/no context |
| POST | `/api/papers/:pid/summary` | `PaperSummaryRequest` | `PaperSummaryResponse` | full-text grounded when available |
| GET | `/api/groups/:gid/dashboard` | — | `DashboardResponse` | |

Realtime contract: `src/contracts/realtime.ts`. Server interfaces for AI: `LLMProvider`, `WorkInput`, `CitationInput` in `src/contracts/ai.ts`.

Change process: propose to lead → lead edits contracts + this table in one commit → affected tracks rebase.
