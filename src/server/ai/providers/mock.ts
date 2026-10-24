import type { LLMGenerateJsonArgs, LLMProvider } from "@/contracts/ai";
import { readContexts, readField, readSection } from "../prompts";

/** First `n` sentences of a block of prose (naive but deterministic). */
function firstSentences(text: string, n: number): string {
  const parts = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  return parts.slice(0, n).join(" ") || text.slice(0, 280).trim();
}

const PURPOSE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(baseline|compare[ds]?|outperform|state[- ]of[- ]the[- ]art|benchmark)\b/i, "baseline_comparison"],
  [/\b(we (use|adopt|follow|apply|employ|build on)|using the (method|approach|technique)|our (method|approach|implementation) (uses|is based on))\b/i, "method_used"],
  [/\b(extend|generaliz|build[s]? upon|improve[sd]? on)\b/i, "extends"],
  [/\b(in contrast|unlike|however,|whereas|differs? from)\b/i, "contrasts"],
  [/\b(as shown (in|by)|consistent with|support[sd]?|confirm[sd]?|following)\b/i, "supports_claim"],
  [/\b(dataset|corpus|implementation|code|tool|library|framework|software)\b/i, "dataset_or_tool"],
];

function classifyPurpose(contexts: string[]): string {
  const hay = contexts.join(" ");
  for (const [re, purpose] of PURPOSE_PATTERNS) {
    if (re.test(hay)) return purpose;
  }
  return "background";
}

/**
 * Deterministic provider: every output is assembled from the actual inputs
 * embedded in the prompt (context sentences, abstract sentences, titles).
 * Used by default (AI_PROVIDER=mock) and always labelled Mock AI downstream.
 */
export const mockProvider: LLMProvider = {
  name: "mock",
  model: "mock-extractive-v1",
  isMock: true,

  async generateJson<T>(args: LLMGenerateJsonArgs<T>): Promise<T> {
    if (args.task === "paper_summary") {
      const work = readSection(args.prompt, "WORK") || null;
      const title = readField(work ?? "", "TITLE") ?? "Untitled work";
      const abstract = readField(work ?? "", "ABSTRACT");
      const fullText = readSection(args.prompt, "FULL_TEXT_EXCERPT") || null;
      // Prefer the extracted full text so grounding="full_text" is honest.
      const source = fullText ?? abstract;
      const summary = source
        ? firstSentences(source, 3)
        : `No abstract or full text is available for "${title}".`;
      const keySource = source?.match(/[^.!?]*(?:we (?:show|propose|prove|present|demonstrate|introduce|study)|this (?:paper|work) (?:shows?|proposes?|presents?|demonstrates?|introduces?))[^.!?]*[.!?]/i)?.[0];
      // Validate the mock output against the same schema as real providers.
      return args.schema.parse({
        summary: summary.slice(0, 2000),
        keyContribution: (keySource?.trim() || firstSentences(source ?? title, 1) || title).slice(0, 1000),
        grounding: fullText ? "full_text" : abstract ? "abstract_only" : "metadata_only",
      }) as T;
    }

    if (args.task === "citation_explanation") {
      const cited = readSection(args.prompt, "CITED_WORK") || null;
      const citing = readSection(args.prompt, "CITING_PAPER") || null;
      const contexts = readContexts(args.prompt);
      const title = readField(cited ?? "", "TITLE") ?? "Unknown work";
      const authors = (readField(cited ?? "", "AUTHORS") ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const yearRaw = readField(cited ?? "", "YEAR");
      const year = yearRaw && /^\d+$/.test(yearRaw) ? Number(yearRaw) : null;
      const url = readField(cited ?? "", "URL");
      const abstract = readField(cited ?? "", "ABSTRACT");
      const citingTitle = readField(citing ?? "", "TITLE") ?? "the citing paper";

      const ctx = contexts[0] ?? "";
      const purpose = classifyPurpose(contexts);
      const abstractSentence = abstract ? firstSentences(abstract, 1) : "";

      const evidence: Array<{ source: "citing_context" | "cited_abstract"; quote: string }> = [];
      if (ctx) evidence.push({ source: "citing_context", quote: ctx });
      if (abstractSentence) evidence.push({ source: "cited_abstract", quote: abstractSentence });
      if (evidence.length === 0) {
        evidence.push({ source: "citing_context", quote: title });
      }

      return args.schema.parse({
        referencedPaper: { title, authors, year },
        summary: abstract
          ? firstSentences(abstract, 3).slice(0, 2000)
          : `"${title}" is cited by "${citingTitle}"${ctx ? `, which writes: "${ctx}"` : "."}`,
        keyContribution:
          abstractSentence ||
          `Referenced in "${citingTitle}" as: ${ctx || title}`,
        citationPurpose: purpose,
        citationPurposeExplanation: `The citing paper writes: "${ctx || `see the reference to ${title}`}"`,
        relationshipToCurrentPaper: `"${citingTitle}" cites "${title}" (${purpose.replace(/_/g, " ")}).`,
        supportingEvidence: evidence.slice(0, 6),
        grounding: abstract ? "abstract_only" : "metadata_only",
        availabilityNote: abstract
          ? "Mock AI: generated from the cited work's abstract and the citation contexts; full text of the cited work unavailable."
          : "Mock AI: only citation contexts and metadata are available; no abstract.",
        sourceLinks: url ? [{ label: "Semantic Scholar / source page", url }] : [],
      }) as T;
    }

    throw new Error(`mock provider: unknown task "${args.task}"`);
  },
};
