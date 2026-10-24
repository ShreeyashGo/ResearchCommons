import { describe, expect, it } from "vitest";
import { buildContexts, sentenceAt } from "../contexts";
import { extractPdf } from "../extract";
import { parseBibliography } from "../bibliography";
import { detectMarkers } from "../markers";
import { fixturePdf } from "./helpers";

describe("sentenceAt", () => {
  const para =
    "First sentence is here. We follow Tramer et al. 2017 [29] closely. Third sentence follows.";

  it("returns the sentence containing the position", () => {
    const s = sentenceAt(para, para.indexOf("Tramer"));
    expect(s).toContain("Tramer");
    expect(s).toContain("2017 [29]");
    expect(s).not.toContain("First sentence");
    expect(s).not.toContain("Third sentence");
  });

  it("does not break after abbreviations or initials", () => {
    const t = "This was shown by A. Smith et al. recently in 2020. Next one.";
    expect(sentenceAt(t, t.indexOf("Smith"))).toContain("This was shown");
    const u = "See e.g. the method by Smith (2020). Another.";
    expect(sentenceAt(u, u.indexOf("Smith"))).toContain("e.g.");
  });

  it("clamps very long sentences", () => {
    const long = `${"x ".repeat(600)}end.`;
    expect(sentenceAt(long, 10).length).toBeLessThanOrEqual(901);
  });
});

describe("buildContexts (Madry fixture)", () => {
  it("emits sentence+paragraph+rects per marker and skips page furniture", async () => {
    const ex = await extractPdf(await fixturePdf("1706.06083"));
    const entries = parseBibliography(ex.pages);
    const markers = detectMarkers(ex, entries);
    const byOrdinal = new Map(entries.map((e) => [e.ordinal, e]));
    const contexts = buildContexts(markers, byOrdinal, ex.pages);

    expect(contexts.length).toBeGreaterThan(20);
    for (const c of contexts) {
      expect(c.sentence.length).toBeGreaterThan(10);
      expect(c.rects.length).toBeGreaterThan(0);
      // running heads/footers never become contexts
      expect(c.sentence).not.toMatch(/^published as a conference/i);
    }
    // no duplicate marker->ref at the same spot
    const keys = contexts.map((c) => `${c.pageIndex}:${c.markerText}:${c.rects[0]?.y.toFixed(3)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
