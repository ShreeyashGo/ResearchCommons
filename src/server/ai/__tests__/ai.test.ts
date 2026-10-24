import { describe, expect, it } from "vitest";
import type { CitationInput, WorkInput } from "@/contracts/ai";
import { CitationExplanation, PaperAnswer, WorkSummary } from "@/contracts/ai";
import { buildCacheKey, hashInputs, sha256Hex, stableStringify } from "../cache";
import { filterEvidence, AiOutputError } from "../explain";
import { buildAskPrompt, buildExplainPrompt, buildSummaryPrompt } from "../prompts";
import { mockProvider } from "../providers/mock";
import { summaryGrounding } from "../summarize";

const work: WorkInput = {
  title: "Towards Deep Learning Models Resistant to Adversarial Attacks",
  authors: ["Aleksander Madry", "Aleksandar Makelov"],
  year: 2018,
  abstract:
    "In this work we formalize adversarial robustness. We show that robust optimization can be solved via a natural saddle point formulation. Our methods yield reliable defenses.",
};

const input: CitationInput = {
  citingPaper: {
    id: "00000000-0000-0000-0000-000000000001",
    title: "Understanding adversarial training",
    abstract: "We study adversarial training as a baseline method.",
  },
  citedWork: { ...work, url: "https://arxiv.org/abs/1706.06083" },
  contexts: [
    {
      sentence: "Adversarial training was introduced in Madry et al., however the adversary utilized was weaker.",
      paragraph: "Adversarial training was introduced in Madry et al., however the adversary utilized was weaker.",
      markerText: "11",
    },
    {
      sentence: "We use the PGD attack as a baseline comparison.",
      paragraph: "We use the PGD attack as a baseline comparison.",
      markerText: "11",
    },
  ],
};

describe("mock provider", () => {
  it("is deterministic and schema-valid for summaries", async () => {
    const prompt = buildSummaryPrompt(work);
    const a = await mockProvider.generateJson({ system: "s", prompt, schema: WorkSummary, task: "paper_summary" });
    const b = await mockProvider.generateJson({ system: "s", prompt, schema: WorkSummary, task: "paper_summary" });
    expect(a).toEqual(b);
    expect(WorkSummary.safeParse(a).success).toBe(true);
    expect(a.summary.length).toBeGreaterThan(10);
    expect(a.grounding).toBe("abstract_only");
  });

  it("is deterministic and schema-valid for explanations", async () => {
    const prompt = buildExplainPrompt(input);
    const a = await mockProvider.generateJson({ system: "s", prompt, schema: CitationExplanation, task: "citation_explanation" });
    const b = await mockProvider.generateJson({ system: "s", prompt, schema: CitationExplanation, task: "citation_explanation" });
    expect(a).toEqual(b);
    expect(CitationExplanation.safeParse(a).success).toBe(true);
    // mock evidence is drawn verbatim from the real context/abstract inputs
    const hay = `${input.contexts.map((c) => c.sentence).join(" ")} ${work.abstract}`;
    for (const e of a.supportingEvidence) {
      expect(hay.replace(/\s+/g, " ")).toContain(e.quote.replace(/\s+/g, " ").trim());
    }
  });

  it("varies with its inputs", async () => {
    const other = { ...input, citedWork: { ...input.citedWork, title: "A Different Paper" } };
    const a = await mockProvider.generateJson({ system: "s", prompt: buildExplainPrompt(input), schema: CitationExplanation, task: "citation_explanation" });
    const b = await mockProvider.generateJson({ system: "s", prompt: buildExplainPrompt(other), schema: CitationExplanation, task: "citation_explanation" });
    expect(a).not.toEqual(b);
  });

  const askInput = {
    question: "How does the Transformer replace recurrence?",
    history: [],
    paper: { title: "Attention Is All You Need", abstract: "A paper about attention." },
    pages: [
      { pageIndex: 0, text: "We propose the Transformer, a network architecture based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. It uses multi-head self-attention." },
      { pageIndex: 3, text: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. Attention allows modeling dependencies regardless of distance." },
    ],
  };

  it("answers from matching sentences with verbatim page-tagged evidence", async () => {
    const prompt = buildAskPrompt(askInput);
    const a = await mockProvider.generateJson({ system: "s", prompt, schema: PaperAnswer, task: "ask_paper" });
    expect(PaperAnswer.safeParse(a).success).toBe(true);
    expect(a.notFoundInPaper).toBe(false);
    expect(a.evidence.length).toBeGreaterThan(0);
    for (const ev of a.evidence) {
      const page = askInput.pages.find((p) => p.pageIndex === ev.pageIndex)!;
      expect(page.text.replace(/\s+/g, " ")).toContain(ev.quote);
    }
  });

  it("reports notFoundInPaper on an unrelated question", async () => {
    const prompt = buildAskPrompt({ ...askInput, question: "What is the recipe for sourdough bread?" });
    const a = await mockProvider.generateJson({ system: "s", prompt, schema: PaperAnswer, task: "ask_paper" });
    expect(PaperAnswer.safeParse(a).success).toBe(true);
    expect(a.notFoundInPaper).toBe(true);
    expect(a.evidence).toEqual([]);
  });
});

describe("filterEvidence", () => {
  const base = {
    referencedPaper: { title: work.title, authors: work.authors, year: 2018 },
    summary: "s",
    keyContribution: "k",
    citationPurpose: "method_used" as const,
    citationPurposeExplanation: "e",
    relationshipToCurrentPaper: "r",
    grounding: "abstract_only" as const,
    availabilityNote: "n",
    sourceLinks: [],
  };

  it("keeps verbatim evidence, drops fabricated quotes", () => {
    const explanation = {
      ...base,
      supportingEvidence: [
        { source: "citing_context" as const, quote: input.contexts[0].sentence },
        { source: "citing_context" as const, quote: "This quote does not appear anywhere in the inputs." },
        { source: "cited_abstract" as const, quote: "We show that robust optimization can be solved via a natural saddle point formulation." },
      ],
    };
    const out = filterEvidence(input, explanation);
    expect(out.supportingEvidence).toHaveLength(2);
    expect(out.supportingEvidence.every((e) => !e.quote.includes("does not appear"))).toBe(true);
  });

  it("throws when no evidence is verifiable", () => {
    const explanation = {
      ...base,
      supportingEvidence: [{ source: "citing_context" as const, quote: "Completely fabricated quote." }],
    };
    expect(() => filterEvidence(input, explanation)).toThrow(AiOutputError);
  });
});

describe("cache keys", () => {
  const args = {
    kind: "citation_explanation" as const,
    subjectIds: ["p1", "r2"],
    inputsHash: hashInputs({ a: 1, b: "x" }),
    promptVersion: "explain-v1",
    provider: "mock",
    model: "mock-extractive-v1",
  };

  it("are deterministic sha256 of kind|subjects|inputs|version|provider|model", () => {
    const k1 = buildCacheKey(args);
    const k2 = buildCacheKey({ ...args });
    expect(k1).toBe(k2);
    expect(k1).toBe(sha256Hex(["citation_explanation", "p1|r2", args.inputsHash, "explain-v1", "mock", "mock-extractive-v1"].join("|")));
  });

  it("change with any component", () => {
    const k = buildCacheKey(args);
    expect(buildCacheKey({ ...args, kind: "paper_summary" })).not.toBe(k);
    expect(buildCacheKey({ ...args, promptVersion: "explain-v2" })).not.toBe(k);
    expect(buildCacheKey({ ...args, provider: "gemini" })).not.toBe(k);
    expect(buildCacheKey({ ...args, model: "other" })).not.toBe(k);
    expect(buildCacheKey({ ...args, subjectIds: ["p1"] })).not.toBe(k);
  });

  it("hashInputs is stable under object key order", () => {
    expect(hashInputs({ a: 1, b: { c: 2, d: [3, 4] } })).toBe(hashInputs({ b: { d: [3, 4], c: 2 }, a: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });
});

describe("summaryGrounding", () => {
  it("prefers full_text > abstract_only > metadata_only", () => {
    expect(summaryGrounding({ ...work, fullText: "full" })).toBe("full_text");
    expect(summaryGrounding(work)).toBe("abstract_only");
    expect(summaryGrounding({ ...work, abstract: null })).toBe("metadata_only");
  });
});
