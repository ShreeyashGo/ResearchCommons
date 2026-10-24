// @vitest-environment happy-dom
import { describe, expect, it, beforeAll } from "vitest";
import { AnnotationAnchor } from "@/contracts";
import {
  buildPageTextMap,
  mergeLineRects,
  pageText,
  reanchor,
  type PageTextMap,
} from "@/lib/client/anchors";
import type { NormalizedRect } from "@/contracts";

/**
 * Anchoring spec: docs/architecture.md §5.
 * Page text = textContent.items.map(i => i.str).join(""); rects normalized to
 * the scale-1 viewport; position is a hint — quote (+prefix/suffix) wins.
 */

function makeRect(x: number): NormalizedRect {
  return { x, y: 0.1, w: 0.2, h: 0.05 };
}

describe("pageText", () => {
  it("joins item strings with no separator, skipping non-text items", () => {
    const textContent = {
      items: [
        { str: "Hello " },
        { str: "world" },
        { type: "markedContent" }, // no `str` — contributes ""
        { str: "!" },
      ],
    };
    // Casting: the contract under test accepts pdf.js textContent items.
    expect(pageText(textContent as never)).toBe("Hello world!");
  });
});

describe("mergeLineRects", () => {
  it("merges rects on the same visual line and keeps separate lines apart", () => {
    const line1a = { x: 0.1, y: 0.2, w: 0.3, h: 0.04 };
    const line1b = { x: 0.45, y: 0.21, w: 0.2, h: 0.04 };
    const line2 = { x: 0.1, y: 0.4, w: 0.5, h: 0.04 };
    const out = mergeLineRects([line1a, line1b, line2]);
    expect(out).toHaveLength(2);
    expect(out[0].x).toBeCloseTo(0.1);
    expect(out[0].y).toBeCloseTo(0.2);
    expect(out[0].w).toBeCloseTo(0.55);
    expect(out[0].h).toBeCloseTo(0.05);
    expect(out[1]).toEqual(line2);
  });

  it("returns a single rect unchanged", () => {
    const r = makeRect(0.5);
    expect(mergeLineRects([r])).toEqual([r]);
  });
});

function makePage(itemStrs: string[], divTexts: (string | null)[]) {
  const pageEl = document.createElement("div");
  for (const t of divTexts) {
    if (t === null) continue;
    const s = document.createElement("span");
    s.textContent = t;
    pageEl.appendChild(s);
  }
  document.body.appendChild(pageEl);
  const textContent = { items: itemStrs.map((str) => ({ str })) };
  const map = buildPageTextMap(textContent as never, pageEl);
  return { pageEl, map };
}

describe("buildPageTextMap", () => {
  it("labels every div when div count matches item count", () => {
    const { map } = makePage(["alpha", "beta", "gamma"], ["alpha", "beta", "gamma"]);
    expect(map.text).toBe("alphabetagamma");
    expect(map.spans).toHaveLength(3);
    expect(map.spans.map((s) => [s.dataset.start, s.dataset.end])).toEqual([
      ["0", "5"],
      ["5", "9"],
      ["9", "14"],
    ]);
  });

  it("greedy-scan labels only the items that exist as divs when counts differ (item-7 regression)", () => {
    const items = ["i0", "i1", "i2", "i3", "i4", "i5", "i6", "i7"];
    // The div for i6 ("the 7th item") is missing: shapes diverge.
    const { map } = makePage(items, ["i0", "i1", "i2", "i3", "i4", "i5", "i7"]);
    expect(map.text).toBe(items.join(""));
    expect(map.spans).toHaveLength(7);
    // Each labelled span carries *its own* offsets — not the offset of the
    // div that happened to sit at the same index (the old divs[i] fallback
    // gave i7 the offsets of the missing i6).
    const byText = new Map(map.spans.map((s) => [s.textContent, Number(s.dataset.start)]));
    expect(byText.get("i7")).toBe(14); // 7 items × 2 chars
    expect(byText.get("i0")).toBe(0);
    expect(byText.get("i5")).toBe(10);
    // No span may claim i6's range.
    for (const s of map.spans) {
      expect(Number(s.dataset.start)).not.toBe(12);
    }
  });
});

describe("reanchor", () => {
  // Multi-span page so the synthesized rect reveals which span (candidate)
  // the quote search landed on: x = spanStart / (1000 * pageWidth).
  const items = ["The Transformer uses ", "attention. ", "Attention is all you need."];
  const text = items.join("");

  beforeAll(() => {
    // happy-dom's Range.getClientRects reports zeros; synthesize a rect that
    // encodes the range's page-text start offset so tests can see *which*
    // candidate the quote search picked. x = startOffset / 1000.
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        let node: Node | null = this.startContainer;
        while (node && !(node instanceof HTMLElement && node.dataset.start !== undefined)) {
          node = node.parentNode;
        }
        const start = node instanceof HTMLElement ? Number(node.dataset.start) : 0;
        const rect = {
          x: start / 1000, y: 0, width: 10, height: 10,
          left: start / 1000, top: 0, right: start / 1000 + 10, bottom: 10,
          toJSON: () => ({}),
        };
        return [rect] as unknown as DOMRectList;
      },
    });
  });

  function setup(strs: string[]) {
    const pageEl = document.createElement("div");
    pageEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 1000, height: 1000, right: 1000, bottom: 1000, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const divTexts = strs.slice();
    // Reuse makePage for span tagging, then move the spans into a stubbed pageEl.
    const built = makePage(strs, divTexts);
    const spans = Array.from(built.pageEl.querySelectorAll("span"));
    for (const s of spans) {
      s.getBoundingClientRect = () =>
        ({ left: Number(s.dataset.start) / 1, top: 0, width: 10, height: 10, right: 0, bottom: 10, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      pageEl.appendChild(s);
    }
    document.body.appendChild(pageEl);
    return { pageEl, map: { ...built.map, spans } as PageTextMap };
  }

  function anchorAt(start: number, exactLen: number, exactOverride?: string, prefix = "", suffix = "") {
    return {
      version: 1 as const,
      pageIndex: 0,
      rects: [makeRect(0.42)],
      quote: { exact: exactOverride ?? text.slice(start, start + exactLen), prefix, suffix },
      position: { start, end: start + exactLen },
    };
  }

  it("trusts the stored rects when the position hint still matches", () => {
    const { pageEl, map } = setup(["The Transformer uses attention. Attention is all you need."]);
    const anchor = anchorAt(21, 9); // "attention"
    expect(map.text.slice(21, 30)).toBe("attention");
    const out = reanchor(anchor, map, pageEl);
    expect(out).toBe(anchor.rects); // stored rects win verbatim
  });

  it("falls back to quote search when position no longer matches", () => {
    const { pageEl, map } = setup(items);
    // Stale position (the text was edited upstream): quote search must
    // relocate "attention" at offset 21, inside the span covering [21, 32).
    const anchor = anchorAt(40, 9, "attention");
    const out = reanchor(anchor, map, pageEl);
    expect(out).not.toBeNull();
    expect(out).not.toBe(anchor.rects);
    expect(out![0].x).toBeCloseTo(21 / 1_000_000, 9);
  });

  it("disambiguates duplicate quotes via prefix/suffix", () => {
    const { pageEl, map } = setup(["alpha beta. ", "alpha beta. ", "end"]);
    // "alpha" occurs at 0 and 12; prefix "beta. " only fits the second.
    const anchor = anchorAt(50, 5, "alpha", "beta. ", "");
    const out = reanchor(anchor, map, pageEl);
    expect(out).not.toBeNull();
    expect(out![0].x).toBeCloseTo(12 / 1_000_000, 9);
  });

  it("returns null (orphan) when the quote is absent from the page text", () => {
    const { pageEl, map } = setup(items);
    const anchor = anchorAt(0, 10, "recurrence");
    expect(reanchor(anchor, map, pageEl)).toBeNull();
  });
});

describe("AnnotationAnchor contract", () => {
  const base = {
    version: 1 as const,
    pageIndex: 0,
    rects: [makeRect(0.1)],
    quote: { exact: "ok", prefix: "", suffix: "" },
    position: { start: 0, end: 2 },
  };

  it("accepts a well-formed anchor", () => {
    expect(AnnotationAnchor.safeParse(base).success).toBe(true);
  });

  it("rejects oversized selections (quote > 5000 chars)", () => {
    const big = { ...base, quote: { ...base.quote, exact: "x".repeat(5001) } };
    expect(AnnotationAnchor.safeParse(big).success).toBe(false);
  });

  it("rejects anchors with more than 200 rects", () => {
    const big = { ...base, rects: Array.from({ length: 201 }, () => makeRect(0.1)) };
    expect(AnnotationAnchor.safeParse(big).success).toBe(false);
  });
});
