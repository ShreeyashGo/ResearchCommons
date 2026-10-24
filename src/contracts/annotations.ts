import { z } from "zod";
import { IsoDate, ProfileSummary, Uuid } from "./common";

/**
 * Rectangle in page-normalized coordinates: 0..1 of the unscaled page
 * (PDF.js viewport at scale 1, rotation 0), origin top-left.
 * Zoom/viewport independent: multiply by the current viewport width/height.
 */
export const NormalizedRect = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type NormalizedRect = z.infer<typeof NormalizedRect>;

/**
 * W3C-style TextQuoteSelector over the page's text content
 * (PDF.js getTextContent() items joined with "" in order; see docs/architecture.md §Anchoring).
 */
export const TextQuoteSelector = z.object({
  exact: z.string().min(1).max(5000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});

/** Character offsets into the same page text string. Hint only; quote wins on conflict. */
export const TextPositionSelector = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(1),
});

export const AnnotationAnchor = z.object({
  version: z.literal(1),
  pageIndex: z.number().int().min(0),
  rects: z.array(NormalizedRect).min(1).max(200),
  quote: TextQuoteSelector,
  position: TextPositionSelector.optional(),
});
export type AnnotationAnchor = z.infer<typeof AnnotationAnchor>;

export const AnnotationColor = z.enum(["yellow", "green", "blue", "pink", "purple"]);
export const AnnotationVisibility = z.enum(["group", "private"]);

export const Comment = z.object({
  id: Uuid,
  annotationId: Uuid,
  parentId: Uuid.nullable(),
  author: ProfileSummary,
  /** "" when deleted. */
  body: z.string(),
  deleted: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Comment = z.infer<typeof Comment>;

/** Top-level comment with its replies (one level of threading). */
export const CommentThread = Comment.extend({ replies: z.array(Comment) });
export type CommentThread = z.infer<typeof CommentThread>;

export const Annotation = z.object({
  id: Uuid,
  groupId: Uuid,
  paperId: Uuid,
  author: ProfileSummary,
  visibility: AnnotationVisibility,
  color: AnnotationColor,
  anchor: AnnotationAnchor,
  comments: z.array(CommentThread),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Annotation = z.infer<typeof Annotation>;

// GET /api/groups/:gid/papers/:pid/annotations
export const ListAnnotationsResponse = z.object({ annotations: z.array(Annotation) });

// POST /api/groups/:gid/papers/:pid/annotations
export const CreateAnnotationRequest = z.object({
  visibility: AnnotationVisibility.default("group"),
  color: AnnotationColor.default("yellow"),
  anchor: AnnotationAnchor,
  /** Optional first comment, created atomically with the annotation. */
  comment: z.string().trim().min(1).max(10000).optional(),
});
export const AnnotationResponse = z.object({ annotation: Annotation });

// PATCH /api/annotations/:aid  (author only; anchor/quote are immutable)
export const UpdateAnnotationRequest = z
  .object({ visibility: AnnotationVisibility.optional(), color: AnnotationColor.optional() })
  .refine((v) => v.visibility !== undefined || v.color !== undefined, "nothing to update");

// DELETE /api/annotations/:aid -> 204

// POST /api/annotations/:aid/comments
export const CreateCommentRequest = z.object({
  body: z.string().trim().min(1).max(10000),
  parentId: Uuid.optional(),
});
export const CommentResponse = z.object({ comment: Comment });

// PATCH /api/comments/:cid  (author only)
export const UpdateCommentRequest = z.object({ body: z.string().trim().min(1).max(10000) });

// DELETE /api/comments/:cid -> 204 (soft delete; body becomes "", deleted=true)
