import { describe, expect, it } from "vitest";
import {
  extractYear,
  isPageFurniture,
  parseBibliography,
  splitAuthorList,
  splitEntrySentences,
} from "../bibliography";
import { extractPdf } from "../extract";
import { fixturePdf } from "./helpers";

describe("splitEntrySentences", () => {
  it("splits sentences without breaking on initials", () => {
    const s = splitEntrySentences(
      "Vaswani, A., Shazeer, N. M., Parmar, N. Attention is all you need. In Advances in Neural Information Processing Systems, 2017.",
    );
    expect(s.length).toBeGreaterThanOrEqual(3);
    expect(s[0]).toContain("Vaswani");
    expect(s[0]).not.toContain("Attention");
  });

  it("keeps 'and'-joined author lists together", () => {
    const s = splitEntrySentences(
      "Polyak, Boris T and Juditsky, Anatoli B. Acceleration of stochastic approximation. SIAM J., 30(4), 1992.",
    );
    expect(s[0]).toContain("Juditsky");
    expect(s[1]).toContain("Acceleration");
  });
});

describe("splitAuthorList", () => {
  it("splits 'Surname, Initials' lists and drops et al.", () => {
    const a = splitAuthorList("Kingma, Diederik P and Welling, Max");
    expect(a).toContain("Diederik P Kingma");
    expect(a).toContain("Max Welling");
    const b = splitAuthorList("Smith, John, Doe, Jane, et al.");
    expect(b.length).toBe(2);
  });
});

describe("extractYear", () => {
  it("finds a plausible publication year", () => {
    expect(extractYear("Journal of ML, 10(2):251-276, 1998.")).toBe(1998);
    expect(extractYear("arXiv:1706.06083, 2017")).toBe(2017);
    expect(extractYear("pages 1-9")).toBeNull();
  });
});

describe("isPageFurniture", () => {
  it("catches running heads and bare page numbers", () => {
    expect(isPageFurniture("Published as a conference paper at ICLR 2015")).toBe(true);
    expect(isPageFurniture("  11 ")).toBe(true);
    expect(isPageFurniture("Madry et al. Towards deep learning")).toBe(false);
  });
});

describe("parseBibliography (fixtures)", () => {
  it("parses Madry's numbered bibliography", async () => {
    const ex = await extractPdf(await fixturePdf("1706.06083"));
    const entries = parseBibliography(ex.pages);
    expect(entries.length).toBeGreaterThanOrEqual(25);
    const withTitle = entries.filter((e) => e.title);
    expect(withTitle.length / entries.length).toBeGreaterThan(0.8);
    const ordinals = entries.map((e) => e.ordinal);
    expect(new Set(ordinals).size).toBe(ordinals.length);
    // every entry must carry its position for dest mapping
    expect(entries.every((e) => e.pageIndex >= 0 && e.yTopPx >= 0)).toBe(true);
  });

  it("parses Adam's author-year bibliography and stops at the appendix", async () => {
    const ex = await extractPdf(await fixturePdf("1412.6980"));
    const entries = parseBibliography(ex.pages);
    // real bibliography has 25 entries; nothing from the appendix
    expect(entries.length).toBeLessThanOrEqual(30);
    expect(entries.every((e) => !/convergence proof|lemma \d/i.test(e.rawText))).toBe(true);
    const adam = entries.find((e) => /adam/i.test(e.rawText));
    expect(adam).toBeUndefined(); // Adam IS the paper, not a ref; Kingma&Ba self-cite is [9]
    const variational = entries.find((e) => /auto-encoding variational/i.test(e.title ?? ""));
    expect(variational?.year).toBe(2013);
  });

  it("extracts clean titles from Attention bibliography entries", async () => {
    const ex = await extractPdf(await fixturePdf("1706.03762"));
    const entries = parseBibliography(ex.pages);
    const expected = [
      ["arXiv:1607.06450", "Layer normalization"],
      [
        "arXiv:1701.06538",
        "Outrageously large neural networks: The sparsely-gated mixture-of-experts layer",
      ],
      [
        "arXiv:1705.03122",
        "Convolutional sequence to sequence learning",
      ],
      [
        "arXiv:1511.06114",
        "Multi-task sequence to sequence learning",
      ],
      ["9(8):1735–1780", "Long short-term memory"],
    ] as const;

    for (const [marker, title] of expected) {
      const entry = entries.find((candidate) => candidate.rawText.includes(marker));
      expect(entry, `Missing bibliography entry containing ${marker}`).toBeDefined();
      expect(entry?.title).toBe(title);
    }
  });
});
