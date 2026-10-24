import { z } from "zod";
import { IsoDate, Uuid } from "./common";

/** What source material the output is actually grounded in. */
export const Grounding = z.enum(["full_text", "abstract_only", "metadata_only"]);
export type Grounding = z.infer<typeof Grounding>;

export const SourceLink = z.object({ label: z.string(), url: z.string().url() });

export const AiMeta = z.object({
  provider: z.string(),
  model: z.string(),
  isMock: z.boolean(),
  promptVersion: z.string(),
  cached: z.boolean(),
  generatedAt: IsoDate,
});
export type AiMeta = z.infer<typeof AiMeta>;

/** summarizeWork(): generic summary of ONE work. Does not know who cites it. */
export const WorkSummary = z.object({
  summary: z.string().min(1).max(2000),
  keyContribution: z.string().min(1).max(1000),
  grounding: Grounding,
});
export type WorkSummary = z.infer<typeof WorkSummary>;

/**
 * explainCitation(): why the citing paper cites the referenced work, derived from the
 * citation context sentences in the citing paper. Distinct from WorkSummary.
 */
export const CitationExplanation = z.object({
  referencedPaper: z.object({
    title: z.string(),
    authors: z.array(z.string()),
    year: z.number().int().nullable(),
  }),
  summary: z.string().min(1).max(2000),
  keyContribution: z.string().min(1).max(1000),
  citationPurpose: z.enum([
    "background",
    "method_used",
    "baseline_comparison",
    "extends",
    "contrasts",
    "supports_claim",
    "dataset_or_tool",
    "other",
  ]),
  citationPurposeExplanation: z.string().min(1).max(1500),
  relationshipToCurrentPaper: z.string().min(1).max(1500),
  /** Verbatim quotes from the citing paper's context (and cited abstract) backing the explanation. */
  supportingEvidence: z
    .array(z.object({ source: z.enum(["citing_context", "cited_abstract"]), quote: z.string().min(1) }))
    .min(1)
    .max(6),
  grounding: Grounding,
  /** Human-readable caveat, e.g. "Based on the abstract only; full text unavailable." */
  availabilityNote: z.string(),
  sourceLinks: z.array(SourceLink),
});
export type CitationExplanation = z.infer<typeof CitationExplanation>;

// POST /api/papers/:pid/citations/:refId/explain   body: { groupId } (authorization context)
export const ExplainCitationRequest = z.object({ groupId: Uuid });
export const ExplainCitationResponse = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), explanation: CitationExplanation, meta: AiMeta }),
  /** Reference unresolved / no context: show bibliography metadata + searchUrl instead. */
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
]);
export type ExplainCitationResponse = z.infer<typeof ExplainCitationResponse>;

// POST /api/papers/:pid/summary   body: { groupId }  (summary of the paper being read)
export const PaperSummaryRequest = z.object({ groupId: Uuid });
export const PaperSummaryResponse = z.object({ summary: WorkSummary, meta: AiMeta });

// ---------------------------------------------------------------------------
// Server-side interfaces (implemented in src/server/ai). Not HTTP.
// ---------------------------------------------------------------------------
export interface LLMGenerateJsonArgs<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Stable name for logging/mocks, e.g. "explain_citation". */
  task: string;
  temperature?: number;
}

export interface LLMProvider {
  readonly name: "mock" | "gemini" | "ollama";
  readonly model: string;
  readonly isMock: boolean;
  /** Must return schema-valid output or throw. Implementations retry once on invalid JSON. */
  generateJson<T>(args: LLMGenerateJsonArgs<T>): Promise<T>;
}

export interface WorkInput {
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  /** Only when we legitimately have the full text (e.g. the paper being read). */
  fullText?: string;
}

export interface CitationInput {
  citingPaper: { id: string; title: string; abstract: string | null };
  citedWork: WorkInput & { url: string | null };
  contexts: Array<{ sentence: string; paragraph: string | null; markerText: string }>;
}

export const PROMPT_VERSION = { paper_summary: "summary-v1", citation_explanation: "explain-v1" } as const;
