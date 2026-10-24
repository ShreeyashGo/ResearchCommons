import type { z } from "zod";
import {
  AnnotationResponse,
  AskPaperRequest,
  AskPaperResponse,
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
  type ApiError as ApiErrorBody,
  type ErrorCode,
} from "@/contracts";

/**
 * Client-side API surface for the whole app. The default export dispatches to
 * the real HTTP implementation, or to the in-memory mock when
 * NEXT_PUBLIC_API_MOCK=1 is set at build/dev time.
 */
export const API_MOCK = process.env.NEXT_PUBLIC_API_MOCK === "1";

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.status = status;
    this.code = body?.error.code ?? "internal";
    this.details = body?.error.details;
  }
}

export type { ApiErrorBody, LibraryPaper };

export interface Api {
  me(): Promise<z.infer<typeof MeResponse>>;
  listGroups(): Promise<z.infer<typeof ListGroupsResponse>>;
  createGroup(req: z.input<typeof CreateGroupRequest>): Promise<z.infer<typeof CreateGroupResponse>>;
  joinGroup(req: z.input<typeof JoinGroupRequest>): Promise<z.infer<typeof JoinGroupResponse>>;
  getGroup(groupId: string): Promise<z.infer<typeof GetGroupResponse>>;

  listLibrary(groupId: string, query?: z.input<typeof ListLibraryQuery>): Promise<z.infer<typeof ListLibraryResponse>>;
  importArxiv(groupId: string, req: z.input<typeof ImportArxivRequest>): Promise<z.infer<typeof ImportPaperResponse>>;
  uploadPaper(
    groupId: string,
    file: File,
    metadata?: z.input<typeof UploadPaperMetadata>,
  ): Promise<z.infer<typeof ImportPaperResponse>>;
  updateLibraryPaper(groupId: string, paperId: string, tags: string[]): Promise<{ paper: z.infer<typeof LibraryPaper> }>;
  removeLibraryPaper(groupId: string, paperId: string): Promise<void>;
  getPaper(paperId: string, groupId: string): Promise<z.infer<typeof GetPaperResponse>>;

  listAnnotations(groupId: string, paperId: string): Promise<z.infer<typeof ListAnnotationsResponse>>;
  createAnnotation(
    groupId: string,
    paperId: string,
    req: z.input<typeof CreateAnnotationRequest>,
  ): Promise<z.infer<typeof AnnotationResponse>>;
  updateAnnotation(annotationId: string, req: z.input<typeof UpdateAnnotationRequest>): Promise<z.infer<typeof AnnotationResponse>>;
  deleteAnnotation(annotationId: string): Promise<void>;

  createComment(annotationId: string, req: z.input<typeof CreateCommentRequest>): Promise<z.infer<typeof CommentResponse>>;
  updateComment(commentId: string, req: z.input<typeof UpdateCommentRequest>): Promise<z.infer<typeof CommentResponse>>;
  deleteComment(commentId: string): Promise<void>;

  listReviews(groupId: string, paperId: string): Promise<z.infer<typeof ListReviewsResponse>>;
  putMyReview(groupId: string, paperId: string, req: z.input<typeof ReviewInput>): Promise<z.infer<typeof ReviewResponse>>;
  deleteMyReview(groupId: string, paperId: string): Promise<void>;

  getCitations(paperId: string): Promise<z.infer<typeof GetCitationsResponse>>;
  processPaper(paperId: string): Promise<z.infer<typeof ProcessPaperResponse>>;
  explainCitation(
    paperId: string,
    referenceId: string,
    req: z.input<typeof ExplainCitationRequest>,
  ): Promise<z.infer<typeof ExplainCitationResponse>>;
  paperSummary(paperId: string, req: z.input<typeof PaperSummaryRequest>): Promise<z.infer<typeof PaperSummaryResponse>>;
  askPaper(paperId: string, req: z.input<typeof AskPaperRequest>): Promise<z.infer<typeof AskPaperResponse>>;

  dashboard(groupId: string): Promise<z.infer<typeof DashboardResponse>>;
}

export type ApiInterface = Api;

async function loadImpl(): Promise<Api> {
  if (API_MOCK) {
    const { mockApi } = await import("./mock");
    return mockApi;
  }
  const { httpApi } = await import("./api-http");
  return httpApi;
}

/**
 * Lazily resolved implementation so the mock module (and its generated PDF
 * fixtures) is only bundled into the client graph when needed. Methods are
 * stable: a single resolved delegate per session.
 */
let implPromise: Promise<Api> | undefined;
function impl(): Promise<Api> {
  implPromise ??= loadImpl();
  return implPromise;
}

function forward<K extends keyof Api>(name: K): Api[K] {
  return ((...args: unknown[]) =>
    impl().then((i) => (i[name] as (...a: unknown[]) => unknown)(...args))) as Api[K];
}

export const api: Api = {
  me: forward("me"),
  listGroups: forward("listGroups"),
  createGroup: forward("createGroup"),
  joinGroup: forward("joinGroup"),
  getGroup: forward("getGroup"),
  listLibrary: forward("listLibrary"),
  importArxiv: forward("importArxiv"),
  uploadPaper: forward("uploadPaper"),
  updateLibraryPaper: forward("updateLibraryPaper"),
  removeLibraryPaper: forward("removeLibraryPaper"),
  getPaper: forward("getPaper"),
  listAnnotations: forward("listAnnotations"),
  createAnnotation: forward("createAnnotation"),
  updateAnnotation: forward("updateAnnotation"),
  deleteAnnotation: forward("deleteAnnotation"),
  createComment: forward("createComment"),
  updateComment: forward("updateComment"),
  deleteComment: forward("deleteComment"),
  listReviews: forward("listReviews"),
  putMyReview: forward("putMyReview"),
  deleteMyReview: forward("deleteMyReview"),
  getCitations: forward("getCitations"),
  processPaper: forward("processPaper"),
  explainCitation: forward("explainCitation"),
  paperSummary: forward("paperSummary"),
  askPaper: forward("askPaper"),
  dashboard: forward("dashboard"),
};
