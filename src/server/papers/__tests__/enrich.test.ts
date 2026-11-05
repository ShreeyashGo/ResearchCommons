import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPaperPages = vi.fn();
vi.mock("@/server/papers/text", () => ({
  getPaperPages: (...args: unknown[]) => getPaperPages(...args),
}));

const { enrichPaperMetadata } = await import("../enrich");

type Paper = {
  id: string;
  source: "upload" | "arxiv";
  title: string;
  authors: string[];
  year: number | null;
  abstract: string | null;
  doi: string | null;
};

function fakeAdmin(overrides: Partial<Paper> = {}) {
  const paper: Paper = {
    id: "paper-1",
    source: "upload",
    title: "Metadata Enrichment for Research Papers",
    authors: [],
    year: null,
    abstract: null,
    doi: null,
    ...overrides,
  };
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from: (table: string) => {
      if (table !== "papers") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: paper, error: null }),
          }),
        }),
        update: (values: Record<string, unknown>) => {
          updates.push(values);
          return {
            eq: async () => ({ error: null }),
          };
        },
      };
    },
  };
  return { admin: admin as never, paper, updates };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function openAlexWork(overrides: Record<string, unknown> = {}) {
  return {
    id: "https://openalex.org/W1",
    display_name: "Metadata Enrichment for Research Papers",
    publication_year: 2022,
    doi: "https://doi.org/10.1234/example",
    authorships: [{ author: { display_name: "Ada Lovelace" } }],
    abstract_inverted_index: {
      "This": [0],
      paper: [1],
      enriches: [2],
      metadata: [3],
    },
    ...overrides,
  };
}

beforeEach(() => {
  getPaperPages.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enrichPaperMetadata", () => {
  it("fills abstract and authors from the OpenAlex DOI endpoint", async () => {
    const { admin, updates } = fakeAdmin({ doi: "10.1234/example" });
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("/works/doi:10.1234%2Fexample");
      return jsonResponse(openAlexWork());
    });

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["abstract", "authors", "year"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([
      {
        abstract: "This paper enriches metadata",
        authors: ["Ada Lovelace"],
        year: 2022,
      },
    ]);
  });

  it("accepts a similar OpenAlex title-search result", async () => {
    const { admin, updates } = fakeAdmin();
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("api.openalex.org/works?");
      expect(new URL(url).searchParams.get("search")).toBe(
        "Metadata Enrichment for Research Papers",
      );
      return jsonResponse({ results: [openAlexWork()] });
    });

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["abstract", "authors", "year", "doi"] });
    expect(updates[0]).toMatchObject({
      abstract: "This paper enriches metadata",
      authors: ["Ada Lovelace"],
      year: 2022,
      doi: "10.1234/example",
    });
  });

  it("chooses the best title match from year-compatible OpenAlex results", async () => {
    const { admin, updates } = fakeAdmin({ year: 2020 });
    const wrongYear = openAlexWork({
      publication_year: 2018,
      authorships: [{ author: { display_name: "Wrong Author" } }],
      abstract_inverted_index: { Wrong: [0], year: [1] },
      doi: "https://doi.org/10.1111/wrong",
    });
    const rightYear = openAlexWork({
      publication_year: 2020,
      authorships: [{ author: { display_name: "Right Author" } }],
      abstract_inverted_index: { Right: [0], year: [1] },
      doi: "https://doi.org/10.2222/right",
    });
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ results: [wrongYear, rightYear] }),
    );

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["abstract", "authors", "doi"] });
    expect(updates).toEqual([
      {
        abstract: "Right year",
        authors: ["Right Author"],
        doi: "10.2222/right",
      },
    ]);
  });

  it("rejects a dissimilar OpenAlex result and fills fields from Crossref", async () => {
    const { admin, updates } = fakeAdmin();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api.openalex.org")) {
        return jsonResponse({
          results: [
            openAlexWork({ display_name: "A Completely Unrelated Article" }),
          ],
        });
      }
      return jsonResponse({
        message: {
          items: [
            {
              title: ["Metadata Enrichment for Research Papers"],
              author: [{ given: "Grace", family: "Hopper" }],
              issued: { "date-parts": [[2021]] },
              DOI: "https://doi.org/10.5555/crossref",
              abstract:
                "<jats:p>Abstract: Crossref abstract with <jats:italic>JATS</jats:italic> markup.</jats:p>",
            },
          ],
        },
      });
    });

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["abstract", "authors", "year", "doi"] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toContain(
      "query.bibliographic=Metadata",
    );
    expect(updates[0]).toEqual({
      abstract: "Crossref abstract with JATS markup.",
      authors: ["Grace Hopper"],
      year: 2021,
      doi: "10.5555/crossref",
    });
  });

  it("rejects Crossref title matches with incompatible years", async () => {
    const { admin, updates } = fakeAdmin({ year: 2020 });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("api.openalex.org")) {
        return jsonResponse({ results: [] });
      }
      return jsonResponse({
        message: {
          items: [
            {
              title: ["Metadata Enrichment for Research Papers"],
              author: [{ given: "Grace", family: "Hopper" }],
              issued: { "date-parts": [[2018]] },
              DOI: "10.5555/crossref",
              abstract: "An abstract that must not be written.",
            },
          ],
        },
      });
    });

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([]);
  });

  it("extracts an abstract from the first page when metadata sources omit it", async () => {
    const { admin, updates } = fakeAdmin({
      authors: ["Existing Author"],
      year: 2020,
    });
    const abstractText =
      "We present a detailed method for safely recovering metadata from academic papers. ".repeat(
        2,
      );
    getPaperPages.mockResolvedValue([
      {
        pageIndex: 0,
        text: `Abstract: ${abstractText}1 Introduction We begin here.`,
      },
    ]);
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("api.openalex.org")
        ? jsonResponse({ results: [] })
        : jsonResponse({ message: { items: [] } }),
    );

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["abstract"] });
    expect(getPaperPages).toHaveBeenCalledWith("paper-1", admin);
    expect(updates).toEqual([{ abstract: abstractText.trim() }]);
  });

  it("does not extract an abstract when the first page has no terminating heading", async () => {
    const { admin, updates } = fakeAdmin({
      authors: ["Existing Author"],
      year: 2020,
    });
    const bodyText =
      "This section describes the study and its findings in detail. ".repeat(3);
    getPaperPages.mockResolvedValue([
      { pageIndex: 0, text: `Abstract: ${bodyText}` },
    ]);
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("api.openalex.org")
        ? jsonResponse({ results: [] })
        : jsonResponse({ message: { items: [] } }),
    );

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: [] });
    expect(updates).toEqual([]);
  });

  it("does not overwrite fields edited while metadata lookups are in flight", async () => {
    const { admin, paper, updates } = fakeAdmin();
    const fetchImpl = vi.fn(async () => {
      paper.abstract = "A user-provided abstract.";
      paper.authors = ["User Author"];
      return jsonResponse({ results: [openAlexWork()] });
    });

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: ["year", "doi"] });
    expect(updates).toEqual([
      { year: 2022, doi: "10.1234/example" },
    ]);
  });

  it("preserves nonempty metadata and skips non-upload papers without fetching", async () => {
    const { admin, updates } = fakeAdmin({
      abstract: "A user-provided abstract.",
      doi: "10.1234/example",
    });
    const fetchImpl = vi.fn(async () => jsonResponse(openAlexWork()));

    await enrichPaperMetadata("paper-1", { admin, fetchImpl });
    expect(updates[0]).not.toHaveProperty("abstract");

    const otherPaper = fakeAdmin({
      source: "arxiv",
      authors: [],
      abstract: null,
    });
    const unusedFetch = vi.fn(async () => jsonResponse(openAlexWork()));
    await expect(
      enrichPaperMetadata("paper-1", {
        admin: otherPaper.admin,
        fetchImpl: unusedFetch,
      }),
    ).resolves.toEqual({ updated: [] });
    expect(unusedFetch).not.toHaveBeenCalled();
  });

  it("returns no updates when all external sources fail", async () => {
    const { admin, updates } = fakeAdmin({
      doi: "https://doi.org/10.1234/example",
    });
    let callCount = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      callCount += 1;
      if (callCount === 1) {
        expect(url).toContain("/works/doi:10.1234%2Fexample");
      }
      if (callCount === 3) {
        expect(url).toContain("/works/10.1234%2Fexample");
      }
      return new Response("", { status: 404 });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      enrichPaperMetadata("paper-1", { admin, fetchImpl }),
    ).resolves.toEqual({ updated: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(updates).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[enrich]"),
      expect.any(Error),
    );
  });
});
