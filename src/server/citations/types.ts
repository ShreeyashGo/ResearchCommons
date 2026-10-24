import type { NormalizedRect } from "@/contracts/annotations";

/** One text item from pdf.js getTextContent(), with geometry in page pixels (viewport scale 1). */
export interface TextItemBox {
  str: string;
  /** [start, end) offsets into the page text string (items.join(""), see docs/architecture.md §5). */
  start: number;
  end: number;
  /** Item bounding box in page pixels. */
  xPx: number;
  yPx: number;
  wPx: number;
  hPx: number;
  /** Same box normalized to 0..1 of the unscaled page, origin top-left. */
  rect: NormalizedRect;
}

/** A visual line of text built from consecutive items in pdf.js content order. */
export interface TextLine {
  text: string;
  /** Indices into PageText.items. */
  itemStart: number;
  itemEnd: number;
  xMin: number;
  xMax: number;
  yMid: number;
  hPx: number;
}

/** A PDF link annotation (internal destination or external URI). */
export interface LinkAnnot {
  /** Normalized marker rect on this page. */
  rect: NormalizedRect;
  /** Same rect in page pixels [x1, y1, x2, y2] (viewport space, y down). */
  rectPx: readonly [number, number, number, number];
  /** Named destination, e.g. "cite.madry2018towards". */
  destName: string | null;
}

export interface PageText {
  pageIndex: number;
  widthPx: number;
  heightPx: number;
  /** items.map(i => i.str).join("") — the contract page text string. */
  text: string;
  items: TextItemBox[];
  /** Reading-order lines (content order; handles two-column layouts). */
  lines: TextLine[];
  links: LinkAnnot[];
}

/** Resolved target of a named PDF destination. */
export interface DestTarget {
  pageIndex: number;
  xPx: number;
  yPx: number;
}

export interface ExtractedPaper {
  pages: PageText[];
  pageCount: number;
  /** cite.* destination name -> anchor point, used to link markers to bibliography entries. */
  citeTargets: Map<string, DestTarget>;
}

/** One parsed bibliography entry. */
export interface BibEntry {
  /** 1-based position in the bibliography. */
  ordinal: number;
  /** Explicit numeric label when the list is numbered (`[12]` -> 12); null otherwise. */
  numberLabel: number | null;
  /** Display label, e.g. "12" or "Madry et al., 2018". */
  label: string;
  rawText: string;
  title: string | null;
  authors: string[];
  year: number | null;
  /** Vertical span of the entry on its page (px); used to anchor cite.* destinations. */
  pageIndex: number;
  yTopPx: number;
  yBottomPx: number;
  /** Median height of the entry's visual text lines (px), for destination tolerance. */
  medianLineHeightPx: number;
}

export type DetectionMethod = "pdf_link" | "regex";

/** An in-text citation marker occurrence mapped to a bibliography entry. */
export interface CitationMarker {
  pageIndex: number;
  /** Ordinal of the bibliography entry this marker cites. */
  refOrdinal: number;
  markerText: string;
  rects: NormalizedRect[];
  method: DetectionMethod;
}

/** A resolved external work, ready to be upserted into external_works. */
export interface ExternalWorkInsert {
  source: "semantic_scholar" | "openalex" | "arxiv";
  externalId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  url: string | null;
  openAccessPdfUrl: string | null;
}

export interface ResolvedReference extends BibEntry {
  matchStatus: "resolved" | "unresolved" | "ambiguous";
  matchScore: number | null;
  matchMethod: string | null;
  work: ExternalWorkInsert | null;
  searchUrl: string;
}

export interface CitationContextInsert {
  refOrdinal: number;
  pageIndex: number;
  markerText: string;
  sentence: string;
  paragraph: string | null;
  rects: NormalizedRect[];
  detectionMethod: DetectionMethod;
}

export interface PaperAnalysis {
  pageCount: number;
  references: ResolvedReference[];
  contexts: CitationContextInsert[];
}

/** Extraction quality stats, surfaced in the paper's processing metadata and PR reports. */
export interface AnalysisStats {
  refsFound: number;
  markersLinked: number;
  markersTotal: number;
  resolved: number;
  ambiguous: number;
  unresolved: number;
}
