import { describe, expect, it } from "vitest";
import { extractPdf } from "../extract";
import { parseBibliography } from "../bibliography";
import { detectMarkers } from "../markers";
import { fixturePdf } from "./helpers";

describe("detectMarkers (Madry fixture)", () => {
  it("finds hyperref link markers plus regex fallback", async () => {
    const ex = await extractPdf(await fixturePdf("1706.06083"));
    const entries = parseBibliography(ex.pages);
    const markers = detectMarkers(ex, entries);
    expect(markers.length).toBeGreaterThan(20);

    const byMethod = new Map<string, number>();
    for (const m of markers) byMethod.set(m.method, (byMethod.get(m.method) ?? 0) + 1);
    expect(byMethod.get("pdf_link") ?? 0).toBeGreaterThan(0);

    // every marker maps to a real bibliography ordinal and carries a rect
    const ordinals = new Set(entries.map((e) => e.ordinal));
    for (const m of markers) {
      expect(ordinals.has(m.refOrdinal)).toBe(true);
      expect(m.rects.length).toBeGreaterThan(0);
      for (const r of m.rects) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThanOrEqual(1);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeLessThanOrEqual(1);
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
      }
      // regex markers never appear on bibliography pages (link markers may
      // legitimately appear in an appendix after the references)
      if (m.method !== "pdf_link") {
        const firstBibPage = entries[0]?.pageIndex ?? Infinity;
        expect(m.pageIndex).toBeLessThan(firstBibPage);
      }
    }

    // distinct reference ordinals get markers (not only a single ref)
    const markedRefs = new Set(markers.map((m) => m.refOrdinal));
    expect(markedRefs.size).toBeGreaterThan(10);
  });
});
