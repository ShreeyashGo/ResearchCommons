import type { AnnotationAnchor, NormalizedRect } from "@/contracts";
import type { TextContent } from "./pdfjs";

/**
 * Annotation anchoring per docs/architecture.md §5.
 *
 * Page text = textContent.items.map(i => i.str).join("") — every stored offset
 * refers to that string. Rects are normalized to the unscaled page viewport
 * (0..1 fractions, origin top-left), so they survive zoom changes.
 */

export interface PageTextMap {
  /** items.map(i => i.str).join("") */
  text: string;
  /** span elements in page-text order, each tagged with data-start/data-end. */
  spans: HTMLElement[];
}

/** Build the canonical page text from a pdf.js textContent. */
export function pageText(textContent: TextContent): string {
  return textContent.items.map((i) => ("str" in i ? i.str : "")).join("");
}

/**
 * After the TextLayer renders, pair each text div with its page-text range.
 * pdf.js emits one div per text item in order; we verify that pairing by
 * comparing the div's textContent to the item's str and fall back to a greedy
 * scan when the shapes diverge (marked-content wrappers etc.).
 */
export function buildPageTextMap(textContent: TextContent, container: HTMLElement): PageTextMap {
  const items = textContent.items.map((i) => ("str" in i ? i.str : ""));
  const text = items.join("");

  const divs = Array.from(
    container.querySelectorAll<HTMLElement>("span, div"),
  ).filter(
    (el) =>
      !el.classList.contains("endOfContent") &&
      !el.classList.contains("markedContent") &&
      el.childElementCount === 0 &&
      el.textContent !== "",
  );

  const offsets: number[] = [];
  let cursor = 0;
  for (const s of items) {
    offsets.push(cursor);
    cursor += s.length;
  }

  const spans: HTMLElement[] = [];
  let divCursor = 0;
  const directMatch = divs.length === items.length;
  for (let i = 0; i < items.length; i++) {
    const str = items[i];
    if (str === "") continue;
    let el: HTMLElement | undefined;
    if (directMatch && divs[i].textContent === str) {
      el = divs[i];
    } else {
      for (let j = divCursor; j < divs.length; j++) {
        if (divs[j].textContent === str) {
          el = divs[j];
          divCursor = j + 1;
          break;
        }
      }
      if (!el && divs[i]) el = divs[i];
    }
    if (el) {
      el.dataset.start = String(offsets[i]);
      el.dataset.end = String(offsets[i] + str.length);
      spans.push(el);
    }
  }
  return { text, spans };
}

function spanRange(el: HTMLElement): [number, number] | null {
  const s = Number(el.dataset.start);
  const e = Number(el.dataset.end);
  return Number.isFinite(s) && Number.isFinite(e) ? [s, e] : null;
}

/** Character offset inside an element for a (node, offset) range boundary. */
function charOffsetWithin(el: HTMLElement, node: Node, offset: number): number {
  let acc = 0;
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current === node) return acc + offset;
    acc += (current.textContent ?? "").length;
    current = walker.nextNode();
  }
  // Node may be the element itself: offset counts children.
  let acc2 = 0;
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (i === offset) return acc2;
    acc2 += (child.textContent ?? "").length;
  }
  return acc2;
}

function ownerSpan(node: Node | null): HTMLElement | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.start !== undefined) return el;
    el = el.parentNode;
  }
  return null;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Merge rects belonging to the same visual line into single unions. */
export function mergeLineRects(rects: NormalizedRect[]): NormalizedRect[] {
  if (rects.length <= 1) return rects;
  const sorted = rects.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out: NormalizedRect[] = [];
  let cur = { ...sorted[0] };
  for (const r of sorted.slice(1)) {
    const sameLine = Math.abs(r.y - cur.y) < Math.max(cur.h, r.h) * 0.6;
    if (sameLine) {
      const x2 = Math.max(cur.x + cur.w, r.x + r.w);
      const y2 = Math.max(cur.y + cur.h, r.y + r.h);
      cur = { x: Math.min(cur.x, r.x), y: Math.min(cur.y, r.y), w: 0, h: 0 };
      cur.w = x2 - cur.x;
      cur.h = y2 - cur.y;
    } else {
      out.push(cur);
      cur = { ...r };
    }
  }
  out.push(cur);
  return out;
}

function rectsFromRange(range: Range, pageEl: HTMLElement): NormalizedRect[] {
  const pageRect = pageEl.getBoundingClientRect();
  const out: NormalizedRect[] = [];
  for (const r of range.getClientRects()) {
    const x = clamp01((r.left - pageRect.left) / pageRect.width);
    const y = clamp01((r.top - pageRect.top) / pageRect.height);
    const w = clamp01(r.width / pageRect.width);
    const h = clamp01(r.height / pageRect.height);
    if (w > 0.001 && h > 0.001) out.push({ x, y, w, h });
  }
  return out;
}

export interface SelectionAnchorResult {
  anchor: AnnotationAnchor;
  pageEl: HTMLElement;
}

/**
 * Convert the current DOM selection inside a pdf page element into an
 * AnnotationAnchor, or null when the selection doesn't cover page text.
 * Multi-page selections are clipped to the starting page (MVP rule, §5).
 */
export function anchorFromSelection(
  selection: Selection,
  pageEl: HTMLElement,
  map: PageTextMap,
  pageIndex: number,
): AnnotationAnchor | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);

  const startSpan = ownerSpan(range.startContainer);
  if (!startSpan || !pageEl.contains(startSpan)) return null;
  const startSpanRange = spanRange(startSpan);
  if (!startSpanRange) return null;

  const start = startSpanRange[0] + charOffsetWithin(startSpan, range.startContainer, range.startOffset);

  const endSpan = ownerSpan(range.endContainer);
  let end: number;
  if (endSpan && pageEl.contains(endSpan) && spanRange(endSpan)) {
    end = spanRange(endSpan)![0] + charOffsetWithin(endSpan, range.endContainer, range.endOffset);
  } else {
    // Clipped: selection continues past this page.
    end = map.text.length;
  }

  if (end <= start) return null;

  const clippedRange = range.cloneRange();
  if (!endSpan || !pageEl.contains(endSpan)) {
    const lastSpan = map.spans[map.spans.length - 1];
    if (lastSpan?.lastChild) {
      clippedRange.setEnd(lastSpan.lastChild, (lastSpan.lastChild.textContent ?? "").length);
    }
  }

  const rects = mergeLineRects(rectsFromRange(clippedRange, pageEl));
  if (rects.length === 0) return null;

  const exact = map.text.slice(start, end);
  if (!exact.trim()) return null;

  return {
    version: 1,
    pageIndex,
    rects,
    quote: {
      exact,
      prefix: map.text.slice(Math.max(0, start - 32), start),
      suffix: map.text.slice(end, end + 32),
    },
    position: { start, end },
  };
}

/**
 * Rects for a stored anchor on a rendered page. Follows §5: if the position
 * selector matches the page text, the stored rects win; otherwise search the
 * page text (disambiguating by prefix/suffix) and recompute rects from the
 * text-layer spans; otherwise the anchor is orphaned.
 */
export function reanchor(
  anchor: AnnotationAnchor,
  map: PageTextMap,
  pageEl: HTMLElement,
): NormalizedRect[] | null {
  const pos = anchor.position;
  if (pos && map.text.slice(pos.start, pos.end) === anchor.quote.exact) {
    return anchor.rects;
  }

  const { text } = map;
  const candidates: number[] = [];
  let idx = text.indexOf(anchor.quote.exact);
  while (idx !== -1) {
    candidates.push(idx);
    idx = text.indexOf(anchor.quote.exact, idx + 1);
  }
  if (candidates.length === 0) return null;

  let best = candidates[0];
  if (candidates.length > 1) {
    let bestScore = -1;
    for (const c of candidates) {
      const before = text.slice(Math.max(0, c - 32), c);
      const after = text.slice(c + anchor.quote.exact.length, c + anchor.quote.exact.length + 32);
      let score = 0;
      if (anchor.quote.prefix && before.endsWith(anchor.quote.prefix)) score += 2;
      if (anchor.quote.suffix && after.startsWith(anchor.quote.suffix)) score += 2;
      if (anchor.quote.prefix && before.includes(anchor.quote.prefix.slice(-8))) score += 1;
      if (anchor.quote.suffix && after.includes(anchor.quote.suffix.slice(0, 8))) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }

  const start = best;
  const end = best + anchor.quote.exact.length;

  const doc = pageEl.ownerDocument;
  const range = doc.createRange();
  let any = false;
  for (const span of map.spans) {
    const r = spanRange(span);
    if (!r || r[1] <= start || r[0] >= end) continue;
    const textNode = firstTextNode(span);
    if (!textNode) continue;
    const localStart = Math.max(0, start - r[0]);
    const localEnd = Math.min((textNode.textContent ?? "").length, end - r[0]);
    range.setStart(textNode, localStart);
    range.setEnd(textNode, localEnd);
    any = true;
  }
  if (!any) return null;

  const rects = mergeLineRects(rectsFromRange(range, pageEl));
  return rects.length > 0 ? rects : null;
}

function firstTextNode(el: HTMLElement): Text | null {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

/** Rects covering a plain-text needle on a page — used for citation markers. */
export function rectsForText(
  map: PageTextMap,
  pageEl: HTMLElement,
  needle: string,
): NormalizedRect[][] {
  const out: NormalizedRect[][] = [];
  if (!needle) return out;
  const { text } = map;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    const rects = rectsForRange(map, pageEl, idx, idx + needle.length);
    if (rects.length > 0) out.push(rects);
    idx = text.indexOf(needle, idx + 1);
  }
  return out;
}

function rectsForRange(
  map: PageTextMap,
  pageEl: HTMLElement,
  start: number,
  end: number,
): NormalizedRect[] {
  const doc = pageEl.ownerDocument;
  const range = doc.createRange();
  const rects: NormalizedRect[] = [];
  const pageRect = pageEl.getBoundingClientRect();
  for (const span of map.spans) {
    const r = spanRange(span);
    if (!r || r[1] <= start || r[0] >= end) continue;
    const textNode = firstTextNode(span);
    if (!textNode) continue;
    range.setStart(textNode, Math.max(0, start - r[0]));
    range.setEnd(textNode, Math.min((textNode.textContent ?? "").length, end - r[0]));
    for (const cr of range.getClientRects()) {
      rects.push({
        x: clamp01((cr.left - pageRect.left) / pageRect.width),
        y: clamp01((cr.top - pageRect.top) / pageRect.height),
        w: clamp01(cr.width / pageRect.width),
        h: clamp01(cr.height / pageRect.height),
      });
    }
  }
  return mergeLineRects(rects);
}
