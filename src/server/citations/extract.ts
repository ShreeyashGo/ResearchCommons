import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, TextItem, TextMarkedContent } from "pdfjs-dist/types/src/display/api";

import type {
  DestTarget,
  ExtractedPaper,
  LinkAnnot,
  PageText,
  TextItemBox,
  TextLine,
} from "./types";
import type { NormalizedRect } from "@/contracts/annotations";

const STANDARD_FONTS_URL = pathToFileURL(
  path.join(process.cwd(), "node_modules/pdfjs-dist/standard_fonts") + path.sep,
).href;

const LINE_BASELINE_TOLERANCE = 0.6; // fraction of median font height
const MIN_ITEM_HEIGHT = 3;

interface RawDest {
  name: string;
  ref: unknown;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return typeof (item as TextItem).str === "string";
}

/** px rect for a getTextContent item at viewport scale 1. */
function itemRectPx(
  item: TextItem,
  tx: number[],
  ascent: number,
): { x: number; y: number; w: number; h: number } {
  const fontHeight = Math.hypot(tx[2], tx[3]);
  const h = Math.max(fontHeight, MIN_ITEM_HEIGHT);
  const asc = Number.isFinite(ascent) && ascent > 0 ? Math.min(1, ascent) : 0.8;
  // tx[4], tx[5] is the baseline origin in viewport px. pdf.js sets the div top at
  // y - fontAscent and height ~ fontHeight.
  return {
    x: tx[4],
    y: tx[5] - asc * h,
    w: Math.max(0, item.width),
    h: h * 1.15,
  };
}

function toNormalized(
  x: number,
  y: number,
  w: number,
  h: number,
  widthPx: number,
  heightPx: number,
): NormalizedRect {
  const nx = clamp01(x / widthPx);
  const ny = clamp01(y / heightPx);
  return {
    x: nx,
    y: ny,
    w: clamp01((x + w) / widthPx) - nx,
    h: clamp01((y + h) / heightPx) - ny,
  };
}

/**
 * Extract the substring of an item whose characters lie inside a pixel rect,
 * assuming characters advance uniformly across the item's width.
 */
export function charsInRect(item: TextItemBox, rectPx: readonly [number, number, number, number]): string {
  const [x1, y1, x2, y2] = rectPx;
  const midY = item.yPx + item.hPx / 2;
  if (midY < y1 || midY > y2 || item.str.length === 0 || item.wPx <= 0) return "";
  const charW = item.wPx / item.str.length;
  let out = "";
  for (let i = 0; i < item.str.length; i++) {
    const cx = item.xPx + (i + 0.5) * charW;
    if (cx >= x1 && cx <= x2) out += item.str[i];
  }
  return out;
}

/** Sub-rect of an item covering character offsets [a, b) within the item. */
export function itemCharRectPx(
  item: TextItemBox,
  a: number,
  b: number,
): { x: number; y: number; w: number; h: number } | null {
  if (item.str.length === 0 || item.wPx <= 0 || b <= a) return null;
  const charW = item.wPx / item.str.length;
  return {
    x: item.xPx + a * charW,
    y: item.yPx,
    w: (b - a) * charW,
    h: item.hPx,
  };
}

function buildLines(items: TextItemBox[]): TextLine[] {
  const heights = items.filter((i) => i.str.trim()).map((i) => i.hPx);
  heights.sort((a, b) => a - b);
  const medianH = heights.length ? heights[heights.length >> 1] : 10;
  const tol = Math.max(1.5, medianH * LINE_BASELINE_TOLERANCE);

  const lines: TextLine[] = [];
  let cur: TextLine | null = null;
  let curBaseline = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const baseline = it.yPx + it.hPx; // approximate baseline = bottom of box
    if (
      !cur ||
      (it.str.trim() !== "" && Math.abs(baseline - curBaseline) > tol)
    ) {
      cur = { text: "", itemStart: i, itemEnd: i, xMin: it.xPx, xMax: it.xPx, yMid: it.yPx + it.hPx / 2, hPx: it.hPx };
      lines.push(cur);
      curBaseline = baseline;
    }
    cur.text += it.str;
    cur.itemEnd = i + 1;
    if (it.str.trim() !== "") {
      cur.xMin = Math.min(cur.xMin, it.xPx);
      cur.xMax = Math.max(cur.xMax, it.xPx + it.wPx);
      cur.hPx = Math.max(cur.hPx, it.hPx);
      cur.yMid = (cur.yMid + (it.yPx + it.hPx / 2)) / 2;
    }
  }
  return lines;
}

/**
 * Extract per-page text items with geometry and link annotations from a PDF.
 * Page text for each page is exactly `items.map(i => i.str).join("")`.
 */
export async function extractPdf(pdf: Uint8Array | Buffer): Promise<ExtractedPaper> {
  // pdf.js requires a plain Uint8Array (a Buffer instance is rejected).
  const data = Buffer.isBuffer(pdf) ? new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength) : pdf;
  const doc: PDFDocumentProxy = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    standardFontDataUrl: STANDARD_FONTS_URL,
    verbosity: 0,
  }).promise;

  try {
    const pages: PageText[] = [];
    const rawDests: RawDest[] = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const styles: Record<string, { ascent?: number }> =
        (content as { styles?: Record<string, { ascent?: number }> }).styles ?? {};

      const items: TextItemBox[] = [];
      let offset = 0;
      for (const raw of content.items) {
        if (!isTextItem(raw)) continue;
        const tx = pdfjs.Util.transform(viewport.transform, raw.transform) as number[];
        const ascent = styles[raw.fontName]?.ascent ?? 0.8;
        const r = itemRectPx(raw, tx, ascent);
        items.push({
          str: raw.str,
          start: offset,
          end: offset + raw.str.length,
          xPx: r.x,
          yPx: r.y,
          wPx: r.w,
          hPx: r.h,
          rect: toNormalized(r.x, r.y, r.w, r.h, viewport.width, viewport.height),
        });
        offset += raw.str.length;
      }

      const links: LinkAnnot[] = [];
      const annotations = (await page.getAnnotations({ intent: "display" })) as Array<{
        subtype?: string;
        rect?: number[];
        dest?: unknown;
      }>;
      for (const annot of annotations) {
        if (annot.subtype !== "Link" || !annot.rect) continue;
        // Internal destinations are strings (named dests) or explicit ref arrays.
        const destName = typeof annot.dest === "string" ? annot.dest : null;
        if (destName === null && annot.dest === null) continue; // URL links have neither
        const vpRect = viewport.convertToViewportRectangle(annot.rect) as number[];
        const x1 = Math.min(vpRect[0], vpRect[2]);
        const y1 = Math.min(vpRect[1], vpRect[3]);
        const x2 = Math.max(vpRect[0], vpRect[2]);
        const y2 = Math.max(vpRect[1], vpRect[3]);
        const rectPx = [x1, y1, x2, y2] as const;
        links.push({
          rect: toNormalized(x1, y1, x2 - x1, y2 - y1, viewport.width, viewport.height),
          rectPx,
          destName,
        });
        if (destName) {
          try {
            const dest = await doc.getDestination(destName);
            if (Array.isArray(dest) && dest[0] && typeof dest[0] === "object" && "num" in dest[0]) {
              rawDests.push({ name: destName, ref: dest[0] });
            }
          } catch {
            // Unknown destination; skip.
          }
        }
      }

      const text = content.items.map((i) => (isTextItem(i) ? i.str : "")).join("");
      pages.push({
        pageIndex: p - 1,
        widthPx: viewport.width,
        heightPx: viewport.height,
        text,
        items,
        lines: buildLines(items),
        links,
      });
    }

    // Resolve destinations: user-space (x, y) -> target page viewport px.
    const citeTargets = new Map<string, DestTarget>();
    for (const raw of rawDests) {
      try {
        const pageIndex = await doc.getPageIndex(raw.ref as Parameters<typeof doc.getPageIndex>[0]);
        const targetPage = await doc.getPage(pageIndex + 1);
        const tvp = targetPage.getViewport({ scale: 1 });
        const dest = await doc.getDestination(raw.name);
        if (!dest) continue;
        const [xPx, yPx] = tvp.convertToViewportPoint(dest[2] ?? 0, dest[3] ?? 0);
        citeTargets.set(raw.name, { pageIndex, xPx, yPx });
      } catch {
        // skip unresolvable destination
      }
    }

    return { pages, pageCount: doc.numPages, citeTargets };
  } finally {
    await doc.destroy();
  }
}

/** Load a paper PDF from a fixtures directory: fixtures/papers/<id>/paper.pdf. */
export function loadFixturePdf(fixtureDir: string): Buffer {
  return readFileSync(path.join(fixtureDir, "paper.pdf"));
}
