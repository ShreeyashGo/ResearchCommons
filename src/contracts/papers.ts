import { z } from "zod";
import { IsoDate, ProfileSummary, Uuid } from "./common";

export const PaperSource = z.enum(["arxiv", "upload"]);
export const ProcessingStatus = z.enum(["pending", "processing", "ready", "failed"]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

/** Canonical paper metadata (shared across groups). */
export const Paper = z.object({
  id: Uuid,
  source: PaperSource,
  title: z.string(),
  authors: z.array(z.string()),
  abstract: z.string().nullable(),
  year: z.number().int().nullable(),
  doi: z.string().nullable(),
  /** Normalized, no version suffix, e.g. "1706.06083". */
  arxivId: z.string().nullable(),
  pageCount: z.number().int().nullable(),
  processingStatus: ProcessingStatus,
  processingError: z.string().nullable(),
  createdAt: IsoDate,
});
export type Paper = z.infer<typeof Paper>;

/** A paper as it appears in one group's library. */
export const LibraryPaper = Paper.extend({
  groupId: Uuid,
  tags: z.array(z.string()),
  addedBy: ProfileSummary.nullable(),
  addedAt: IsoDate,
  annotationCount: z.number().int(),
  reviewCount: z.number().int(),
});
export type LibraryPaper = z.infer<typeof LibraryPaper>;

// GET /api/groups/:gid/papers?q=&tag=
export const ListLibraryQuery = z.object({
  q: z.string().trim().max(200).optional(),
  tag: z.string().trim().max(50).optional(),
});
export const ListLibraryResponse = z.object({ papers: z.array(LibraryPaper) });

// POST /api/groups/:gid/papers/arxiv
/** Accepts arxiv.org/abs/<id>, arxiv.org/pdf/<id>[.pdf], with or without vN, or a bare id. */
export const ImportArxivRequest = z.object({
  url: z.string().trim().min(4).max(300),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});
export const ImportPaperResponse = z.object({
  paper: LibraryPaper,
  /** true when the canonical paper already existed (dedupe by arxivId / pdf sha256). */
  deduplicated: z.boolean(),
});
export type ImportPaperResponse = z.infer<typeof ImportPaperResponse>;

// POST /api/groups/:gid/papers/upload  (multipart/form-data)
//   file: application/pdf, <= 20 MiB (required)
//   metadata: JSON string matching UploadPaperMetadata (optional)
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const UploadPaperMetadata = z.object({
  title: z.string().trim().min(1).max(1000).optional(),
  authors: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  year: z.number().int().min(1600).max(2200).optional(),
  doi: z.string().trim().max(200).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
});

// PATCH /api/groups/:gid/papers/:pid
export const UpdateLibraryPaperRequest = z.object({
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
});

// GET /api/papers/:pid?groupId=
export const GetPaperResponse = z.object({
  paper: LibraryPaper,
  /** Short-lived signed URL for the private PDF; null if no PDF stored. */
  pdfUrl: z.string().url().nullable(),
  pdfUrlExpiresAt: IsoDate.nullable(),
});
export type GetPaperResponse = z.infer<typeof GetPaperResponse>;

// DELETE /api/groups/:gid/papers/:pid -> 204 (unlinks from group only)
