import { describe, expect, it } from "vitest";
import { normalizeArxivId } from "@/server/papers/arxiv";

describe("normalizeArxivId", () => {
  it("accepts bare new-style ids", () => {
    expect(normalizeArxivId("1706.03762")).toBe("1706.03762");
    expect(normalizeArxivId("2412.12345")).toBe("2412.12345");
  });

  it("strips version suffixes", () => {
    expect(normalizeArxivId("1706.03762v7")).toBe("1706.03762");
    expect(normalizeArxivId("https://arxiv.org/abs/1706.03762v3")).toBe(
      "1706.03762",
    );
  });

  it("handles abs and pdf URLs", () => {
    expect(normalizeArxivId("https://arxiv.org/abs/1706.03762")).toBe(
      "1706.03762",
    );
    expect(normalizeArxivId("https://arxiv.org/pdf/1706.03762")).toBe(
      "1706.03762",
    );
    expect(normalizeArxivId("https://arxiv.org/pdf/1706.03762.pdf")).toBe(
      "1706.03762",
    );
    expect(normalizeArxivId("arxiv.org/pdf/1706.03762v2.pdf")).toBe(
      "1706.03762",
    );
  });

  it("normalizes old-style archive ids", () => {
    expect(normalizeArxivId("hep-th/9901001")).toBe("hep-th/9901001");
    expect(normalizeArxivId("hep-th/9901001v2")).toBe("hep-th/9901001");
    expect(normalizeArxivId("https://arxiv.org/abs/hep-th/9901001")).toBe(
      "hep-th/9901001",
    );
    expect(normalizeArxivId("math.GT/0309136")).toBe("math.GT/0309136");
  });

  it("rejects non-arxiv input", () => {
    expect(normalizeArxivId("not an id")).toBeNull();
    expect(normalizeArxivId("12345")).toBeNull();
    expect(normalizeArxivId("https://example.com/paper")).toBeNull();
  });
});
