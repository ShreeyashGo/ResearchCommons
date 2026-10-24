"use client";

import { useMemo } from "react";
import { Lock } from "lucide-react";
import type { Annotation, CitationContext, NormalizedRect } from "@/contracts";
import { reanchor, rectsForText } from "@/lib/client/anchors";
import { annotationColorCss, cn } from "@/lib/client/utils";
import type { PdfPageHandle } from "./pdf-viewer";

export interface PageAnnotation {
  annotation: Annotation;
  rects: NormalizedRect[] | null; // null = orphaned on this page
}

export function PageOverlays({
  page,
  annotations,
  contexts,
  activeAnnotationId,
  freshIds,
  onBadgeClick,
  onCiteClick,
}: {
  page: PdfPageHandle;
  annotations: Annotation[];
  contexts: CitationContext[];
  activeAnnotationId: string | null;
  freshIds: Set<string>;
  onBadgeClick: (a: Annotation, x: number, y: number) => void;
  onCiteClick: (ctx: CitationContext, x: number, y: number) => void;
}) {
  const anchored = useMemo<PageAnnotation[]>(() => {
    if (!page.map || !page.el) return [];
    const out: PageAnnotation[] = [];
    for (const a of annotations) {
      if (a.anchor.pageIndex !== page.index) continue;
      out.push({ annotation: a, rects: reanchor(a.anchor, page.map, page.el) });
    }
    return out;
  }, [page.map, page.el, page.index, annotations]);
  const citeRects = useMemo(() => {
    if (!page.map || !page.el) return [];
    const out: { ctx: CitationContext; rects: NormalizedRect[] }[] = [];
    for (const ctx of contexts) {
      if (ctx.pageIndex !== page.index) continue;
      const rectSets =
        ctx.rects.length > 0
          ? [ctx.rects]
          : rectsForText(page.map, page.el, ctx.markerText).slice(0, 4);
      for (const rects of rectSets) out.push({ ctx, rects });
    }
    return out;
  }, [page.map, page.el, page.index, contexts]);

  return (
    <>
      {/* Highlight rects */}
      {anchored.map(({ annotation, rects }) =>
        (rects ?? []).map((r, i) => (
          <div
            key={`${annotation.id}:${i}`}
            className={cn(
              "ann-highlight",
              annotation.visibility === "private" && "is-private",
              annotation.id === activeAnnotationId && "is-active",
            )}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              background: annotationColorCss(annotation.color) + "55",
              color: annotationColorCss(annotation.color),
              pointerEvents: "none",
            }}
          />
        )),
      )}

      {/* Citation hotspots */}
      {citeRects.flatMap(({ ctx, rects }, gi) =>
        rects.map((r, i) => (
          <button
            key={`${ctx.id}:${gi}:${i}`}
            className={cn("cite-hotspot")}
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: `${r.w * 100}%`,
              height: `${r.h * 100}%`,
              pointerEvents: "auto",
            }}
            title={ctx.markerText}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onCiteClick(ctx, rect.left + rect.width / 2, rect.bottom);
            }}
          />
        )),
      )}

      {/* Margin badges (the "dot"): first rect of each anchored annotation */}
      {anchored.map(({ annotation, rects }) => {
        if (!rects || rects.length === 0) return null;
        const first = rects[0];
        const count = annotation.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
        return (
          <button
            key={`badge:${annotation.id}`}
            className={cn("ann-badge", freshIds.has(annotation.id) && "pulse")}
            style={{
              left: `calc(${Math.min(first.x + first.w + 0.012, 0.97) * 100}%)`,
              top: `${Math.max(0, first.y - 0.004) * 100}%`,
              background: annotationColorCss(annotation.color),
              pointerEvents: "auto",
              ["--pulse-color" as string]: annotationColorCss(annotation.color) + "88",
            }}
            title={`${annotation.author.displayName} · ${count} comment${count === 1 ? "" : "s"}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onBadgeClick(annotation, rect.left + rect.width / 2, rect.bottom);
            }}
          >
            {annotation.visibility === "private" ? <Lock size={9} /> : count > 0 ? count : null}
          </button>
        );
      })}
    </>
  );
}
