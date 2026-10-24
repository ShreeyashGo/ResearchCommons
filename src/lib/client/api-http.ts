import { z } from "zod";
import {
  AnnotationResponse,
  ApiError,
  CommentResponse,
  CreateAnnotationRequest,
  CreateCommentRequest,
  CreateGroupRequest,
  CreateGroupResponse,
  DashboardResponse,
  ExplainCitationRequest,
  ExplainCitationResponse,
  GetCitationsResponse,
  GetGroupResponse,
  GetPaperResponse,
  ImportArxivRequest,
  ImportPaperResponse,
  JoinGroupRequest,
  JoinGroupResponse,
  LibraryPaper,
  ListAnnotationsResponse,
  ListGroupsResponse,
  ListLibraryQuery,
  ListLibraryResponse,
  ListReviewsResponse,
  MeResponse,
  PaperSummaryRequest,
  PaperSummaryResponse,
  ProcessPaperResponse,
  ReviewInput,
  ReviewResponse,
  UpdateAnnotationRequest,
  UpdateCommentRequest,
  UploadPaperMetadata,
} from "@/contracts";
import { ApiClientError, type Api } from "./api";

async function request<T>(
  method: string,
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });

  const text = await res.text();
  const json: unknown = text.length > 0 ? safeJson(text) : undefined;

  if (!res.ok) {
    const parsed = ApiError.safeParse(json);
    throw new ApiClientError(res.status, parsed.success ? parsed.data : null, res.statusText);
  }
  const out = schema.safeParse(json);
  if (!out.success) {
    throw new ApiClientError(res.status, null, "Malformed API response");
  }
  return out.data;
}

async function requestEmpty(method: string, path: string): Promise<void> {
  const res = await fetch(path, { method, credentials: "same-origin" });
  if (!res.ok) {
    const text = await res.text();
    const parsed = ApiError.safeParse(safeJson(text));
    throw new ApiClientError(res.status, parsed.success ? parsed.data : null, res.statusText);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function qs(query?: z.input<typeof ListLibraryQuery>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export const httpApi: Api = {
  me: () => request("GET", "/api/me", MeResponse),

  listGroups: () => request("GET", "/api/groups", ListGroupsResponse),
  createGroup: (req: z.input<typeof CreateGroupRequest>) =>
    request("POST", "/api/groups", CreateGroupResponse, CreateGroupRequest.parse(req)),
  joinGroup: (req: z.input<typeof JoinGroupRequest>) =>
    request("POST", "/api/groups/join", JoinGroupResponse, JoinGroupRequest.parse(req)),
  getGroup: (groupId) => request("GET", `/api/groups/${groupId}`, GetGroupResponse),

  listLibrary: (groupId, query) =>
    request("GET", `/api/groups/${groupId}/papers${qs(query)}`, ListLibraryResponse),
  importArxiv: (groupId, req: z.input<typeof ImportArxivRequest>) =>
    request("POST", `/api/groups/${groupId}/papers/arxiv`, ImportPaperResponse, ImportArxivRequest.parse(req)),
  uploadPaper: async (groupId, file, metadata?: z.input<typeof UploadPaperMetadata>) => {
    const form = new FormData();
    form.set("file", file);
    if (metadata) form.set("metadata", JSON.stringify(UploadPaperMetadata.parse(metadata)));
    const res = await fetch(`/api/groups/${groupId}/papers/upload`, {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
    const json: unknown = safeJson(await res.text());
    if (!res.ok) {
      const parsed = ApiError.safeParse(json);
      throw new ApiClientError(res.status, parsed.success ? parsed.data : null, res.statusText);
    }
    return ImportPaperResponse.parse(json);
  },
  updateLibraryPaper: (groupId, paperId, tags) =>
    request("PATCH", `/api/groups/${groupId}/papers/${paperId}`, z.object({ paper: LibraryPaper }), { tags }),
  removeLibraryPaper: (groupId, paperId) =>
    requestEmpty("DELETE", `/api/groups/${groupId}/papers/${paperId}`),
  getPaper: (paperId, groupId) =>
    request("GET", `/api/papers/${paperId}?groupId=${encodeURIComponent(groupId)}`, GetPaperResponse),

  listAnnotations: (groupId, paperId) =>
    request("GET", `/api/groups/${groupId}/papers/${paperId}/annotations`, ListAnnotationsResponse),
  createAnnotation: (groupId, paperId, req: z.input<typeof CreateAnnotationRequest>) =>
    request("POST", `/api/groups/${groupId}/papers/${paperId}/annotations`, AnnotationResponse, CreateAnnotationRequest.parse(req)),
  updateAnnotation: (annotationId, req: z.input<typeof UpdateAnnotationRequest>) =>
    request("PATCH", `/api/annotations/${annotationId}`, AnnotationResponse, UpdateAnnotationRequest.parse(req)),
  deleteAnnotation: (annotationId) => requestEmpty("DELETE", `/api/annotations/${annotationId}`),

  createComment: (annotationId, req: z.input<typeof CreateCommentRequest>) =>
    request("POST", `/api/annotations/${annotationId}/comments`, CommentResponse, CreateCommentRequest.parse(req)),
  updateComment: (commentId, req: z.input<typeof UpdateCommentRequest>) =>
    request("PATCH", `/api/comments/${commentId}`, CommentResponse, UpdateCommentRequest.parse(req)),
  deleteComment: (commentId) => requestEmpty("DELETE", `/api/comments/${commentId}`),

  listReviews: (groupId, paperId) =>
    request("GET", `/api/groups/${groupId}/papers/${paperId}/reviews`, ListReviewsResponse),
  putMyReview: (groupId, paperId, req: z.input<typeof ReviewInput>) =>
    request("PUT", `/api/groups/${groupId}/papers/${paperId}/reviews/mine`, ReviewResponse, ReviewInput.parse(req)),
  deleteMyReview: (groupId, paperId) =>
    requestEmpty("DELETE", `/api/groups/${groupId}/papers/${paperId}/reviews/mine`),

  getCitations: (paperId) => request("GET", `/api/papers/${paperId}/citations`, GetCitationsResponse),
  processPaper: (paperId) => request("POST", `/api/papers/${paperId}/process`, ProcessPaperResponse),
  explainCitation: (paperId, referenceId, req: z.input<typeof ExplainCitationRequest>) =>
    request("POST", `/api/papers/${paperId}/citations/${referenceId}/explain`, ExplainCitationResponse, ExplainCitationRequest.parse(req)),
  paperSummary: (paperId, req: z.input<typeof PaperSummaryRequest>) =>
    request("POST", `/api/papers/${paperId}/summary`, PaperSummaryResponse, PaperSummaryRequest.parse(req)),

  dashboard: (groupId) => request("GET", `/api/groups/${groupId}/dashboard`, DashboardResponse),
};
