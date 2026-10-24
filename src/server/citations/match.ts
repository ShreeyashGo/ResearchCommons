import type { BibEntry, ExternalWorkInsert } from "./types";

export const TITLE_MATCH_THRESHOLD = 0.85;
export const AMBIGUITY_WINDOW = 0.03;
export const YEAR_TOLERANCE = 1;

/** Normalize a title for comparison: lowercase, strip accents/punctuation, collapse spaces. */
export function normalizeTitle(t: string): string {
  return t
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(t: string): Set<string> {
  return new Set(normalizeTitle(t).split(" ").filter(Boolean));
}

/** Sørensen–Dice coefficient over token sets: 2|A∩B| / (|A|+|B|). */
export function titleSimilarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export interface MatchCandidate {
  work: ExternalWorkInsert;
}

export interface MatchOutcome {
  status: "resolved" | "unresolved" | "ambiguous";
  score: number | null;
  work: ExternalWorkInsert | null;
}

/**
 * Pick a match among candidates: requires title similarity >= 0.85 and, when both
 * years are known, |Δyear| <= 1. The match is ambiguous when a second qualifying
 * candidate scores within 0.03 of the best.
 */
export function pickMatch(entry: Pick<BibEntry, "title" | "year" | "rawText">, candidates: MatchCandidate[]): MatchOutcome {
  const title = entry.title ?? "";
  if (!title) return { status: "unresolved", score: null, work: null };

  const scored = candidates
    .map((c) => ({ c, sim: titleSimilarity(title, c.work.title) }))
    .filter(
      ({ c, sim }) =>
        sim >= TITLE_MATCH_THRESHOLD &&
        (entry.year == null || c.work.year == null || Math.abs(entry.year - c.work.year) <= YEAR_TOLERANCE),
    )
    .sort((a, b) => b.sim - a.sim);

  if (scored.length === 0) return { status: "unresolved", score: null, work: null };
  const best = scored[0];
  const second = scored[1];
  if (second && best.sim - second.sim <= AMBIGUITY_WINDOW) {
    return { status: "ambiguous", score: best.sim, work: null };
  }
  return { status: "resolved", score: best.sim, work: best.c.work };
}

/** Fallback search link for unresolved/ambiguous references. Never a guessed match. */
export function deriveSearchUrl(entry: Pick<BibEntry, "title" | "rawText">): string {
  const q = (entry.title ?? entry.rawText).replace(/\s+/g, " ").trim().slice(0, 200);
  return `https://www.semanticscholar.org/search?q=${encodeURIComponent(q)}&sort=relevance`;
}

/** Detect an explicit arXiv id inside a bibliography entry's raw text. */
export function arxivIdInText(text: string): string | null {
  const m =
    /arxiv[:\s]*(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(text) ??
    /\b((?:0[7-9]|1\d|2\d)\d{2}\.\d{4,5})(?:v\d+)?\b/.exec(text);
  return m ? m[1] : null;
}
