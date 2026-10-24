"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Minus,
  PanelRight,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { z } from "zod";
import type {
  Annotation,
  CitationContext,
  LibraryPaper,
  Reference,
  Review,
} from "@/contracts";
import { AnnotationColor, AnnotationVisibility } from "@/contracts";
import { api } from "@/lib/client/api";
import { useSessionUser } from "@/lib/client/auth";
import { reanchor, type PageTextMap } from "@/lib/client/anchors";
import { fetchPdfBytes, loadPdf, type PDFDocumentProxy } from "@/lib/client/pdfjs";
import { subscribePaper } from "@/lib/client/realtime";
import { cn, authorList } from "@/lib/client/utils";
import { EmptyState, Spinner } from "@/components/ui/atoms";
import { Button } from "@/components/ui/controls";
import { PdfViewer, type TextSelectInfo } from "./pdf-viewer";
import { PageOverlays } from "./overlays";
import { SelectionToolbar, ThreadPopover } from "./thread-popover";
import { CitationPreview } from "./citation-preview";
import { RightPanel, type AiCard, type PanelTab } from "./right-panel";

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5, 2];
let cardSeq = 0;
const nextCardId = () => `card-${++cardSeq}`;

export function Reader({ groupId, paperId }: { groupId: string; paperId: string }) {
  const { user, loading: userLoading } = useSessionUser();
  const [paper, setPaper] = useState<LibraryPaper | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [references, setReferences] = useState<Reference[]>([]);
  const [contexts, setContexts] = useState<CitationContext[]>([]);
  const [citeUnavailable, setCiteUnavailable] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [aiCards, setAiCards] = useState<AiCard[]>([]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<PanelTab>("discussion");
  const [scaleIdx, setScaleIdx] = useState(2);
  const [currentPage, setCurrentPage] = useState(0);
  const [sel, setSel] = useState<TextSelectInfo | null>(null);
  const [thread, setThread] = useState<{ annotation: Annotation; x: number; y: number } | null>(null);
  const [cite, setCite] = useState<{ ctx: CitationContext; x: number; y: number } | null>(null);
  const [activeAnnId, setActiveAnnId] = useState<string | null>(null);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [summarizeBusy, setSummarizeBusy] = useState(false);
  const pageElements = useRef(new Map<number, HTMLDivElement>());
  const pageMaps = useRef(new Map<number, PageTextMap>());
  const pdfUrlExpiresAt = useRef<string | null>(null);
  const annIdsRef = useRef<Set<string>>(new Set());
  const scale = ZOOMS[scaleIdx];

  const refreshAnnotations = useCallback(
    async (pulseNew = false) => {
      const res = await api.listAnnotations(groupId, paperId);
      setAnnotations(res.annotations);
      if (pulseNew) {
        const fresh = res.annotations.filter((a) => !annIdsRef.current.has(a.id)).map((a) => a.id);
        if (fresh.length > 0) {
          setFreshIds((prev) => new Set([...prev, ...fresh]));
          setTimeout(() => {
            setFreshIds((prev) => {
              const next = new Set(prev);
              for (const id of fresh) next.delete(id);
              return next;
            });
          }, 2500);
        }
      }
      annIdsRef.current = new Set(res.annotations.map((a) => a.id));
    },
    [groupId, paperId],
  );

  const refreshReviews = useCallback(async () => {
    const res = await api.listReviews(groupId, paperId);
    setReviews(res.reviews);
  }, [groupId, paperId]);

  const loadPdfFromUrl = useCallback(async (url: string) => {
    const bytes = await fetchPdfBytes(url);
    return loadPdf(bytes);
  }, []);

  // Signed PDF URLs expire (~10 min): on fetch failure, refetch the paper once
  // for a fresh signed URL and retry.
  const loadPdfFresh = useCallback(
    async (url: string) => {
      try {
        return await loadPdfFromUrl(url);
      } catch (err) {
        const res = await api.getPaper(paperId, groupId);
        pdfUrlExpiresAt.current = res.pdfUrlExpiresAt;
        if (!res.pdfUrl) throw err;
        return loadPdfFromUrl(res.pdfUrl);
      }
    },
    [loadPdfFromUrl, paperId, groupId],
  );

  // Initial load: paper, pdf, annotations, citations, reviews.
  useEffect(() => {
    let alive = true;
    let docInstance: PDFDocumentProxy | null = null;
    (async () => {
      try {
        const paperRes = await api.getPaper(paperId, groupId);
        if (!alive) return;
        setPaper(paperRes.paper);
        pdfUrlExpiresAt.current = paperRes.pdfUrlExpiresAt;

        void Promise.all([
          refreshAnnotations(),
          refreshReviews(),
          api
            .getCitations(paperId)
            .then((r) => {
              if (!alive) return;
              setReferences(r.references);
              setContexts(r.contexts);
            })
            .catch((e: unknown) => {
              if (!alive) return;
              // ML citations pipeline is not live yet — degrade gracefully.
              setCiteUnavailable(e instanceof Error ? e.message : "citations unavailable");
            }),
        ]);

        if (paperRes.pdfUrl && paperRes.paper.processingStatus === "ready") {
          docInstance = await loadPdfFresh(paperRes.pdfUrl);
          if (!alive) return;
          setDoc(docInstance);
        }
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : "Failed to load paper");
      }
    })();
    return () => {
      alive = false;
      docInstance?.destroy().catch(() => undefined);
    };
  }, [groupId, paperId, refreshAnnotations, refreshReviews, loadPdfFresh]);

  // Realtime per contracts/realtime.ts: refetch on table changes.
  useEffect(() => {
    if (!paper) return;
    return subscribePaper(groupId, paperId, (table) => {
      if (table === "annotations" || table === "comments") void refreshAnnotations(true);
      if (table === "paper_reviews") void refreshReviews();
    });
  }, [paper, groupId, paperId, refreshAnnotations, refreshReviews]);

  const refreshCurrent = refreshAnnotations;

  const handleTextSelect = useCallback((info: TextSelectInfo) => {
    setThread(null);
    setCite(null);
    setSel(info);
  }, []);

  const handleAnnotate = useCallback(
    async (opts: { color: z.infer<typeof AnnotationColor>; visibility: z.infer<typeof AnnotationVisibility>; withComment: boolean; body?: string }) => {
      if (!sel) return;
      await api.createAnnotation(groupId, paperId, {
        anchor: sel.anchor,
        color: opts.color,
        visibility: opts.visibility,
        comment: opts.withComment && opts.body?.trim() ? opts.body.trim() : undefined,
      });
      window.getSelection()?.removeAllRanges();
      setSel(null);
      await refreshCurrent();
    },
    [sel, groupId, paperId, refreshCurrent],
  );

  const jumpToAnnotation = useCallback(
    (a: Annotation) => {
      const el = pageElements.current.get(a.anchor.pageIndex);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      setActiveAnnId(a.id);
    },
    [],
  );

  const handleBadgeClick = useCallback((a: Annotation, x: number, y: number) => {
    setSel(null);
    setCite(null);
    setActiveAnnId(a.id);
    setThread({ annotation: a, x, y });
  }, []);

  const handleCiteClick = useCallback(
    (ctx: CitationContext, x: number, y: number) => {
      setSel(null);
      setThread(null);
      setCite({ ctx, x, y });
    },
    [],
  );

  const handleExplain = useCallback(
    async (ref: Reference, ctx: CitationContext) => {
      setCite(null);
      setPanelOpen(true);
      setTab("ai");
      const id = nextCardId();
      setAiCards((cs) => [...cs, { id, kind: "loading", label: `Explaining ${ctx.markerText}…` }]);
      try {
        const res = await api.explainCitation(paperId, ref.id, { groupId });
        setAiCards((cs) =>
          cs.map((c) =>
            c.id === id
              ? res.status === "ok"
                ? { id, kind: "explain", explanation: res.explanation, meta: res.meta, marker: ctx.markerText }
                : { id, kind: "unavailable", reference: ref, reason: res.reason }
              : c,
          ),
        );
      } catch (e) {
        setAiCards((cs) =>
          cs.map((c) =>
            c.id === id
              ? {
                  id,
                  kind: "unavailable",
                  reference: ref,
                  reason: e instanceof Error ? e.message : "Explanation unavailable",
                }
              : c,
          ),
        );
      }
    },
    [paperId, groupId],
  );

  const handleSummarize = useCallback(async () => {
    setPanelOpen(true);
    setTab("ai");
    setSummarizeBusy(true);
    const id = nextCardId();
    setAiCards((cs) => [...cs, { id, kind: "loading", label: "Summarizing paper…" }]);
    try {
      const res = await api.paperSummary(paperId, { groupId });
      setAiCards((cs) =>
        cs.map((c) =>
          c.id === id
            ? { id, kind: "summary", summary: res.summary, meta: res.meta, paperTitle: paper?.title ?? "" }
            : c,
        ),
      );
    } catch (e) {
      setAiCards((cs) =>
        cs.map((c) =>
          c.id === id
            ? {
                id,
                kind: "unavailable",
                reference: {
                  id: "00000000-0000-0000-0000-000000000000",
                  paperId,
                  ordinal: 0,
                  label: null,
                  rawText: paper?.title ?? "",
                  parsedTitle: null,
                  parsedAuthors: [],
                  parsedYear: null,
                  matchStatus: "unresolved",
                  matchScore: null,
                  matchMethod: null,
                  work: null,
                  searchUrl: "https://scholar.google.com/scholar?q=" + encodeURIComponent(paper?.title ?? ""),
                },
                reason: `Paper summary failed: ${e instanceof Error ? e.message : "unknown error"}`,
              }
            : c,
        ),
      );
    } finally {
      setSummarizeBusy(false);
    }
  }, [paperId, groupId, paper]);

  // Orphaned annotations: reanchor fails on their page (page rendered).
  const orphaned = useMemo(() => {
    const out: Annotation[] = [];
    for (const a of annotations) {
      const map = pageMaps.current.get(a.anchor.pageIndex);
      const el = pageElements.current.get(a.anchor.pageIndex);
      if (map && el && reanchor(a.anchor, map, el) === null) out.push(a);
    }
    return out;
    // recompute when maps arrive or annotations change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, doc]);

  const selectFromPanel = useCallback(
    (a: Annotation) => {
      jumpToAnnotation(a);
      setTimeout(() => {
        const el = pageElements.current.get(a.anchor.pageIndex);
        if (el) {
          const rect = el.getBoundingClientRect();
          const r = a.anchor.rects[0];
          setThread({ annotation: a, x: rect.left + (r.x + r.w) * rect.width, y: rect.top + r.y * rect.height });
        }
      }, 350);
    },
    [jumpToAnnotation],
  );

  if (userLoading || (!paper && !loadError)) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    );
  }
  if (loadError || !paper) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<TriangleAlert size={20} />}
          title="Couldn't load this paper"
          body={loadError ?? "Unknown error"}
          action={
            <Link href={`/g/${groupId}`}>
              <Button variant="outline" size="sm">Back to library</Button>
            </Link>
          }
        />
      </div>
    );
  }
  if (!user) return null; // AppShell redirects to /login

  const notReady = paper.processingStatus !== "ready";

  return (
    <div className="flex h-full flex-col">
      {/* Reader toolbar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-bg-raised px-3">
        <Link
          href={`/g/${groupId}`}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] font-medium text-muted hover:text-ink"
        >
          <ArrowLeft size={14} /> Library
        </Link>
        <span className="h-4 w-px bg-line" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium leading-4">{paper.title}</p>
          <p className="truncate text-[10px] leading-3.5 text-muted">
            {authorList(paper.authors, 3)}{paper.year ? ` · ${paper.year}` : ""}
          </p>
        </div>
        {doc && (
          <div className="flex items-center gap-0.5">
            <button
              className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              disabled={scaleIdx === 0}
              onClick={() => setScaleIdx((i) => Math.max(0, i - 1))}
              aria-label="Zoom out"
            >
              <Minus size={14} />
            </button>
            <button
              className="w-12 text-center text-[11px] font-medium text-muted hover:text-ink"
              onClick={() => setScaleIdx(2)}
              title="Reset zoom"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40"
              disabled={scaleIdx === ZOOMS.length - 1}
              onClick={() => setScaleIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
              aria-label="Zoom in"
            >
              <Plus size={14} />
            </button>
            <span className="mx-1 h-4 w-px bg-line" />
            <span className="text-[11px] tabular-nums text-muted">
              p. {currentPage + 1}/{doc.numPages}
            </span>
          </div>
        )}
        <button
          className={cn(
            "rounded p-1.5 hover:bg-surface-2",
            panelOpen ? "text-accent" : "text-muted hover:text-ink",
          )}
          onClick={() => setPanelOpen((v) => !v)}
          aria-label="Toggle side panel"
        >
          <PanelRight size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {doc ? (
            <PdfViewer
              doc={doc}
              scale={scale}
              pageElements={pageElements}
              onMap={(i, m) => pageMaps.current.set(i, m)}
              onVisiblePage={setCurrentPage}
              onTextSelect={handleTextSelect}
              renderOverlay={(page) => (
                <PageOverlays
                  page={page}
                  annotations={annotations}
                  contexts={contexts}
                  activeAnnotationId={activeAnnId}
                  freshIds={freshIds}
                  onBadgeClick={handleBadgeClick}
                  onCiteClick={handleCiteClick}
                />
              )}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              {notReady ? (
                <EmptyState
                  icon={<Spinner size={18} />}
                  title={`This paper is ${paper.processingStatus}`}
                  body={
                    paper.processingStatus === "failed"
                      ? paper.processingError ?? "Processing failed."
                      : "Text extraction and citation detection are running — check back shortly."
                  }
                  action={
                    paper.processingStatus === "failed" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void api.processPaper(paperId).catch(() => undefined)}
                      >
                        <RefreshCw size={13} /> Retry processing
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <Spinner size={22} />
              )}
            </div>
          )}

          {sel && (
            <SelectionToolbar
              x={sel.x}
              y={sel.y}
              onAnnotate={(o) => void handleAnnotate(o)}
              onClose={() => {
                setSel(null);
                window.getSelection()?.removeAllRanges();
              }}
            />
          )}
          {thread && (
            <ThreadPopover
              annotation={thread.annotation}
              user={user}
              anchor={{ x: thread.x, y: thread.y }}
              onClose={() => {
                setThread(null);
                setActiveAnnId(null);
              }}
              onChanged={() => void refreshCurrent()}
              onPinToPanel={() => {
                setThread(null);
                setPanelOpen(true);
                setTab("discussion");
                setTimeout(() => {
                  document
                    .querySelector(`[data-ann-id="${thread.annotation.id}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }, 60);
              }}
            />
          )}
          {cite && (
            <CitationPreview
              anchor={{ x: cite.x, y: cite.y }}
              ctx={cite.ctx}
              reference={references.find((r) => r.id === cite.ctx.referenceId)}
              onExplain={(ref, ctx) => void handleExplain(ref, ctx)}
              onClose={() => setCite(null)}
            />
          )}
        </div>

        {panelOpen && (
          <RightPanel
            paper={paper}
            annotations={annotations}
            orphaned={orphaned}
            reviews={reviews}
            aiCards={aiCards}
            user={user}
            activeTab={tab}
            onTabChange={setTab}
            onClose={() => setPanelOpen(false)}
            onSummarize={() => void handleSummarize()}
            onSelectAnnotation={selectFromPanel}
            onRefreshReviews={() => void refreshReviews()}
            summarizeBusy={summarizeBusy}
            citeNotice={citeUnavailable}
          />
        )}
      </div>
    </div>
  );
}
