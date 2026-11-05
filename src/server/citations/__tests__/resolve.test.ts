import { describe, expect, it, vi } from "vitest";
import {
  bareDoi,
  fetchOpenAlexByDoi,
  oaWorkToWork,
  rebuildAbstract,
} from "../resolve";

describe("bareDoi", () => {
  it("strips resolver URLs and a DOI prefix", () => {
    expect(bareDoi("  HTTPS://DX.DOI.ORG/10.1234/a-paper  ")).toBe(
      "10.1234/a-paper",
    );
    expect(bareDoi(" DOI:10.1234/a-paper ")).toBe("10.1234/a-paper");
    expect(bareDoi("https://doi.org/")).toBeNull();
    expect(bareDoi(undefined)).toBeNull();
  });
});

describe("rebuildAbstract", () => {
  it("orders words by position", () => {
    expect(
      rebuildAbstract({
        need: [3],
        all: [2],
        Attention: [0],
        is: [1],
      }),
    ).toBe("Attention is all need");
  });

  it("preserves repeated words and joins across gaps", () => {
    expect(rebuildAbstract({ useful: [0, 2], "research.": [4] })).toBe(
      "useful useful research.",
    );
  });

  it("returns null for missing, empty, or unusable indexes", () => {
    expect(rebuildAbstract(null)).toBeNull();
    expect(rebuildAbstract(undefined)).toBeNull();
    expect(rebuildAbstract({})).toBeNull();
    expect(rebuildAbstract({ word: [-1, 1.5] })).toBeNull();
  });
});

describe("OpenAlex work conversion", () => {
  it("rebuilds the abstract from OpenAlex's inverted index", () => {
    const work = oaWorkToWork({
      id: "https://openalex.org/W1",
      display_name: "A title",
      abstract_inverted_index: { words: [1], "A": [0] },
      doi: "https://doi.org/10.1234/a-paper",
    });
    expect(work?.abstract).toBe("A words");
    expect(work?.doi).toBe("10.1234/a-paper");
  });
});

describe("fetchOpenAlexByDoi", () => {
  it("requests the DOI endpoint with select and optional mailto parameters", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain(
        "https://api.openalex.org/works/doi:10.1234%2Fa-paper?",
      );
      return new Response(
        JSON.stringify({
          id: "https://openalex.org/W1",
          display_name: "A title",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await fetchOpenAlexByDoi("https://doi.org/10.1234/a-paper", {
      mailto: "reader@example.com",
      fetchImpl,
    });

    const [request] = fetchImpl.mock.calls;
    if (!request) throw new Error("OpenAlex fetch was not called.");
    const requestUrl = new URL(request[0]);
    expect(requestUrl.pathname).toBe("/works/doi:10.1234%2Fa-paper");
    expect(requestUrl.searchParams.get("select")).toContain(
      "abstract_inverted_index",
    );
    expect(requestUrl.searchParams.get("mailto")).toBe("reader@example.com");
  });

  it("returns null for a DOI that OpenAlex does not find", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));

    await expect(
      fetchOpenAlexByDoi("10.1234/missing", { fetchImpl }),
    ).resolves.toBeNull();
  });
});
