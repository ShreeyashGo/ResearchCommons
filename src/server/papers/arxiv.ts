import "server-only";

import { HttpError, upstreamFailed, validationFailed } from "@/server/http/errors";

const ARXIV_ID_PATTERN =
  /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?/i;

export interface ArxivMetadata {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string | null;
  year: number | null;
  doi: string | null;
}

/**
 * Normalizes an arXiv reference to a bare id with no version suffix.
 * Accepts abs/pdf URLs (any host/subdomain), bare ids, and old-style
 * ids like `hep-th/9901001`. Returns null when nothing matches.
 */
export function normalizeArxivId(input: string): string | null {
  const match = ARXIV_ID_PATTERN.exec(input.trim());
  return match ? (match[1] ?? null) : null;
}

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeXml(collapseWhitespace(match[1] ?? "")) : null;
}

/** Fetch title/authors/abstract/year/doi for a normalized arXiv id. */
export async function fetchArxivMetadata(
  arxivId: string,
): Promise<ArxivMetadata> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  let xml: string;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      throw upstreamFailed(`arXiv API returned ${res.status}.`);
    }
    xml = await res.text();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw upstreamFailed("Could not reach the arXiv API.");
  }

  const entryMatch = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  const entry = entryMatch?.[1] ?? "";
  // arXiv signals a bad id list with an entry whose <id> is not an /abs/ link.
  const entryId = tag(entry, "id") ?? "";
  if (!entry || !entryId.includes("/abs/")) {
    throw validationFailed(`No arXiv paper found for "${arxivId}".`);
  }

  const title = tag(entry, "title");
  if (!title) {
    throw upstreamFailed("arXiv API returned an entry without a title.");
  }
  const authors = [...entry.matchAll(/<name[^>]*>([\s\S]*?)<\/name>/g)].map(
    (m) => decodeXml(collapseWhitespace(m[1] ?? "")),
  );
  const published = tag(entry, "published");
  const year = published ? Number.parseInt(published.slice(0, 4), 10) : NaN;

  return {
    arxivId,
    title,
    authors,
    abstract: tag(entry, "summary"),
    year: Number.isFinite(year) ? year : null,
    doi: tag(entry, "arxiv:doi"),
  };
}

/** Download the PDF for a normalized arXiv id; returns the raw bytes. */
export async function downloadArxivPdf(arxivId: string): Promise<Uint8Array> {
  const url = `https://arxiv.org/pdf/${encodeURIComponent(arxivId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw upstreamFailed("Could not download the PDF from arXiv.");
  }
  if (!res.ok) {
    throw upstreamFailed(`arXiv PDF download returned ${res.status}.`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isPdf(bytes)) {
    throw upstreamFailed("arXiv did not return a PDF document.");
  }
  return bytes;
}

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}
