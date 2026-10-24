/**
 * Deterministic in-browser PDF generator for the mock API.
 *
 * Produces a small, valid, text-based PDF (Helvetica, letter size) entirely in
 * memory so the reader exercises the real pdf.js canvas + text-layer path in
 * mock mode — no fixtures on disk, no network.
 *
 * The emitted page text is exactly `lines.map(l => l.text).join("")` per page,
 * matching the contract's page-text definition (items joined with "").
 */

export interface MockPdfLine {
  text: string;
  /** Font size in points (default 11). */
  size?: number;
}

export interface MockPdfSpec {
  title: string;
  pages: MockPdfLine[][];
}

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 64;
const LEADING = 15;

function escapePdfText(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildMockPdf(spec: MockPdfSpec): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const fontId = 3;

  // Object numbering: 1 catalog, 2 pages, 3 font, then per page: page obj + content stream.
  spec.pages.forEach((_, i) => {
    pageIds.push(4 + i * 2);
    contentIds.push(5 + i * 2);
  });

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`;

  spec.pages.forEach((lines, i) => {
    const pageId = pageIds[i];
    const contentId = contentIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;

    let y = PAGE_H - MARGIN;
    const ops: string[] = [];
    for (const line of lines) {
      const size = line.size ?? 11;
      ops.push(`BT /F1 ${size} Tf 1 0 0 1 ${MARGIN} ${y} Tm (${escapePdfText(line.text)}) Tj ET`);
      y -= Math.round(LEADING * (size / 11));
    }
    const stream = ops.join("\n");
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  const chunks: string[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  const push = (s: string) => {
    chunks.push(s);
    cursor += s.length;
  };

  push("%PDF-1.5\n");
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = cursor;
    push(`${id} 0 obj\n${objects[id]}\nendobj\n`);
  }
  const xrefStart = cursor;
  push(`xref\n0 ${objects.length}\n`);
  push("0000000000 65535 f \n");
  for (let id = 1; id < objects.length; id++) {
    push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  return new TextEncoder().encode(chunks.join(""));
}

/** Deterministic pseudo-random offset, so each paper's PDF looks different. */
export function paperVariant(seedId: string): number {
  let h = 0;
  for (let i = 0; i < seedId.length; i++) h = (h * 33 + seedId.charCodeAt(i)) >>> 0;
  return h % 3;
}
