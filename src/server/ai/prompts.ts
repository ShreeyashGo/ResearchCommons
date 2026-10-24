import type { CitationInput, WorkInput } from "@/contracts/ai";
import { PROMPT_VERSION } from "@/contracts/ai";

export { PROMPT_VERSION };

export const SUMMARY_SYSTEM = [
  "You are Research Commons' summarization service. Summarize ONE scholarly work.",
  "Use ONLY the source text provided. Never invent claims, numbers, or citations.",
  'Return a single JSON object: {"summary": string, "keyContribution": string, "grounding": "full_text"|"abstract_only"|"metadata_only"}.',
  "summary: 2-4 sentences. keyContribution: one sentence naming the main contribution.",
].join("\n");

export const EXPLAIN_SYSTEM = [
  "You are Research Commons' citation-intelligence service.",
  "Explain why the citing paper cites the referenced work, using ONLY the provided citation contexts and metadata.",
  "Never invent content. supportingEvidence must be VERBATIM quotes copied character-for-character from the provided contexts or abstract.",
  'Return a single JSON object: {"referencedPaper": {"title": string, "authors": string[], "year": number|null}, "summary": string, "keyContribution": string, "citationPurpose": "background"|"method_used"|"baseline_comparison"|"extends"|"contrasts"|"supports_claim"|"dataset_or_tool"|"other", "citationPurposeExplanation": string, "relationshipToCurrentPaper": string, "supportingEvidence": [{"source": "citing_context"|"cited_abstract", "quote": string}], "grounding": "full_text"|"abstract_only"|"metadata_only", "availabilityNote": string, "sourceLinks": [{"label": string, "url": string}]}.',
].join("\n");

export const ASK_SYSTEM = [
  "You are Research Commons' paper Q&A service. Answer the user's question using ONLY the provided paper text.",
  "Never invent claims, numbers, or citations. If the paper does not answer the question, say so instead of guessing.",
  'Return a single JSON object: {"answer": string, "evidence": [{"pageIndex": number, "quote": string}], "grounding": "full_text"|"abstract_only"|"metadata_only", "notFoundInPaper": boolean}.',
  "evidence: up to 5 VERBATIM quotes copied character-for-character from the paper text, each with its 0-based pageIndex.",
].join("\n");

function authorsLine(authors: string[]): string {
  return authors.slice(0, 8).join("; ") || "unknown";
}

/**
 * Neutralize lines in paper-derived text that could forge our section markers
 * (e.g. "===END===") — mitigation only; model output is still schema-checked
 * and evidence is verified verbatim downstream.
 */
function sanitizeInput(s: string): string {
  return s.replace(/^\s*=+\s*[A-Z_ ]*=*\s*$/gm, " ");
}

export function buildSummaryPrompt(work: WorkInput): string {
  return [
    "===WORK===",
    `TITLE: ${sanitizeInput(work.title)}`,
    `AUTHORS: ${authorsLine(work.authors.map(sanitizeInput))}`,
    `YEAR: ${work.year ?? "unknown"}`,
    `ABSTRACT: ${sanitizeInput(work.abstract ?? "N/A")}`,
    work.fullText ? "===FULL_TEXT_EXCERPT===" : "",
    work.fullText ? sanitizeInput(work.fullText) : "",
    "===END===",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildExplainPrompt(input: CitationInput): string {
  const contexts = input.contexts
    .slice(0, 8)
    .map((c, i) => `CONTEXT[${i}] ${sanitizeInput(c.sentence)}`)
    .join("\n");
  return [
    "===CITING_PAPER===",
    `TITLE: ${sanitizeInput(input.citingPaper.title)}`,
    `ABSTRACT: ${sanitizeInput(input.citingPaper.abstract ?? "N/A")}`,
    "===CITED_WORK===",
    `TITLE: ${sanitizeInput(input.citedWork.title)}`,
    `AUTHORS: ${authorsLine(input.citedWork.authors.map(sanitizeInput))}`,
    `YEAR: ${input.citedWork.year ?? "unknown"}`,
    `URL: ${input.citedWork.url ?? "N/A"}`,
    `ABSTRACT: ${sanitizeInput(input.citedWork.abstract ?? "N/A")}`,
    "===CITATION_CONTEXTS===",
    contexts || "CONTEXT[0] N/A",
    "===END===",
  ].join("\n");
}

export interface AskInput {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  paper: { title: string; abstract: string | null };
  /** Extracted page texts (0-based pageIndex) when full text is available. */
  pages?: Array<{ pageIndex: number; text: string }>;
  /** Focused passage (e.g. an annotation's quote) to bias the answer toward. */
  focusPassage?: { pageIndex: number; quote: string };
}

export function buildAskPrompt(input: AskInput): string {
  const history = input.history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "USER" : "ASSISTANT"}: ${sanitizeInput(t.content)}`)
    .join("\n");
  const pages = (input.pages ?? [])
    .map((p) => `--- PAGE ${p.pageIndex} ---\n${sanitizeInput(p.text)}`)
    .join("\n");
  return [
    "===QUESTION===",
    sanitizeInput(input.question),
    input.focusPassage ? "===FOCUS_PASSAGE===" : "",
    input.focusPassage ? `PAGE: ${input.focusPassage.pageIndex}` : "",
    input.focusPassage ? sanitizeInput(input.focusPassage.quote) : "",
    history ? "===HISTORY===" : "",
    history,
    "===PAPER===",
    `TITLE: ${sanitizeInput(input.paper.title)}`,
    `ABSTRACT: ${sanitizeInput(input.paper.abstract ?? "N/A")}`,
    pages ? "===PAGES===" : "",
    pages,
    "===END===",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---------------------------------------------------------------------------
// Section readers shared by the mock provider and tests. The mock is built from
// real inputs by parsing these tagged sections back out of the prompt.
// ---------------------------------------------------------------------------
export function readSection(prompt: string, name: string): string {
  // The end marker must be a real ===NAME=== header: a line like "====="
  // inside excerpted PDF text must not truncate the section.
  const m = new RegExp(`===${name}===\\n([\\s\\S]*?)(?=\\n===[A-Z_]+===|$)`).exec(prompt);
  return m?.[1]?.trim() ?? "";
}

const FIELD_BOUNDARY =
  "(?:TITLE|AUTHORS|YEAR|VENUE|ABSTRACT|URL|CITING_PAPER|CITED_WORK|WORK|CONTEXT\\[)";

export function readField(section: string, field: string): string | null {
  // Values may span multiple lines; they end at the next FIELD: header or the
  // end of the section rather than at the first newline.
  const m = new RegExp(
    `^${field}: ([\\s\\S]*?)(?=\\n${FIELD_BOUNDARY}|\\n===|$)`,
    "m",
  ).exec(section);
  const v = m?.[1]?.trim();
  return v && v !== "N/A" ? v : null;
}

export function readContexts(prompt: string): string[] {
  const section = readSection(prompt, "CITATION_CONTEXTS");
  return [...section.matchAll(/^CONTEXT\[\d+\] (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((s) => s && s !== "N/A");
}
