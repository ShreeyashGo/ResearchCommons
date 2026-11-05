import { describe, expect, it, vi } from "vitest";

const extractPdf = vi.fn();
vi.mock("@/server/citations/extract", () => ({ extractPdf: (...a: unknown[]) => extractPdf(...a) }));
vi.mock("@/server/supabase/admin", () => ({ createAdminClient: () => { throw new Error("pass a client"); } }));

const { getPaperPages, normalizePages } = await import("../text");

function fakeAdmin(opts: { cached?: unknown; storagePath?: string | null }) {
  const upserts: unknown[] = [];
  const downloads: string[] = [];
  const query = (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () =>
          table === "paper_texts"
            ? { data: opts.cached ? { pages: opts.cached } : null, error: null }
            : { data: { storage_path: opts.storagePath ?? null }, error: null },
      }),
    }),
    upsert: async (row: unknown) => {
      upserts.push(row);
      return { error: null };
    },
  });
  const admin = {
    from: query,
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloads.push(path);
          return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
        },
      }),
    },
  };
  return { admin: admin as never, upserts, downloads };
}

describe("normalizePages", () => {
  it("collapses whitespace and drops empty pages", () => {
    expect(
      normalizePages([
        { pageIndex: 0, text: "  a \n\n b  " },
        { pageIndex: 1, text: "   " },
        { pageIndex: 2, text: "c" },
      ]),
    ).toEqual([
      { pageIndex: 0, text: "a b" },
      { pageIndex: 2, text: "c" },
    ]);
  });
});

describe("getPaperPages", () => {
  it("returns cached pages without touching storage", async () => {
    extractPdf.mockReset();
    const { admin, downloads } = fakeAdmin({ cached: [{ pageIndex: 0, text: "hi" }], storagePath: "p.pdf" });
    expect(await getPaperPages("pid", admin)).toEqual([{ pageIndex: 0, text: "hi" }]);
    expect(downloads).toEqual([]);
    expect(extractPdf).not.toHaveBeenCalled();
  });

  it("extracts once and caches on a miss", async () => {
    extractPdf.mockReset().mockResolvedValue({ pages: [{ pageIndex: 0, text: " x  y " }], pageCount: 1 });
    const { admin, upserts, downloads } = fakeAdmin({ storagePath: "papers/p.pdf" });
    expect(await getPaperPages("pid", admin)).toEqual([{ pageIndex: 0, text: "x y" }]);
    expect(downloads).toEqual(["papers/p.pdf"]);
    expect(upserts).toMatchObject([{ paper_id: "pid", pages: [{ pageIndex: 0, text: "x y" }] }]);
  });

  it("returns null without a stored PDF or when extraction fails", async () => {
    extractPdf.mockReset().mockRejectedValue(new Error("bad pdf"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await getPaperPages("pid", fakeAdmin({ storagePath: null }).admin)).toBeNull();
    expect(await getPaperPages("pid", fakeAdmin({ storagePath: "p.pdf" }).admin)).toBeNull();
    warn.mockRestore();
  });
});
