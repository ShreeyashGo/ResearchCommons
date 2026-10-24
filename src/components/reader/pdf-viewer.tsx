"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "@/lib/client/pdfjs";
import { TextLayer } from "@/lib/client/pdfjs";
import { anchorFromSelection, buildPageTextMap, type PageTextMap } from "@/lib/client/anchors";
import type { AnnotationAnchor } from "@/contracts";

export interface PdfPageHandle {
  index: number;
  el: HTMLDivElement | null;
  map: PageTextMap | null;
}

export interface TextSelectInfo {
  pageIndex: number;
  anchor: AnnotationAnchor;
  /** Viewport point (top-center of the selection) for anchoring the toolbar. */
  x: number;
  y: number;
}

interface PageSize {
  w: number;
  h: number;
}

/**
 * Virtualized pdf.js renderer: canvas + text layer per page, pages rendered
 * when they approach the viewport (§5). Overlay layers (highlights, badges,
 * citation hotspots) are rendered by the caller inside each page through
 * `renderOverlay`.
 */
export function PdfViewer({
  doc,
  scale,
  onVisiblePage,
  onTextSelect,
  renderOverlay,
  pageElements,
  onMap: onMapProp,
}: {
  doc: PDFDocumentProxy;
  scale: number;
  onVisiblePage?: (index: number) => void;
  onTextSelect?: (info: TextSelectInfo) => void;
  renderOverlay?: (page: PdfPageHandle) => React.ReactNode;
  pageElements?: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onMap?: (index: number, map: PageTextMap) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const mapsRef = useRef(new Map<number, PageTextMap>());

  useEffect(() => {
    setRoot(scrollRef.current);
  }, []);

  // Intrinsic page sizes at scale 1 (cheap: metadata only, no render).
  useEffect(() => {
    let alive = true;
    mapsRef.current.clear();
    (async () => {
      const out: PageSize[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        out.push({ w: v.width, h: v.height });
      }
      if (alive) setSizes(out);
    })();
    return () => {
      alive = false;
    };
  }, [doc]);

  const onMap = useCallback(
    (index: number, map: PageTextMap) => {
      mapsRef.current.set(index, map);
      onMapProp?.(index, map);
    },
    [onMapProp],
  );

  // Selection -> anchor. We compute the anchor here (it needs the page's text
  // map) and hand the caller a ready-made AnnotationAnchor.
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !onTextSelect) return;
    const range = sel.getRangeAt(0);
    let pageEl: HTMLElement | null =
      range.startContainer instanceof HTMLElement
        ? range.startContainer
        : range.startContainer.parentElement;
    while (pageEl && !pageEl.classList.contains("pdf-page")) {
      pageEl = pageEl.parentElement;
    }
    if (!pageEl) return;
    const index = Number(pageEl.dataset.pageIndex);
    const map = mapsRef.current.get(index);
    if (!map || !Number.isFinite(index)) return;
    const anchor = anchorFromSelection(sel, pageEl, map, index);
    if (!anchor) return;
    const rects = range.getClientRects();
    const first = rects[0];
    onTextSelect({
      pageIndex: index,
      anchor,
      x: first ? first.left + first.width / 2 : 0,
      y: first ? first.top : 0,
    });
  }, [onTextSelect]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto overflow-x-hidden bg-surface-2/60 py-6"
      onMouseUp={handleMouseUp}
    >
      <div className="mx-auto flex w-fit flex-col items-stretch gap-6 px-6 pb-24">
        {sizes?.map((size, i) => (
          <PdfPageSlot
            key={i}
            doc={doc}
            index={i}
            size={size}
            scale={scale}
            onMap={onMap}
            onVisiblePage={onVisiblePage}
            renderOverlay={renderOverlay}
            root={root}
            pageElements={pageElements}
          />
        ))}
      </div>
    </div>
  );
}

function PdfPageSlot({
  doc,
  index,
  size,
  scale,
  onMap,
  onVisiblePage,
  renderOverlay,
  root,
  pageElements,
}: {
  doc: PDFDocumentProxy;
  index: number;
  size: PageSize;
  scale: number;
  onMap: (index: number, map: PageTextMap) => void;
  onVisiblePage?: (index: number) => void;
  renderOverlay?: (page: PdfPageHandle) => React.ReactNode;
  root: HTMLElement | null;
  pageElements?: React.MutableRefObject<Map<number, HTMLDivElement>>;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const [map, setMap] = useState<PageTextMap | null>(null);

  useEffect(() => {
    const el = elRef.current;
    if (el && pageElements) {
      const map = pageElements.current;
      map.set(index, el);
      return () => {
        map.delete(index);
      };
    }
  }, [index, pageElements]);

  // Render trigger: page approaching the viewport (±~2 pages via rootMargin).
  useEffect(() => {
    const el = elRef.current;
    if (!el || shouldRender) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShouldRender(true);
            obs.disconnect();
          }
        }
      },
      { root, rootMargin: "160% 0px 160% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [root, shouldRender]);

  // Current-page tracking: the page crossing the viewport's middle wins.
  useEffect(() => {
    const el = elRef.current;
    if (!el || !onVisiblePage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) onVisiblePage(index);
        }
      },
      { root, rootMargin: "-45% 0px -45% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [index, onVisiblePage, root]);

  // Canvas + text layer render. Re-runs on zoom: normalized overlay rects are
  // scale-independent so only raster/text need the repaint.
  useEffect(() => {
    if (!shouldRender) return;
    const canvas = canvasRef.current;
    const textEl = textLayerRef.current;
    if (!canvas || !textEl) return;
    let cancelled = false;
    let renderTask: { cancel(): void; promise: Promise<unknown> } | undefined;
    let textLayer: TextLayer | undefined;

    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;

      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const viewport = page.getViewport({ scale: scale * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvas, canvasContext: ctx, viewport });
      try {
        await renderTask.promise;
      } catch {
        return; // RenderingCancelledException on zoom — fine.
      }
      if (cancelled) return;

      textEl.replaceChildren();
      const textViewport = page.getViewport({ scale });
      const textContent = await page.getTextContent();
      if (cancelled) return;
      textLayer = new TextLayer({
        textContentSource: textContent,
        container: textEl,
        viewport: textViewport,
      });
      await textLayer.render();
      if (cancelled) return;
      const m = buildPageTextMap(textContent, textEl);
      setMap(m);
      onMap(index, m);
    })();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
        textLayer?.cancel();
      } catch {}
    };
  }, [shouldRender, doc, index, scale, onMap]);

  const handle = useMemo<PdfPageHandle>(
    () => ({ index, el: elRef.current, map }),
    [index, map],
  );

  return (
    <div
      ref={elRef}
      data-page-index={index}
      className="pdf-page relative shrink-0 bg-white shadow-card dark:bg-[#2e2d29]"
      style={{
        width: Math.round(size.w * scale),
        height: Math.round(size.h * scale),
        ["--scale-factor" as string]: scale,
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div ref={textLayerRef} className="textLayer" />
      <div className="pointer-events-none absolute inset-0">
        {map ? renderOverlay?.(handle) : null}
      </div>
    </div>
  );
}
