import { describe, expect, it } from "vitest";

import { entryForDest } from "../bibliography";
import { detectMarkers } from "../markers";
import { resolveReferences, type FetchLike } from "../resolve";
import type { BibEntry, ExtractedPaper, PageText, TextItemBox } from "../types";

function item(str: string, start: number, xPx = 50, yPx = 100): TextItemBox {
  return {
    str,
    start,
    end: start + str.length,
    xPx,
    yPx,
    wPx: str.length * 5,
    hPx: 10,
    rect: { x: xPx / 612, y: yPx / 792, w: (str.length * 5) / 612, h: 10 / 792 },
  };
}

function page(pageIndex: number, strs: string[]): PageText {
  const items: TextItemBox[] = [];
  let start = 0;
  for (const s of strs) {
    items.push(item(s, start));
    start += s.length;
  }
  const text = strs.join("");
  return {
    pageIndex,
    widthPx: 612,
    heightPx: 792,
    text,
    items,
    lines: [
      {
        text,
        itemStart: 0,
        itemEnd: items.length,
        xMin: 50,
        xMax: 550,
        yMid: 105,
        hPx: 10,
      },
    ],
    links: [],
  };
}

function bibEntry(over: Partial<BibEntry>): BibEntry {
  return {
    ordinal: 1,
    numberLabel: null,
    label: "1",
    rawText: "x",
    title: "Some Title",
    authors: ["Alice Smith"],
    year: 2020,
    pageIndex: 1,
    yTopPx: 100,
    yBottomPx: 124,
    ...over,
  };
}

describe("numeric bracket validity", () => {
  it("drops brackets whose numbers are not all bibliography labels", () => {
    const body = page(0, ["We vary x in [0,1] and scale bytes [0,255] but cite prior work [2] here."]);
    const extracted: ExtractedPaper = { pages: [body], pageCount: 2, citeTargets: new Map() };
    const entries = Array.from({ length: 30 }, (_, i) =>
      bibEntry({ ordinal: i + 1, numberLabel: i + 1 }),
    );
    const markers = detectMarkers(extracted, entries);
    const texts = markers.map((m) => m.markerText);
    // [0,1] and [0,255] don't map to labels -> whole brackets dropped; [2] survives.
    expect(texts).toEqual(["[2]"]);
    expect(markers[0].refOrdinal).toBe(2);
  });
});

describe("entryForDest", () => {
  const entries = [
    bibEntry({ ordinal: 1, numberLabel: 1, yTopPx: 100, yBottomPx: 124 }),
    bibEntry({ ordinal: 2, numberLabel: 2, yTopPx: 200, yBottomPx: 224 }),
  ];

  it("anchors inside an entry resolve to it", () => {
    expect(entryForDest(entries, 1, 110)?.ordinal).toBe(1);
    expect(entryForDest(entries, 1, 210)?.ordinal).toBe(2);
  });

  it("anchors a few px above the entry top pick the nearest entry", () => {
    expect(entryForDest(entries, 1, 196)?.ordinal).toBe(2);
    expect(entryForDest(entries, 1, 97)?.ordinal).toBe(1);
  });
});

describe("arXiv-id direct match", () => {
  const s2With = (arxiv: string, title: string) =>
    ({
      data: [
        {
          citedPaper: {
            paperId: "abc",
            title,
            authors: [{ name: "Alice Smith" }],
            year: 2017,
            externalIds: { ArXiv: arxiv },
            venue: null,
            url: null,
            openAccessPdf: null,
            abstract: null,
          },
        },
      ],
    }) as const;

  const fetchImpl: FetchLike = async () =>
    ({
      ok: true,
      headers: { get: () => null },
      json: async () => s2With("1706.06083", "Attention Is All You Need"),
      text: async () => "",
    }) as unknown as Response;

  const base = { arxivId: "1412.6980", fetchImpl };

  it("resolves when the extracted title corroborates the arXiv id", async () => {
    const entry = bibEntry({
      rawText: "Vaswani et al. Attention is all you need. arXiv:1706.06083",
      title: "Attention is all you need",
      year: 2017,
    });
    const [r] = await resolveReferences([entry], base);
    expect(r.matchStatus).toBe("resolved");
    expect(r.matchMethod).toBe("s2_arxiv_id");
  });

  it("goes ambiguous when the title does not match the arXiv-id candidate", async () => {
    const entry = bibEntry({
      rawText: "Someone et al. A completely unrelated result. arXiv:1706.06083",
      title: "A completely unrelated result about farming",
      year: 2020,
    });
    const [r] = await resolveReferences([entry], base);
    expect(r.matchStatus).toBe("ambiguous");
    expect(r.work).toBeNull();
  });

  it("stays unresolved when the entry has no title to verify", async () => {
    const entry = bibEntry({
      rawText: "arXiv:1706.06083",
      title: null,
    });
    const [r] = await resolveReferences([entry], base);
    expect(r.matchStatus).toBe("unresolved");
    expect(r.work).toBeNull();
  });
});
