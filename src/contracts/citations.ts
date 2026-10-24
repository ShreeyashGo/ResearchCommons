import { z } from "zod";
import { Uuid } from "./common";
import { NormalizedRect } from "./annotations";
import { ProcessingStatus } from "./papers";

export const ExternalSource = z.enum(["semantic_scholar", "openalex", "arxiv"]);

/** Metadata for a cited work. We never store cited PDFs. */
export const ExternalWork = z.object({
  id: Uuid,
  source: ExternalSource,
  externalId: z.string(),
  title: z.string(),
  authors: z.array(z.string()),
  year: z.number().int().nullable(),
  venue: z.string().nullable(),
  abstract: z.string().nullable(),
  doi: z.string().nullable(),
  arxivId: z.string().nullable(),
  url: z.string().nullable(),
  openAccessPdfUrl: z.string().nullable(),
});
export type ExternalWork = z.infer<typeof ExternalWork>;

export const MatchStatus = z.enum(["resolved", "unresolved", "ambiguous"]);

export const Reference = z.object({
  id: Uuid,
  paperId: Uuid,
  /** 1-based order in the bibliography. */
  ordinal: z.number().int().min(1),
  /** In-text label, e.g. "12" or "Madry et al., 2018". */
  label: z.string().nullable(),
  rawText: z.string(),
  parsedTitle: z.string().nullable(),
  parsedAuthors: z.array(z.string()),
  parsedYear: z.number().int().nullable(),
  matchStatus: MatchStatus,
  matchScore: z.number().min(0).max(1).nullable(),
  matchMethod: z.string().nullable(),
  /** Present only when matchStatus === "resolved". */
  work: ExternalWork.nullable(),
  /** Fallback link when unresolved (search URL built from raw text). Never a guessed match. */
  searchUrl: z.string().url(),
});
export type Reference = z.infer<typeof Reference>;

export const CitationContext = z.object({
  id: Uuid,
  referenceId: Uuid,
  pageIndex: z.number().int().min(0),
  markerText: z.string(),
  sentence: z.string(),
  paragraph: z.string().nullable(),
  /** Marker location on the page (normalized), used to make markers clickable. May be empty. */
  rects: z.array(NormalizedRect),
  detectionMethod: z.enum(["pdf_link", "regex"]),
});
export type CitationContext = z.infer<typeof CitationContext>;

// GET /api/papers/:pid/citations
export const GetCitationsResponse = z.object({
  processingStatus: ProcessingStatus,
  processingError: z.string().nullable(),
  references: z.array(Reference),
  contexts: z.array(CitationContext),
});
export type GetCitationsResponse = z.infer<typeof GetCitationsResponse>;

// POST /api/papers/:pid/process -> 202 { processingStatus }
export const ProcessPaperResponse = z.object({ processingStatus: ProcessingStatus });
