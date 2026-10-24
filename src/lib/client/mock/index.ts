import type { z } from "zod";
import type {
  Annotation,
  AnnotationAnchor,
  Comment,
  CreateAnnotationRequest,
  CreateCommentRequest,
  CreateGroupRequest,
  ImportArxivRequest,
  JoinGroupRequest,
  LibraryPaper,
  Reference,
  UpdateAnnotationRequest,
  UpdateCommentRequest,
  UploadPaperMetadata,
} from "@/contracts";
import { ReviewInput } from "@/contracts";
import { ApiClientError, type Api } from "../api";
import {
  dashboardFixture,
  initialState,
  MOCK_USER,
  mockPdfUrl,
  P1,
  PAPER1_SPEC,
  PAPER2_SPEC,
  uid,
  type MockState,
} from "./data";

const LATENCY = 140;
const sleep = (ms = LATENCY) => new Promise((r) => setTimeout(r, ms));

/**
 * Mock change bus — lets the realtime layer simulate postgres_changes without
 * a Supabase connection. Any mutation emits `paper-changed` with the affected
 * group/paper; subscribers refetch.
 */
const listeners = new Set<(e: { groupId: string; paperId: string; table: string }) => void>();
export function emitMockChange(groupId: string, paperId: string, table: string) {
  for (const l of listeners) l({ groupId, paperId, table });
}
export function onMockChange(l: (e: { groupId: string; paperId: string; table: string }) => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const mockLibraryListeners = new Set<(groupId: string) => void>();
export function emitLibraryChange(groupId: string) {
  for (const l of mockLibraryListeners) l(groupId);
}

let state: MockState | undefined;
function store(): MockState {
  state ??= initialState();
  return state;
}

function key(groupId: string, paperId: string) {
  return `${groupId}:${paperId}`;
}

function requirePaper(groupId: string, paperId: string): LibraryPaper {
  const p = store().papers.get(key(groupId, paperId));
  if (!p) throw new ApiClientError(404, { error: { code: "not_found", message: "Paper not found" } }, "not found");
  return p;
}

function groupOr404(groupId: string) {
  const g = store().groups.find((x) => x.id === groupId);
  if (!g) throw new ApiClientError(404, { error: { code: "not_found", message: "Group not found" } }, "not found");
  return g;
}

function findAnnotation(annotationId: string): Annotation | undefined {
  for (const list of store().annotations.values()) {
    const a = list.find((x) => x.id === annotationId);
    if (a) return a;
  }
  return undefined;
}

function findComment(commentId: string): Comment | undefined {
  for (const list of store().annotations.values()) {
    for (const a of list) {
      for (const c of a.comments) {
        if (c.id === commentId) return c;
        const r = c.replies.find((x) => x.id === commentId);
        if (r) return r;
      }
    }
  }
  return undefined;
}

export const mockApi: Api = {
  async me() {
    await sleep(60);
    const s = store();
    return { profile: s.profile, groups: s.groups };
  },

  async listGroups() {
    await sleep(80);
    return { groups: store().groups };
  },

  async createGroup(req: z.input<typeof CreateGroupRequest>) {
    await sleep();
    const s = store();
    const group = {
      id: uid(),
      name: req.name,
      description: req.description ?? "",
      inviteCode: Math.random().toString(16).slice(2, 8),
      myRole: "owner" as const,
      memberCount: 1,
      paperCount: 0,
      createdAt: new Date().toISOString(),
    };
    s.groups.push(group);
    s.groupDetails.set(group.id, {
      ...group,
      members: [{ ...MOCK_USER, role: "owner", joinedAt: group.createdAt }],
    });
    return { group };
  },

  async joinGroup(req: z.input<typeof JoinGroupRequest>) {
    await sleep();
    const s = store();
    const group = s.groups.find((g) => g.inviteCode === req.inviteCode.toLowerCase());
    if (!group) {
      throw new ApiClientError(404, { error: { code: "not_found", message: "Invalid invite code" } }, "not found");
    }
    group.memberCount += 1;
    return { group };
  },

  async getGroup(groupId) {
    await sleep();
    const g = store().groupDetails.get(groupId);
    if (!g) throw new ApiClientError(404, { error: { code: "not_found", message: "Group not found" } }, "not found");
    return { group: g };
  },

  async listLibrary(groupId, query) {
    await sleep();
    let list = [...store().papers.values()].filter((p) => p.groupId === groupId);
    const q = query?.q?.toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.authors.some((a) => a.toLowerCase().includes(q)) ||
          (p.abstract ?? "").toLowerCase().includes(q),
      );
    }
    if (query?.tag) list = list.filter((p) => p.tags.includes(query.tag!));
    list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    return { papers: list };
  },

  async importArxiv(groupId, req: z.input<typeof ImportArxivRequest>) {
    await sleep(300);
    const s = store();
    groupOr404(groupId);
    const m = req.url.match(/(\d{4}\.\d{4,5})/);
    const arxivId = m ? m[1] : req.url.replace(/[^0-9.]/g, "");
    const existing = [...s.papers.values()].find((p) => p.arxivId === arxivId && p.groupId === groupId);
    if (existing) {
      throw new ApiClientError(409, { error: { code: "conflict", message: "Paper already in this group" } }, "conflict");
    }
    const paper: LibraryPaper = {
      id: uid(),
      groupId,
      source: "arxiv",
      title: `arXiv ${arxivId} — fetching metadata…`,
      authors: [],
      abstract: null,
      year: null,
      doi: null,
      arxivId,
      pageCount: null,
      processingStatus: "pending",
      processingError: null,
      createdAt: new Date().toISOString(),
      tags: req.tags ?? [],
      addedBy: MOCK_USER,
      addedAt: new Date().toISOString(),
      annotationCount: 0,
      reviewCount: 0,
    };
    s.papers.set(key(groupId, paper.id), paper);
    s.annotations.set(key(groupId, paper.id), []);
    s.reviews.set(key(groupId, paper.id), []);
    emitLibraryChange(groupId);

    // Simulate the pipeline: pending -> processing -> ready with metadata filled in.
    setTimeout(() => {
      paper.processingStatus = "processing";
      emitLibraryChange(groupId);
    }, 1500);
    setTimeout(() => {
      paper.title = `Imported arXiv ${arxivId}: Synthetic Long-Context Benchmarks`;
      paper.authors = ["M. Okafor", "L. Brandt"];
      paper.year = 2024;
      paper.abstract = "Metadata resolved via the arXiv API (mock).";
      paper.processingStatus = "ready";
      paper.pageCount = PAPER1_SPEC.pages.length;
      emitLibraryChange(groupId);
    }, 4000);

    return { paper, deduplicated: false };
  },

  async uploadPaper(groupId, file, metadata?: z.input<typeof UploadPaperMetadata>) {
    await sleep(400);
    const s = store();
    groupOr404(groupId);
    const paper: LibraryPaper = {
      id: uid(),
      groupId,
      source: "upload",
      title: metadata?.title ?? file.name.replace(/\.pdf$/i, ""),
      authors: metadata?.authors ?? [],
      abstract: null,
      year: metadata?.year ?? null,
      doi: metadata?.doi ?? null,
      arxivId: null,
      pageCount: PAPER2_SPEC.pages.length,
      processingStatus: "ready",
      processingError: null,
      createdAt: new Date().toISOString(),
      tags: metadata?.tags ?? [],
      addedBy: MOCK_USER,
      addedAt: new Date().toISOString(),
      annotationCount: 0,
      reviewCount: 0,
    };
    s.papers.set(key(groupId, paper.id), paper);
    s.annotations.set(key(groupId, paper.id), []);
    s.reviews.set(key(groupId, paper.id), []);
    emitLibraryChange(groupId);
    return { paper, deduplicated: false };
  },

  async updateLibraryPaper(groupId, paperId, tags) {
    await sleep();
    const p = requirePaper(groupId, paperId);
    p.tags = tags;
    emitLibraryChange(groupId);
    return { paper: p };
  },

  async removeLibraryPaper(groupId, paperId) {
    await sleep();
    requirePaper(groupId, paperId);
    store().papers.delete(key(groupId, paperId));
    emitLibraryChange(groupId);
  },

  async getPaper(paperId, groupId) {
    await sleep();
    const p = requirePaper(groupId, paperId);
    const hasPdf = p.processingStatus !== "pending";
    return {
      paper: p,
      pdfUrl: hasPdf ? mockPdfUrl(paperId) : null,
      pdfUrlExpiresAt: hasPdf ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
    };
  },

  async listAnnotations(groupId, paperId) {
    await sleep();
    requirePaper(groupId, paperId);
    return { annotations: store().annotations.get(key(groupId, paperId)) ?? [] };
  },

  async createAnnotation(groupId, paperId, req: z.input<typeof CreateAnnotationRequest>) {
    await sleep();
    requirePaper(groupId, paperId);
    const s = store();
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: uid(),
      groupId,
      paperId,
      author: MOCK_USER,
      visibility: req.visibility ?? "group",
      color: req.color ?? "yellow",
      anchor: req.anchor as AnnotationAnchor,
      comments: req.comment
        ? [
            {
              id: uid(),
              annotationId: "",
              parentId: null,
              author: MOCK_USER,
              body: req.comment,
              deleted: false,
              createdAt: now,
              updatedAt: now,
              replies: [],
            },
          ]
        : [],
      createdAt: now,
      updatedAt: now,
    };
    if (annotation.comments[0]) annotation.comments[0].annotationId = annotation.id;
    s.annotations.get(key(groupId, paperId))!.push(annotation);
    const p = s.papers.get(key(groupId, paperId))!;
    p.annotationCount += 1;
    emitMockChange(groupId, paperId, "annotations");
    return { annotation };
  },

  async updateAnnotation(annotationId, req: z.input<typeof UpdateAnnotationRequest>) {
    await sleep();
    const a = findAnnotation(annotationId);
    if (!a) throw new ApiClientError(404, { error: { code: "not_found", message: "Annotation not found" } }, "not found");
    if (req.visibility) a.visibility = req.visibility;
    if (req.color) a.color = req.color;
    a.updatedAt = new Date().toISOString();
    emitMockChange(a.groupId, a.paperId, "annotations");
    return { annotation: a };
  },

  async deleteAnnotation(annotationId) {
    await sleep();
    const s = store();
    for (const [k, list] of s.annotations) {
      const i = list.findIndex((x) => x.id === annotationId);
      if (i >= 0) {
        const [a] = list.splice(i, 1);
        const p = s.papers.get(k);
        if (p) p.annotationCount = Math.max(0, p.annotationCount - 1);
        emitMockChange(a.groupId, a.paperId, "annotations");
        return;
      }
    }
    throw new ApiClientError(404, { error: { code: "not_found", message: "Annotation not found" } }, "not found");
  },

  async createComment(annotationId, req: z.input<typeof CreateCommentRequest>) {
    await sleep();
    const a = findAnnotation(annotationId);
    if (!a) throw new ApiClientError(404, { error: { code: "not_found", message: "Annotation not found" } }, "not found");
    const now = new Date().toISOString();
    const comment: Comment = {
      id: uid(),
      annotationId,
      parentId: req.parentId ?? null,
      author: MOCK_USER,
      body: req.body,
      deleted: false,
      createdAt: now,
      updatedAt: now,
    };
    if (req.parentId) {
      const parent = a.comments.find((c) => c.id === req.parentId);
      parent?.replies.push(comment);
    } else {
      a.comments.push({ ...comment, replies: [] });
    }
    a.updatedAt = now;
    emitMockChange(a.groupId, a.paperId, "comments");
    return { comment };
  },

  async updateComment(commentId, req: z.input<typeof UpdateCommentRequest>) {
    await sleep();
    const c = findComment(commentId);
    if (!c) throw new ApiClientError(404, { error: { code: "not_found", message: "Comment not found" } }, "not found");
    c.body = req.body;
    c.updatedAt = new Date().toISOString();
    const a = findAnnotation(c.annotationId);
    if (a) emitMockChange(a.groupId, a.paperId, "comments");
    return { comment: c };
  },

  async deleteComment(commentId) {
    await sleep();
    const c = findComment(commentId);
    if (!c) throw new ApiClientError(404, { error: { code: "not_found", message: "Comment not found" } }, "not found");
    c.body = "";
    c.deleted = true;
    const a = findAnnotation(c.annotationId);
    if (a) emitMockChange(a.groupId, a.paperId, "comments");
  },

  async listReviews(groupId, paperId) {
    await sleep();
    requirePaper(groupId, paperId);
    return { reviews: store().reviews.get(key(groupId, paperId)) ?? [] };
  },

  async putMyReview(groupId, paperId, req: z.input<typeof ReviewInput>) {
    await sleep();
    requirePaper(groupId, paperId);
    const s = store();
    const list = s.reviews.get(key(groupId, paperId))!;
    const existing = list.find((r) => r.author.id === MOCK_USER.id);
    const now = new Date().toISOString();
    const parsed = ReviewInput.parse(req);
    if (existing) {
      Object.assign(existing, parsed, { updatedAt: now });
      emitMockChange(groupId, paperId, "paper_reviews");
      return { review: existing };
    }
    const review = {
      ...parsed,
      id: uid(),
      groupId,
      paperId,
      author: MOCK_USER,
      createdAt: now,
      updatedAt: now,
    };
    list.push(review);
    const p = s.papers.get(key(groupId, paperId))!;
    p.reviewCount += 1;
    emitMockChange(groupId, paperId, "paper_reviews");
    return { review };
  },

  async deleteMyReview(groupId, paperId) {
    await sleep();
    const s = store();
    const list = s.reviews.get(key(groupId, paperId)) ?? [];
    const i = list.findIndex((r) => r.author.id === MOCK_USER.id);
    if (i >= 0) {
      list.splice(i, 1);
      const p = s.papers.get(key(groupId, paperId));
      if (p) p.reviewCount = Math.max(0, p.reviewCount - 1);
      emitMockChange(groupId, paperId, "paper_reviews");
    }
  },

  async getCitations(paperId) {
    await sleep();
    const s = store();
    const paper = [...s.papers.values()].find((p) => p.id === paperId);
    if (!paper) throw new ApiClientError(404, { error: { code: "not_found", message: "Paper not found" } }, "not found");
    if (paperId !== P1) {
      return { processingStatus: paper.processingStatus, processingError: paper.processingError, references: [], contexts: [] };
    }
    return {
      processingStatus: paper.processingStatus,
      processingError: paper.processingError,
      references: s.references,
      contexts: s.contexts,
    };
  },

  async processPaper(paperId) {
    await sleep();
    const s = store();
    const paper = [...s.papers.values()].find((p) => p.id === paperId);
    if (!paper) throw new ApiClientError(404, { error: { code: "not_found", message: "Paper not found" } }, "not found");
    paper.processingStatus = "processing";
    setTimeout(() => {
      paper.processingStatus = "ready";
      paper.pageCount = PAPER1_SPEC.pages.length;
      emitLibraryChange(paper.groupId);
    }, 3000);
    return { processingStatus: "processing" };
  },

  async explainCitation(paperId, referenceId) {
    await sleep(650);
    const s = store();
    const reference: Reference | undefined = s.references.find((r) => r.id === referenceId);
    if (!reference) throw new ApiClientError(404, { error: { code: "not_found", message: "Reference not found" } }, "not found");
    if (reference.matchStatus !== "resolved" || !reference.work) {
      return {
        status: "unavailable",
        reason:
          reference.matchStatus === "ambiguous"
            ? "Several candidate works matched this reference below the confidence threshold."
            : "This reference could not be resolved to an external work.",
      };
    }
    const ctxs = s.contexts.filter((c) => c.referenceId === referenceId);
    const cached = s.aiCache.get(`explain:${referenceId}`);
    if (cached) return cached as never;

    const work = reference.work;
    const firstSentence = work.abstract?.split(/(?<=[.!?])\s+/)[0] ?? work.title;
    const response = {
      status: "ok" as const,
      explanation: {
        referencedPaper: { title: work.title, authors: work.authors, year: work.year },
        summary: firstSentence,
        keyContribution: `${work.title} (${work.year ?? "n.d."}) is cited as ${ctxs.length > 1 ? `${ctxs.length} supporting reference points` : "a supporting reference"} in this paper.`,
        citationPurpose: "background" as const,
        citationPurposeExplanation:
          "The citing paper uses this reference to situate its own contribution within prior work.",
        relationshipToCurrentPaper: `This paper builds on the framing introduced by ${work.authors[0] ?? "the cited authors"} et al.: ${ctxs[0]?.sentence ?? ""}`,
        supportingEvidence: [
          { source: "citing_context" as const, quote: ctxs[0]?.sentence ?? reference.rawText },
          ...(work.abstract
            ? [{ source: "cited_abstract" as const, quote: firstSentence }]
            : []),
        ],
        grounding: "abstract_only" as const,
        availabilityNote: "Based on the cited work's abstract only; full text unavailable.",
        sourceLinks: [
          ...(work.url ? [{ label: "arXiv page", url: work.url }] : []),
          ...(work.openAccessPdfUrl ? [{ label: "Open-access PDF", url: work.openAccessPdfUrl }] : []),
        ],
      },
      meta: {
        provider: "mock",
        model: "mock-v1",
        isMock: true,
        promptVersion: "explain-v1",
        cached: false,
        generatedAt: new Date().toISOString(),
      },
    };
    s.aiCache.set(`explain:${referenceId}`, {
      ...response,
      meta: { ...response.meta, cached: true },
    });
    return response;
  },

  async paperSummary(paperId) {
    await sleep(700);
    const s = store();
    const cached = s.aiCache.get(`summary:${paperId}`);
    if (cached) return cached as never;
    const paper = [...s.papers.values()].find((p) => p.id === paperId);
    if (!paper) throw new ApiClientError(404, { error: { code: "not_found", message: "Paper not found" } }, "not found");
    const response = {
      summary:
        "This paper compares three sparse attention families — block, strided, and routed — at identical compute budgets on a new long-context retrieval benchmark of 2,400 literature questions. Routed (learned, content-dependent) sparsity recovers 97% of dense-attention accuracy at a fifth of the compute, with the gap widening as context grows.",
      keyContribution:
        "A controlled comparison showing learned routing beats fixed sparse patterns, plus a released retrieval benchmark.",
      grounding: "full_text" as const,
      meta: {
        provider: "mock",
        model: "mock-v1",
        isMock: true,
        promptVersion: "summary-v1",
        cached: false,
        generatedAt: new Date().toISOString(),
      },
    };
    s.aiCache.set(`summary:${paperId}`, {
      summary: { summary: response.summary, keyContribution: response.keyContribution, grounding: response.grounding },
      meta: { ...response.meta, cached: true },
    });
    return {
      summary: { summary: response.summary, keyContribution: response.keyContribution, grounding: response.grounding },
      meta: response.meta,
    };
  },

  async dashboard(groupId) {
    await sleep();
    groupOr404(groupId);
    return dashboardFixture(store(), groupId);
  },
};
