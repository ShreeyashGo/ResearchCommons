import { describe, expect, it } from "vitest";
import {
  AMBIGUITY_WINDOW,
  TITLE_MATCH_THRESHOLD,
  arxivIdInText,
  deriveSearchUrl,
  normalizeTitle,
  pickMatch,
  titleSimilarity,
} from "../match";
import type { ExternalWorkInsert } from "../types";

function work(title: string, year: number | null = null): { work: ExternalWorkInsert } {
  return {
    work: {
      source: "semantic_scholar",
      externalId: `id:${title}`,
      title,
      authors: [],
      year,
      venue: null,
      abstract: null,
      doi: null,
      arxivId: null,
      url: null,
      openAccessPdfUrl: null,
    },
  };
}

describe("normalizeTitle", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(normalizeTitle("Attention Is All You Need!")).toBe("attention is all you need");
    expect(normalizeTitle("L'évolution — a test: x2.")).toBe("l evolution a test x2");
  });
});

describe("titleSimilarity", () => {
  it("scores 1 for identical titles, ~0 for unrelated", () => {
    expect(titleSimilarity("Deep learning", "Deep learning")).toBe(1);
    expect(titleSimilarity("Deep learning", "Quantum field theory")).toBe(0);
  });

  it("is tolerant to small edits (case, punctuation, one token)", () => {
    const s = titleSimilarity(
      "Towards Deep Learning Models Resistant to Adversarial Attacks",
      "Towards deep learning models resistant to adversarial attacks!",
    );
    expect(s).toBe(1);
    const s2 = titleSimilarity(
      "Batch normalization: accelerating deep network training",
      "Batch Normalization Accelerating Deep Network Training by Reducing Internal Covariate Shift",
    );
    expect(s2).toBeGreaterThan(0.6);
    expect(s2).toBeLessThan(1);
  });
});

describe("pickMatch", () => {
  const entry = { title: "Some Known Paper Title", year: 2020, rawText: "x" };

  it("resolves a candidate above threshold", () => {
    const out = pickMatch(entry, [work("Some Known Paper Title", 2020)]);
    expect(out.status).toBe("resolved");
    expect(out.score).toBeGreaterThanOrEqual(TITLE_MATCH_THRESHOLD);
    expect(out.work?.title).toBe("Some Known Paper Title");
  });

  it("is unresolved below threshold", () => {
    const out = pickMatch(entry, [work("A Completely Different Work", 2020)]);
    expect(out.status).toBe("unresolved");
    expect(out.work).toBeNull();
  });

  it("is unresolved with no title on the entry", () => {
    const out = pickMatch({ title: null, year: 2020, rawText: "x" }, [work("Some Known Paper Title")]);
    expect(out.status).toBe("unresolved");
  });

  it("rejects candidates outside the year tolerance", () => {
    const out = pickMatch(entry, [work("Some Known Paper Title", 1995)]);
    expect(out.status).toBe("unresolved");
  });

  it("accepts year within ±1 and missing years", () => {
    expect(pickMatch(entry, [work("Some Known Paper Title", 2021)]).status).toBe("resolved");
    expect(pickMatch(entry, [work("Some Known Paper Title", null)]).status).toBe("resolved");
    expect(pickMatch({ ...entry, year: null }, [work("Some Known Paper Title", 1995)]).status).toBe(
      "resolved",
    );
  });

  it("is ambiguous when a second candidate is within the ambiguity window", () => {
    // same normalized title -> identical similarity, difference 0 <= AMBIGUITY_WINDOW
    const out = pickMatch(entry, [
      work("Some Known Paper Title", 2020),
      work("Some known paper title.", 2020),
    ]);
    expect(out.status).toBe("ambiguous");
    expect(out.work).toBeNull();
    expect(AMBIGUITY_WINDOW).toBeCloseTo(0.03);
  });
});

describe("deriveSearchUrl / arxivIdInText", () => {
  it("derives a search URL from the title, else raw text", () => {
    expect(deriveSearchUrl({ title: "Adversarial Attacks", rawText: "x" })).toContain(
      "semanticscholar.org/search",
    );
    expect(deriveSearchUrl({ title: null, rawText: "Some raw reference" })).toContain(
      encodeURIComponent("Some raw reference").slice(0, 4),
    );
  });

  it("extracts arxiv ids from text", () => {
    expect(arxivIdInText("arXiv:1706.06083 [cs.LG]")).toBe("1706.06083");
    expect(arxivIdInText("preprint 1412.6980.")).toBe("1412.6980");
    expect(arxivIdInText("no id here 1999")).toBeNull();
  });
});
