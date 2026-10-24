import "server-only";

import { parseServerEnv, serverEnvSchema } from "@/server/env";
import { arxivIdInText, deriveSearchUrl, pickMatch, type MatchCandidate } from "./match";
import type { BibEntry, ExternalWorkInsert, ResolvedReference } from "./types";

const S2_FIELDS =
  "title,authors,year,abstract,externalIds,venue,url,openAccessPdf,paperId,isOpenAccess";
const OA_SELECT =
  "id,display_name,publication_year,doi,authorships,primary_location,open_access,ids";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** fetch with bounded retries; honors Retry-After and backs off on 429/5xx. */
export async function fetchJsonWithBackoff(
  url: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
  maxAttempts = 4,
): Promise<unknown> {
  let attempt = 0;
  let delay = 500;
  for (;;) {
    attempt++;
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      if (attempt >= maxAttempts) throw err;
      await sleep(delay);
      delay *= 2;
      continue;
    }
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15000) : delay);
      delay *= 2;
      continue;
    }
    const body = await res.text().catch(() => "");
    throw new Error(`GET ${url} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

// ---------------------------------------------------------------------------
// Semantic Scholar
// ---------------------------------------------------------------------------
interface S2Author {
  name?: string;
}
interface S2Paper {
  paperId: string | null;
  title?: string;
  authors?: S2Author[];
  year?: number | null;
  abstract?: string | null;
  externalIds?: Record<string, string | undefined> | null;
  venue?: string | null;
  url?: string | null;
  openAccessPdf?: { url?: string } | null;
}
export interface S2ReferencesResponse {
  data?: Array<{ citedPaper?: S2Paper | null }>;
}

function s2PaperToWork(p: S2Paper): ExternalWorkInsert | null {
  if (!p.title) return null;
  const externalId = p.paperId ?? p.externalIds?.DOI ?? p.externalIds?.ArXiv ?? null;
  if (!externalId) return null;
  return {
    source: "semantic_scholar",
    externalId,
    title: p.title,
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? null,
    venue: p.venue ?? null,
    abstract: p.abstract ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxivId: p.externalIds?.ArXiv ?? null,
    url: p.url ?? null,
    openAccessPdfUrl: p.openAccessPdf?.url ?? null,
  };
}

export async function fetchS2References(
  arxivId: string,
  opts: { apiKey?: string; fetchImpl?: FetchLike } = {},
): Promise<MatchCandidate[]> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.apiKey) headers["x-api-key"] = opts.apiKey;
  const url = `https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(
    arxivId,
  )}/references?fields=${S2_FIELDS}&limit=1000`;
  const json = (await fetchJsonWithBackoff(url, { headers }, opts.fetchImpl)) as S2ReferencesResponse;
  return (json.data ?? [])
    .map((d) => (d.citedPaper ? s2PaperToWork(d.citedPaper) : null))
    .filter((w): w is ExternalWorkInsert => w !== null)
    .map((work) => ({ work }));
}

// ---------------------------------------------------------------------------
// OpenAlex
// ---------------------------------------------------------------------------
interface OaAuthorship {
  author?: { display_name?: string };
}
export interface OaWork {
  id?: string;
  display_name?: string;
  publication_year?: number | null;
  doi?: string | null;
  authorships?: OaAuthorship[];
  primary_location?: { landing_page_url?: string | null; source?: { display_name?: string | null } | null } | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null };
  ids?: { arxiv?: string; doi?: string };
}
export interface OaSearchResponse {
  results?: OaWork[];
}

function oaWorkToWork(w: OaWork): ExternalWorkInsert | null {
  if (!w.id || !w.display_name) return null;
  const arxivUrl = w.ids?.arxiv;
  const arxivId = arxivUrl ? /([^/]+)$/.exec(arxivUrl.replace(/\.pdf$/, ""))?.[1]?.replace(/^abs\//, "") ?? null : null;
  return {
    source: "openalex",
    externalId: w.id.replace(/^https?:\/\/openalex\.org\//, ""),
    title: w.display_name,
    authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    abstract: null, // OpenAlex returns inverted indexes; not fetched for MVP
    doi: w.doi ?? w.ids?.doi ?? null,
    arxivId,
    url: w.primary_location?.landing_page_url ?? w.id,
    openAccessPdfUrl: w.open_access?.oa_url ?? null,
  };
}

export async function searchOpenAlex(
  title: string,
  opts: { mailto?: string; fetchImpl?: FetchLike } = {},
): Promise<MatchCandidate[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", title.slice(0, 300));
  url.searchParams.set("per-page", "5");
  url.searchParams.set("select", OA_SELECT);
  if (opts.mailto) url.searchParams.set("mailto", opts.mailto);
  const json = (await fetchJsonWithBackoff(url.toString(), { headers: { accept: "application/json" } }, opts.fetchImpl)) as OaSearchResponse;
  return (json.results ?? [])
    .map(oaWorkToWork)
    .filter((w): w is ExternalWorkInsert => w !== null)
    .map((work) => ({ work }));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export interface ResolveOptions {
  arxivId: string | null;
  fetchImpl?: FetchLike;
  s2ApiKey?: string;
  contactEmail?: string;
}

/**
 * Resolve bibliography entries to external works.
 * arXiv papers: match entries against the Semantic Scholar reference list
 * (normalized title similarity >= 0.85, year ±1); entries that stay unresolved
 * and non-arXiv papers fall back to an OpenAlex title search with the same
 * thresholds. Never fabricates a match.
 */
export async function resolveReferences(entries: BibEntry[], opts: ResolveOptions): Promise<ResolvedReference[]> {
  // optional env (absent in offline tests)
  const env = serverEnvSchema.safeParse(process.env).success ? parseServerEnv() : null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = opts.s2ApiKey ?? env?.S2_API_KEY;
  const mailto = opts.contactEmail ?? env?.CONTACT_EMAIL;

  let s2Candidates: MatchCandidate[] = [];
  let s2Failed = false;
  if (opts.arxivId) {
    try {
      s2Candidates = await fetchS2References(opts.arxivId, { apiKey, fetchImpl });
    } catch (err) {
      s2Failed = true;
      console.warn(`[citations] S2 references fetch failed for arXiv:${opts.arxivId}:`, err);
    }
  }

  const out: ResolvedReference[] = [];
  for (const entry of entries) {
    let status: ResolvedReference["matchStatus"] = "unresolved";
    let score: number | null = null;
    let method: string | null = null;
    let work: ExternalWorkInsert | null = null;

    // Direct arXiv id inside the entry text beats title matching.
    const entryArxiv = arxivIdInText(entry.rawText);
    const direct = entryArxiv
      ? s2Candidates.find((c) => c.work.arxivId === entryArxiv)
      : undefined;
    if (direct) {
      status = "resolved";
      score = 1;
      method = "s2_arxiv_id";
      work = direct.work;
    } else if (s2Candidates.length > 0) {
      const m = pickMatch(entry, s2Candidates);
      status = m.status;
      score = m.score;
      method = m.status === "unresolved" ? null : "s2_reference_list";
      work = m.work;
    }

    if (status === "unresolved" && entry.title) {
      try {
        const oa = await searchOpenAlex(entry.title, { mailto, fetchImpl });
        const m = pickMatch(entry, oa);
        if (m.status !== "unresolved") {
          status = m.status;
          score = m.score;
          method = "openalex_title_search";
          work = m.work;
        }
      } catch (err) {
        console.warn(`[citations] OpenAlex search failed for "${entry.title.slice(0, 60)}":`, err);
      }
    }

    out.push({
      ...entry,
      matchStatus: status,
      matchScore: score,
      matchMethod: method,
      work,
      searchUrl: deriveSearchUrl(entry),
    });
  }

  if (s2Failed && s2Candidates.length === 0) {
    console.warn("[citations] S2 unavailable; relied on OpenAlex/arxiv-id only");
  }
  return out;
}
