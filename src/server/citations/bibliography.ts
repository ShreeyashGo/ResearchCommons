import type { BibEntry, PageText, TextLine } from "./types";

const HEADING_RE = /^\s*(?:\d+\.?\s*)?(r\s*eferences|bibliography|l\s*iterature\s+cited)\s*\.?\s*$/i;
const STOP_HEADING_RE = /^\s*(?:[A-Z]\.?\s+)?(appendix|appendices|supplementary|supplemental|acknowledg|a\s+proofs?)\b/i;
const SECTION_HEADING_RE = /^\s*(?:[A-Z]|\d+)(?:\.\d+)*\.?\s+[A-Z0-9]/;
const PAGE_FURNITURE_RE = /^\s*(?:published as a|conference paper at)/i;
const NUMBERED_START_RE = /^\s*\[(\d{1,3})\]\s*/;
const NUMBERED_DOT_RE = /^\s*(\d{1,3})\.\s+/;
const YEAR_RE = /\b(1[6-9]\d{2}|20\d{2})[a-z]?\b/g;

const VENUE_MARKERS = new RegExp(
  "^(in|proc\\.?|proceedings|journal|transactions|trans\\.?|arxiv|preprint|volume|vol\\.?|pp\\.?|pages|" +
    "advances in|international|conference|workshop|symposium|annual|ieee|acm|nips|neurips|icml|iclr|cvpr|iccv|" +
    "eccv|acl|emnlp|naacl|aaai|ijcai|uai|aistats|jmlr|nature|science|springer|mit press|phd|master|technical report|" +
    "coRR|available|http|www\\.|doi)",
  "i",
);

interface LineRef {
  pageIndex: number;
  line: TextLine;
}

function isHeading(text: string): boolean {
  return HEADING_RE.test(text.replace(/\s+/g, " ").trim());
}

function isStopHeading(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length > 80) return false;
  if (STOP_HEADING_RE.test(t)) return true;
  // Numbered/lettered section heading with mostly-uppercase text: "10.1 CONVERGENCE PROOF", "A Appendix".
  if (SECTION_HEADING_RE.test(t)) {
    const rest = t.replace(SECTION_HEADING_RE, "").replace(/[^A-Za-z]/g, "");
    if (rest.length > 0) {
      const upper = rest.replace(/[^A-Z]/g, "").length;
      if (upper / rest.length > 0.6) return true;
    }
  }
  return false;
}

/** Running heads / page numbers that pollute line sequences between pages. */
export function isPageFurniture(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (/^\d{1,4}$/.test(t)) return true; // bare page number
  return t.length <= 70 && PAGE_FURNITURE_RE.test(t);
}

/** Collect bibliography lines in reading order across pages. */
function collectBibLines(pages: PageText[]): { lines: LineRef[]; startPageIndex: number } | null {
  // Find the LAST heading-like line anywhere; references live near the end.
  let headingAt: { pageIndex: number; lineIdx: number } | null = null;
  for (const page of pages) {
    page.lines.forEach((line, idx) => {
      if (isHeading(line.text)) headingAt = { pageIndex: page.pageIndex, lineIdx: idx };
    });
  }
  if (!headingAt) return null;

  const { pageIndex: startPage, lineIdx: startLine } = headingAt;
  const out: LineRef[] = [];
  for (let pi = startPage; pi < pages.length; pi++) {
    const lines = pages[pi].lines;
    for (let li = pi === startPage ? startLine + 1 : 0; li < lines.length; li++) {
      const line = lines[li];
      const t = line.text.trim();
      if (!t) continue;
      if (isPageFurniture(t)) continue;
      // stop once real entries have been collected and a new section starts
      if (out.length >= 3 && isStopHeading(t)) return { lines: out, startPageIndex: startPage };
      out.push({ pageIndex: pi, line });
    }
  }
  return { lines: out, startPageIndex: startPage };
}

/** Split "Surname, I. M." into given-first form when possible. */
function normalizeAuthorName(chunk: string): string {
  const t = chunk.replace(/\s+/g, " ").trim();
  const m = /^([^,]{1,80}?),\s+((?:[A-Z][\w'’.-]*\.?\s*){1,5})$/.exec(t);
  if (m) return `${m[2].trim()} ${m[1].trim()}`;
  return t;
}

export function splitAuthorList(segment: string): string[] {
  const cleaned = segment.replace(/\bet\s+al\b\.?/gi, "");
  const authors: string[] = [];
  // "A. One and B. Two" / "A One, B Two & C Three" parts first
  for (const part of cleaned.split(/\s+(?:and|&)\s+|;\s*/i)) {
    const chunks = part
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length <= 2) {
      // "Surname, Given" or "Given Surname"
      const t = chunks.join(", ").trim();
      if (t) authors.push(t);
      continue;
    }
    // "Surname, Given, Surname2, Given2, ...": pair consecutive chunks.
    for (let i = 0; i + 1 < chunks.length; i += 2) {
      authors.push(`${chunks[i]}, ${chunks[i + 1]}`);
    }
    if (chunks.length % 2 === 1) authors.push(chunks[chunks.length - 1]);
  }
  return authors
    .map(normalizeAuthorName)
    .map((s) => s.replace(/^[,\s]+|[,\s.]+$/g, "").trim())
    .filter((s) => s.length >= 2 && /[a-zà-ÿ]/i.test(s));
}

/**
 * Split a bibliography entry into "sentences" without breaking on initials
 * ("A." or "M. S." inside author lists).
 */
export function splitEntrySentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    const prev = text[i - 1] ?? "";
    const next = text[i + 1] ?? "";
    // break only when '.' is followed by whitespace + capital/digit/quote/bracket,
    // and NOT preceded by a single capital letter (initial).
    if (!/\s/.test(next) && next !== "") continue;
    const after = text.slice(i + 1).match(/^\s*(.)/)?.[1] ?? "";
    if (after && !/[A-Z0-9(\["'“‘]/.test(after)) continue;
    if (/[A-Z]/.test(prev) && /[\s,]/.test(text[i - 2] ?? " ")) {
      // single-capital initial: keep going when the next token is another
      // initial or a list separator (", and"), else it ends the author segment.
      const afterToken = text.slice(i + 1).match(/^\s*(\S+)/)?.[1] ?? "";
      if (/^[A-Z]\./.test(afterToken) || /^(and|&|,)/.test(afterToken)) continue;
    }
    out.push(text.slice(start, i + 1).trim());
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter((s) => s.length > 0);
}

export function extractYear(text: string): number | null {
  let year: number | null = null;
  for (const m of text.matchAll(YEAR_RE)) {
    const y = Number(m[0].slice(0, 4));
    if (y <= new Date().getFullYear() + 1) year = y;
  }
  return year;
}

function parseEntryText(raw: string): { title: string | null; authors: string[]; year: number | null } {
  // join wrapped lines; undo hyphenation ("Im-\nproving" -> "Improving")
  const text = raw
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .replace(NUMBERED_START_RE, "")
    .replace(NUMBERED_DOT_RE, "")
    .trim();
  const year = extractYear(text);
  const sentences = splitEntrySentences(text);
  if (sentences.length === 0) return { title: null, authors: [], year };

  const authors = splitAuthorList(sentences[0]);

  // Title = the segment after authors; merge following segments while they are
  // short and not venue-like (multi-sentence titles are rare but exist).
  let title = "";
  for (let i = 1; i < sentences.length; i++) {
    const seg = sentences[i];
    if (VENUE_MARKERS.test(seg)) break;
    title = title ? `${title} ${seg}` : seg;
  }
  title = title
    .replace(/^["'“‘]+|["'”’]+$/g, "")
    .replace(/[.\s]+(1[6-9]\d{2}|20\d{2})[a-z]?[.\s]*$/i, "")
    .replace(/[.\s]+$/, "")
    .trim();
  if (title.length < 4 || title.length > 500) title = "";
  return { title: title || null, authors, year };
}

interface RawEntry {
  numberLabel: number | null;
  pageIndex: number;
  lines: TextLine[];
}

function isEntryStart(l: LineRef, marginX: number, numbered: boolean): boolean {
  const t = l.line.text;
  if (numbered) return NUMBERED_START_RE.test(t) || NUMBERED_DOT_RE.test(t);
  // hanging indent heuristic: first line of an entry is flush to the margin.
  return l.line.xMin <= marginX + 2.5 && t.trim().length > 0;
}

/**
 * Partition collected bibliography lines into column groups (page order, then
 * column order). A page is treated as two-column when the sorted line xMins
 * contain a gutter gap > 15% of the page width; entry splitting then runs per
 * column so hanging indents and reading order stay correct.
 */
function splitColumns(lines: LineRef[], pageWidth: (pageIndex: number) => number): LineRef[][] {
  const byPage = new Map<number, LineRef[]>();
  for (const l of lines) {
    const arr = byPage.get(l.pageIndex) ?? [];
    arr.push(l);
    byPage.set(l.pageIndex, arr);
  }
  const groups: LineRef[][] = [];
  for (const pageIndex of [...byPage.keys()].sort((a, b) => a - b)) {
    const pageLines = byPage.get(pageIndex) ?? [];
    const width = pageWidth(pageIndex);
    const xs = [...new Set(pageLines.map((l) => l.line.xMin))].sort((a, b) => a - b);
    let gutter = -1;
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] > width * 0.15) gutter = (xs[i] + xs[i - 1]) / 2;
    }
    if (gutter < 0) {
      groups.push(pageLines);
    } else {
      const left = pageLines.filter((l) => l.line.xMin < gutter);
      const right = pageLines.filter((l) => l.line.xMin >= gutter);
      if (left.length >= 2 && right.length >= 2) {
        groups.push(left, right);
      } else {
        groups.push(pageLines);
      }
    }
  }
  return groups;
}

/**
 * Locate the References/Bibliography section and parse its entries.
 * Handles numbered ("[1]", "1.") and author-year (hanging-indent) styles.
 */
export function parseBibliography(pages: PageText[]): BibEntry[] {
  const collected = collectBibLines(pages);
  if (!collected || collected.lines.length < 3) return [];
  const { lines } = collected;

  const numberedStarts = lines.filter((l) => NUMBERED_START_RE.test(l.line.text) || NUMBERED_DOT_RE.test(l.line.text));
  const numbered = numberedStarts.length >= 3;

  const pageWidth = (i: number) => pages[i]?.widthPx || 612;

  const rawEntries: RawEntry[] = [];
  for (const group of splitColumns(lines, pageWidth)) {
    // left margin = minimum xMin over this column's bib lines
    const marginX = Math.min(...group.map((l) => l.line.xMin));
    let cur: RawEntry | null = null;
    for (const l of group) {
      if (isEntryStart(l, marginX, numbered)) {
        const m = NUMBERED_START_RE.exec(l.line.text) ?? NUMBERED_DOT_RE.exec(l.line.text);
        cur = { numberLabel: m ? Number(m[1]) : null, pageIndex: l.pageIndex, lines: [] };
        rawEntries.push(cur);
      }
      if (!cur) continue; // preamble line between heading and first entry
      cur.lines.push(l.line);
    }
  }

  const entries: BibEntry[] = [];
  rawEntries.forEach((re) => {
    const rawText = re.lines.map((l) => l.text).join("\n").trim();
    if (rawText.length < 12) return;
    const { title, authors, year } = parseEntryText(rawText);
    const ordinal = entries.length + 1;
    const firstSurname = authors[0]?.split(" ").pop() ?? "";
    entries.push({
      ordinal,
      numberLabel: re.numberLabel,
      label:
        re.numberLabel !== null
          ? String(re.numberLabel)
          : firstSurname && year
            ? `${firstSurname}${authors.length > 1 ? " et al." : ""}, ${year}`
            : String(ordinal),
      rawText,
      title,
      authors,
      year,
      pageIndex: re.pageIndex,
      yTopPx: re.lines[0].yMid - re.lines[0].hPx,
      yBottomPx: re.lines[re.lines.length - 1].yMid + re.lines[re.lines.length - 1].hPx,
    });
  });
  return entries;
}

/**
 * Map a cite.* destination (pageIndex + anchor y) to a bibliography entry.
 * Prefers the entry whose [yTopPx, yBottomPx] contains the anchor; otherwise
 * the nearest entry by |y - yMid| (dest anchors land within ~half a line
 * height of the intended entry, including just above its top).
 */
export function entryForDest(entries: BibEntry[], pageIndex: number, yPx: number): BibEntry | null {
  const onPage = entries.filter((e) => e.pageIndex === pageIndex).sort((a, b) => a.yTopPx - b.yTopPx);
  if (onPage.length === 0) return null;
  const contained = onPage.find((e) => yPx >= e.yTopPx && yPx <= e.yBottomPx);
  if (contained) return contained;
  let best: BibEntry = onPage[0];
  let bestDist = Infinity;
  for (const e of onPage) {
    const dist = Math.abs(yPx - (e.yTopPx + e.yBottomPx) / 2);
    if (dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}
