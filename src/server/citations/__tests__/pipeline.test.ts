import { describe, expect, it } from "vitest";
import { analyzePaper } from "../pipeline";
import { fixtureFetch, fixturePdf } from "./helpers";

const MADRY = "1706.06083";

function assertNumericPdfLinksMatchEntryLabels(
  res: Awaited<ReturnType<typeof analyzePaper>>,
): number {
  const references = new Map(res.references.map((reference) => [reference.ordinal, reference]));
  let checked = 0;
  for (const context of res.contexts) {
    if (context.detectionMethod !== "pdf_link") continue;
    const numericText = context.markerText.replace(/[\[\],\s]/g, "");
    if (!/^\d+$/.test(numericText)) continue;
    const reference = references.get(context.refOrdinal);
    if (!reference || reference.numberLabel === null) continue;
    expect(reference.numberLabel).toBe(Number(numericText));
    checked++;
  }
  return checked;
}

describe("analyzePaper on fixtures", () => {
  it("extracts references, markers and resolves against recorded S2 data (Madry)", async () => {
    const res = await analyzePaper(fixturePdf(MADRY), { arxivId: MADRY, fetchImpl: fixtureFetch(MADRY) });
    console.log("[quality][madry]", JSON.stringify(res.stats));
    expect(assertNumericPdfLinksMatchEntryLabels(res)).toBeGreaterThan(0);
    expect(res.pageCount).toBeGreaterThan(10);
    expect(res.stats.refsFound).toBeGreaterThan(15);
    expect(res.stats.resolved).toBeGreaterThan(5);
    expect(res.stats.markersLinked).toBeGreaterThan(10);
    for (const c of res.contexts) {
      expect(c.sentence.length).toBeGreaterThan(10);
      expect(c.rects.length).toBeGreaterThan(0);
    }
    for (const r of res.references) {
      expect(r.searchUrl).toMatch(/^https:\/\/www\.semanticscholar\.org\/search\?q=/);
      if (r.matchStatus === "resolved") expect(r.work).not.toBeNull();
      else expect(r.work).toBeNull();
    }
  }, 120_000);

  it("works on a second arXiv fixture (Adam)", async () => {
    const id = "1412.6980";
    const res = await analyzePaper(fixturePdf(id), { arxivId: id, fetchImpl: fixtureFetch(id) });
    console.log("[quality][adam]", JSON.stringify(res.stats));
    assertNumericPdfLinksMatchEntryLabels(res);
    expect(res.stats.refsFound).toBeGreaterThan(5);
    expect(res.stats.resolved).toBeGreaterThan(0);
  }, 120_000);

  it("works on a third arXiv fixture (GAN)", async () => {
    const id = "1406.2661";
    const res = await analyzePaper(fixturePdf(id), { arxivId: id, fetchImpl: fixtureFetch(id) });
    console.log("[quality][gan]", JSON.stringify(res.stats));
    assertNumericPdfLinksMatchEntryLabels(res);
    expect(res.stats.refsFound).toBeGreaterThan(5);
    for (const r of res.references) {
      expect(r.searchUrl).toMatch(/^https:\/\/www\.semanticscholar\.org\/search\?q=/);
    }
  }, 120_000);

  it("works on a fourth arXiv fixture (Attention Is All You Need)", async () => {
    const id = "1706.03762";
    const res = await analyzePaper(fixturePdf(id), { arxivId: id, fetchImpl: fixtureFetch(id) });
    console.log("[quality][attention]", JSON.stringify(res.stats));
    expect(assertNumericPdfLinksMatchEntryLabels(res)).toBeGreaterThan(0);
    expect(res.pageCount).toBeGreaterThan(5);
    expect(res.stats.refsFound).toBeGreaterThan(15);
    expect(res.stats.markersLinked).toBeGreaterThan(10);
    expect(res.stats.resolved).toBeGreaterThanOrEqual(30);
    expect(res.stats.resolved + res.stats.ambiguous + res.stats.unresolved).toBe(
      res.stats.refsFound,
    );
    for (const context of res.contexts) {
      expect(context.sentence.length).toBeGreaterThan(10);
      expect(context.rects.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
