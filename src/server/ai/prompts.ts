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

function authorsLine(authors: string[]): string {
  return authors.slice(0, 8).join("; ") || "unknown";
}

export function buildSummaryPrompt(work: WorkInput): string {
  return [
    "===WORK===",
    `TITLE: ${work.title}`,
    `AUTHORS: ${authorsLine(work.authors)}`,
    `YEAR: ${work.year ?? "unknown"}`,
    `ABSTRACT: ${work.abstract ?? "N/A"}`,
    work.fullText ? "===FULL_TEXT_EXCERPT===" : "",
    work.fullText ? work.fullText : "",
    "===END===",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function buildExplainPrompt(input: CitationInput): string {
  const contexts = input.contexts
    .slice(0, 8)
    .map((c, i) => `CONTEXT[${i}] ${c.sentence}`)
    .join("\n");
  return [
    "===CITING_PAPER===",
    `TITLE: ${input.citingPaper.title}`,
    `ABSTRACT: ${input.citingPaper.abstract ?? "N/A"}`,
    "===CITED_WORK===",
    `TITLE: ${input.citedWork.title}`,
    `AUTHORS: ${authorsLine(input.citedWork.authors)}`,
    `YEAR: ${input.citedWork.year ?? "unknown"}`,
    `URL: ${input.citedWork.url ?? "N/A"}`,
    `ABSTRACT: ${input.citedWork.abstract ?? "N/A"}`,
    "===CITATION_CONTEXTS===",
    contexts || "CONTEXT[0] N/A",
    "===END===",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Section readers shared by the mock provider and tests. The mock is built from
// real inputs by parsing these tagged sections back out of the prompt.
// ---------------------------------------------------------------------------
export function readSection(prompt: string, name: string): string {
  const m = new RegExp(`===${name}===\\n([\\s\\S]*?)(?=\\n===|$)`).exec(prompt);
  return m?.[1]?.trim() ?? "";
}

export function readField(section: string, field: string): string | null {
  const m = new RegExp(`^${field}: (.*)$`, "m").exec(section);
  const v = m?.[1]?.trim();
  return v && v !== "N/A" ? v : null;
}

export function readContexts(prompt: string): string[] {
  const section = readSection(prompt, "CITATION_CONTEXTS");
  return [...section.matchAll(/^CONTEXT\[\d+\] (.+)$/gm)]
    .map((m) => m[1].trim())
    .filter((s) => s && s !== "N/A");
}
