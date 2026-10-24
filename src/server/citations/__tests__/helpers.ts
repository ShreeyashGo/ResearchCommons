import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchLike } from "../resolve";

const FIXTURES = path.join(process.cwd(), "fixtures", "papers");

export function fixtureDir(arxivId: string): string {
  return path.join(FIXTURES, arxivId);
}

export function fixturePdf(arxivId: string): Buffer {
  return readFileSync(path.join(fixtureDir(arxivId), "paper.pdf"));
}

/**
 * Offline fetch: routes Semantic Scholar and OpenAlex calls to the recorded
 * responses committed under fixtures/papers/.
 */
export function fixtureFetch(arxivId: string): FetchLike {
  return async (url: string) => {
    if (url.includes("api.semanticscholar.org")) {
      if (url.includes(`/paper/arXiv:${arxivId}/references`)) {
        const json = readFileSync(path.join(fixtureDir(arxivId), "s2-references.json"), "utf8");
        return new Response(json, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    }
    if (url.includes("api.openalex.org")) {
      const q = new URL(url).searchParams.get("search") ?? "";
      const file = path.join(FIXTURES, "_shared", `openalex-${slug(q)}.json`);
      try {
        return new Response(readFileSync(file, "utf8"), { status: 200 });
      } catch {
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
    }
    return new Response("unexpected url", { status: 404 });
  };
}

function slug(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}
