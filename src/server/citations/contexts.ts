import { isPageFurniture } from "./bibliography";
import type { BibEntry, CitationContextInsert, CitationMarker, PageText, TextLine } from "./types";

const ABBREV_RE = /(?:et\s+al|e\.g|i\.e|cf|vs|viz|fig|eq|sec|dr|mr|mrs|prof|no|approx|resp|cf|al|Inc|Ltd|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)$/i;
const MAX_SENTENCE = 900;
const MAX_PARAGRAPH = 4000;

/** Locate the line containing a marker's first rect center. */
function anchorLine(page: PageText, marker: CitationMarker): number {
  const r = marker.rects[0];
  if (!r) return -1;
  const cx = (r.x + r.w / 2) * page.widthPx;
  const cy = (r.y + r.h / 2) * page.heightPx;
  let best = -1;
  let bestDist = Infinity;
  page.lines.forEach((line, i) => {
    const dy = Math.abs(line.yMid - cy);
    const overlapsX = cx >= line.xMin - 30 && cx <= line.xMax + 30;
    const score = dy + (overlapsX ? 0 : 1000);
    if (dy < line.hPx * 1.6 && score < bestDist) {
      best = i;
      bestDist = score;
    }
  });
  return best;
}

/**
 * Expand around an anchor line into a paragraph: contiguous lines in reading order
 * (same column) separated by less than ~1.7x the line height.
 */
function paragraphAround(page: PageText, anchorIdx: number): string | null {
  if (anchorIdx < 0) return null;
  const lines = page.lines;
  const anchor = lines[anchorIdx];
  const gapLimit = anchor.hPx * 1.7;

  // Fragments of one visual line (e.g. a link item with different font metrics)
  // cluster into separate TextLines: merge same-row horizontally-adjacent
  // fragments too, but never across a column gutter.
  const canJoin = (a: TextLine, b: TextLine): boolean => {
    const gap = Math.abs(b.yMid - a.yMid);
    if (gap > gapLimit) return false;
    const overlapsX = a.xMin <= b.xMax + 8 && b.xMin <= a.xMax + 8;
    if (overlapsX) return true;
    const sameRow = gap < Math.min(a.hPx, b.hPx) * 0.4;
    const adjacent = a.xMax + 25 >= b.xMin && b.xMax + 25 >= a.xMin;
    return sameRow && adjacent;
  };

  let lo = anchorIdx;
  while (lo > 0 && canJoin(lines[lo - 1], lines[lo])) lo--;
  let hi = anchorIdx;
  while (hi < lines.length - 1 && canJoin(lines[hi], lines[hi + 1])) hi++;
  const text = lines
    .slice(lo, hi + 1)
    .map((l) => l.text)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, MAX_PARAGRAPH) : null;
}

function isSentenceBreak(text: string, dotIdx: number): boolean {
  const after = text.slice(dotIdx + 1).match(/^\s*(.)/)?.[1];
  if (!after || !/[A-Z0-9(\["'“‘]/.test(after)) return false;
  const before = text.slice(0, dotIdx + 1).match(/(\S+)\.$/);
  if (before && ABBREV_RE.test(before[1])) return false;
  // single-capital initial ("A. Author")
  const prevChar = text[dotIdx - 1] ?? "";
  const prevPrev = text[dotIdx - 2] ?? "";
  if (/[A-Z]/.test(prevChar) && /[\s,(]/.test(prevPrev)) return false;
  return true;
}

/** Extract the sentence containing position `pos` inside `text`. */
export function sentenceAt(text: string, pos: number): string {
  const n = text.length;
  let lo = pos;
  while (lo > 0) {
    const c = text[lo - 1];
    if ((c === "." || c === "!" || c === "?" || c === "\n") && isSentenceBreak(text, lo - 1)) break;
    lo--;
  }
  let hi = pos;
  while (hi < n) {
    const c = text[hi];
    if ((c === "." || c === "!" || c === "?" || c === "\n") && isSentenceBreak(text, hi)) {
      hi++;
      break;
    }
    hi++;
  }
  const sentence = text.slice(lo, hi).replace(/\s+/g, " ").trim();
  if (sentence.length <= MAX_SENTENCE) return sentence;
  return sentence.slice(0, MAX_SENTENCE - 1).trimEnd() + "…";
}

/**
 * Build a citation_contexts row for every marker: sentence + paragraph around it.
 * Markers whose context can't be located get a fallback sentence built from the
 * marker's own line text.
 */
export function buildContexts(
  markers: CitationMarker[],
  entriesByOrdinal: Map<number, BibEntry>,
  pages: PageText[],
): CitationContextInsert[] {
  const out: CitationContextInsert[] = [];
  const consumedOccurrences = new Map<string, number>();
  for (const m of markers) {
    if (!entriesByOrdinal.has(m.refOrdinal)) continue;
    const page = pages[m.pageIndex];
    if (!page) continue;
    const anchor = anchorLine(page, m);
    // markers inside running heads/footers (e.g. "Published as a conference
    // paper at ICLR 2017 [29].") are not in-text citations
    if (anchor >= 0 && isPageFurniture(page.lines[anchor].text)) continue;
    const paragraph = anchor >= 0 ? paragraphAround(page, anchor) : null;
    const anchorText = anchor >= 0 ? page.lines[anchor].text.replace(/\s+/g, " ").trim() : m.markerText;

    let sentence: string;
    const haystack = paragraph ?? anchorText;
    // repeated identical markers in one paragraph each take the next occurrence
    const seenKey = `${page.pageIndex}|${haystack.length}|${haystack.slice(0, 40)}|${m.markerText}`;
    const seenPos = consumedOccurrences.get(seenKey) ?? -1;
    let pos = haystack.indexOf(m.markerText, seenPos + 1);
    if (pos < 0) pos = haystack.indexOf(m.markerText);
    else consumedOccurrences.set(seenKey, pos + m.markerText.length - 1);
    if (pos >= 0) {
      sentence = sentenceAt(haystack, pos + Math.floor(m.markerText.length / 2));
    } else {
      // marker text not found verbatim (e.g. split across items): center on anchor line
      const p2 = Math.max(0, Math.floor(anchorText.length / 2));
      sentence = sentenceAt(anchorText, p2);
      if (!sentence || sentence.length < 8) sentence = anchorText.slice(0, MAX_SENTENCE);
    }
    if (sentence.length < 10 && paragraph && paragraph.length > sentence.length) {
      sentence = sentenceAt(paragraph, Math.floor(paragraph.length / 2));
      if (sentence.length < 10) sentence = paragraph.slice(0, MAX_SENTENCE);
    }
    if (!sentence) continue;
    out.push({
      refOrdinal: m.refOrdinal,
      pageIndex: m.pageIndex,
      markerText: m.markerText,
      sentence: sentence.slice(0, MAX_SENTENCE),
      paragraph,
      rects: m.rects,
      detectionMethod: m.method,
    });
  }
  return out;
}
