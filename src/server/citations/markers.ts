import { charsInRect, itemCharRectPx } from "./extract";
import { entryForDest } from "./bibliography";
import type { BibEntry, CitationMarker, ExtractedPaper, PageText } from "./types";
import type { NormalizedRect } from "@/contracts/annotations";

const CITE_DEST_RE = /^cite[.\-_]/i;
const NUMERIC_RE = /\[\s*\d{1,3}(?:\s*[,;]\s*\d{1,3}|\s*[-–—]\s*\d{1,3})*\s*\]/g;
const AUTHOR_YEAR_PAREN =
  /\(([A-Z][A-Za-zÀ-ÿ'’\-]+(?:(?:\s+et\s+al\.?)|(?:\s+(?:and|&)\s+[A-Z][A-Za-zÀ-ÿ'’\-]+))?)[,\s]+((?:19|20)\d{2})[a-z]?\)/g;
const AUTHOR_YEAR_INLINE =
  /([A-Z][A-Za-zÀ-ÿ'’\-]+(?:\s+et\s+al\.?|(?:\s+(?:and|&)\s+[A-Z][A-Za-zÀ-ÿ'’\-]+))?)\s*\(((?:19|20)\d{2})[a-z]?\)/g;
const MAX_RANGE_SPAN = 25;

function normalizeSurname(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Map a marker's char range in page.text to merged normalized rects (one per visual line). */
export function rectsForRange(page: PageText, start: number, end: number): NormalizedRect[] {
  const boxes: { x: number; y: number; w: number; h: number }[] = [];
  for (const item of page.items) {
    const a = Math.max(start, item.start) - item.start;
    const b = Math.min(end, item.end) - item.start;
    if (b <= a) continue;
    const r = itemCharRectPx(item, a, b);
    if (r) boxes.push(r);
  }
  // merge boxes sharing (approximately) the same y into line-level rects
  boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  const merged: { x: number; y: number; w: number; h: number }[] = [];
  for (const b of boxes) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(b.y - last.y) < 2 && b.x <= last.x + last.w + 6) {
      const nx = Math.min(last.x, b.x);
      const ny = Math.min(last.y, b.y);
      const nx2 = Math.max(last.x + last.w, b.x + b.w);
      const ny2 = Math.max(last.y + last.h, b.y + b.h);
      last.x = nx;
      last.y = ny;
      last.w = nx2 - nx;
      last.h = ny2 - ny;
    } else {
      merged.push({ ...b });
    }
  }
  return merged.map((b) => ({
    x: Math.min(1, Math.max(0, b.x / page.widthPx)),
    y: Math.min(1, Math.max(0, b.y / page.heightPx)),
    w: Math.min(1, Math.max(0, (b.x + b.w) / page.widthPx)) - Math.min(1, Math.max(0, b.x / page.widthPx)),
    h: Math.min(1, Math.max(0, (b.y + b.h) / page.heightPx)) - Math.min(1, Math.max(0, b.y / page.heightPx)),
  }));
}

function markerKey(m: CitationMarker): string {
  const r = m.rects[0];
  const cx = r ? (r.x + r.w / 2).toFixed(3) : "?";
  const cy = r ? (r.y + r.h / 2).toFixed(3) : "?";
  return `${m.pageIndex}|${m.refOrdinal}|${cx}|${cy}`;
}

/** Link-annotation markers: cite.* named destinations anchor each marker to its bibliography entry. */
function linkMarkers(extracted: ExtractedPaper, entries: BibEntry[]): CitationMarker[] {
  const out: CitationMarker[] = [];
  for (const page of extracted.pages) {
    for (const link of page.links) {
      if (!link.destName || !CITE_DEST_RE.test(link.destName)) continue;
      const target = extracted.citeTargets.get(link.destName);
      if (!target) continue;
      const entry = entryForDest(entries, target.pageIndex, target.yPx);
      if (!entry) continue;
      const text = page.items
        .map((it) => charsInRect(it, link.rectPx))
        .join("")
        .trim();
      out.push({
        pageIndex: page.pageIndex,
        refOrdinal: entry.ordinal,
        markerText: text || link.destName.replace(/^cite[.\-_]/i, ""),
        rects: [link.rect],
        method: "pdf_link",
      });
    }
  }
  return out;
}

function findEntryByNumber(entries: BibEntry[], n: number): BibEntry | undefined {
  return entries.find((e) => e.numberLabel === n);
}

function findEntriesByAuthorYear(entries: BibEntry[], surname: string, year: number): BibEntry[] {
  const want = normalizeSurname(surname);
  return entries.filter((e) => {
    if (e.year !== year) return false;
    const first = e.authors[0];
    if (!first) return false;
    const surnameGuess = normalizeSurname(first.split(" ").pop() ?? "");
    return surnameGuess === want;
  });
}

/** Expand "[1,2-4]" style inner text into reference numbers. */
function expandNumeric(inner: string): number[] {
  const out: number[] = [];
  for (const part of inner.split(/[,;]/)) {
    const range = part.trim().match(/^(\d{1,3})\s*[-–—]\s*(\d{1,3})$/);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b - a <= MAX_RANGE_SPAN) for (let n = a; n <= b; n++) out.push(n);
    } else {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n >= 1) out.push(n);
    }
  }
  return out;
}

function rectCenterInLinks(page: PageText, rects: NormalizedRect[]): boolean {
  const r = rects[0];
  if (!r) return false;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return page.links.some(
    (l) =>
      l.destName &&
      CITE_DEST_RE.test(l.destName) &&
      cx >= l.rect.x - 0.005 &&
      cx <= l.rect.x + l.rect.w + 0.005 &&
      cy >= l.rect.y - 0.005 &&
      cy <= l.rect.y + l.rect.h + 0.005,
  );
}

function surnameOf(markerName: string): string {
  return markerName.replace(/\s+et\s+al\.?$/i, "").split(/\s+(?:and|&)\s+/)[0].trim();
}

/** Regex fallback markers (numeric + author-year) not already covered by link annotations. */
function regexMarkers(extracted: ExtractedPaper, entries: BibEntry[]): CitationMarker[] {
  const out: CitationMarker[] = [];
  const numberedStyle = entries.some((e) => e.numberLabel !== null);
  const bibOrdinals = new Set(entries.map((e) => e.ordinal));
  const bibPages = new Set(entries.map((e) => e.pageIndex));
  const firstBibPage = Math.min(...bibPages, Number.MAX_SAFE_INTEGER);

  for (const page of extracted.pages) {
    if (page.pageIndex >= firstBibPage) break; // don't detect markers inside the bibliography itself
    const text = page.text;

    if (numberedStyle) {
      NUMERIC_RE.lastIndex = 0;
      for (const m of text.matchAll(NUMERIC_RE)) {
        const start = m.index;
        const end = start + m[0].length;
        const nums = expandNumeric(m[0].slice(1, -1));
        for (const n of nums) {
          const entry = findEntryByNumber(entries, n);
          if (!entry) continue;
          const rects = rectsForRange(page, start, end);
          if (rectCenterInLinks(page, rects)) continue;
          out.push({ pageIndex: page.pageIndex, refOrdinal: entry.ordinal, markerText: m[0], rects, method: "regex" });
        }
      }
    } else {
      for (const re of [AUTHOR_YEAR_PAREN, AUTHOR_YEAR_INLINE]) {
        re.lastIndex = 0;
        for (const m of text.matchAll(re)) {
          const surname = surnameOf(m[1]);
          const year = Number(m[2].slice(0, 4));
          const matches = findEntriesByAuthorYear(entries, surname, year);
          if (matches.length !== 1) continue; // 0 = unknown work; >1 = ambiguous marker, skip
          const start = m.index;
          const end = start + m[0].length;
          const rects = rectsForRange(page, start, end);
          if (rectCenterInLinks(page, rects)) continue;
          out.push({ pageIndex: page.pageIndex, refOrdinal: matches[0].ordinal, markerText: m[0], rects, method: "regex" });
        }
      }
    }
  }
  // drop markers referencing ordinals that don't exist (paranoia; findEntry* already constrains)
  return out.filter((m) => bibOrdinals.has(m.refOrdinal));
}

/**
 * Detect in-text citation markers: hyperref link annotations (cite.* dests) first,
 * then regex fallback for numeric and author-year markers not covered by links.
 */
export function detectMarkers(extracted: ExtractedPaper, entries: BibEntry[]): CitationMarker[] {
  const markers = [...linkMarkers(extracted, entries), ...regexMarkers(extracted, entries)];
  const seen = new Set<string>();
  return markers.filter((m) => {
    const k = markerKey(m);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
