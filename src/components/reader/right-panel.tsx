"use client";

import { useRef, useState } from "react";
import {
  AlertTriangle,
  EyeOff,
  Link2,
  MessageSquare,
  PanelRightClose,
  Plus,
  Quote,
  ScrollText,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  Annotation,
  CitationExplanation,
  LibraryPaper,
  Reference,
  Review,
  WorkSummary,
  AiMeta,
} from "@/contracts";
import { api } from "@/lib/client/api";
import type { SessionUser } from "@/lib/client/auth";
import { annotationColorCss, authorColor, cn, relativeTime, truncate } from "@/lib/client/utils";
import { Avatar, Badge, EmptyState, Spinner } from "@/components/ui/atoms";
import { Button, Input, Textarea } from "@/components/ui/controls";
import { Tabs } from "@/components/ui/overlay";

// ---------------------------------------------------------------------------
// AI cards (ChatGPT-style stream; every card is clearly badged)
// ---------------------------------------------------------------------------

export type AiCard =
  | { id: string; kind: "loading"; label: string }
  | { id: string; kind: "summary"; summary: WorkSummary; meta: AiMeta; paperTitle: string }
  | { id: string; kind: "explain"; explanation: CitationExplanation; meta: AiMeta; marker: string }
  | { id: string; kind: "unavailable"; reference: Reference; reason: string };

function AiBadge({ meta }: { meta: AiMeta }) {
  return (
    <span className="flex items-center gap-1.5">
      <Badge tone="ai">
        <Sparkles size={10} /> {meta.isMock ? "Mock AI" : "AI"}
      </Badge>
      <span className="text-[10px] text-muted">
        {meta.provider}/{meta.model}
        {meta.cached ? " · cached" : ""}
      </span>
    </span>
  );
}

function GroundingChip({ grounding }: { grounding: string }) {
  const label =
    grounding === "full_text" ? "Grounded: full text" : grounding === "abstract_only" ? "Grounded: abstract only" : "Grounded: metadata only";
  return <Badge tone={grounding === "full_text" ? "ok" : "neutral"}>{label}</Badge>;
}

function AiCardView({ card }: { card: AiCard }) {
  if (card.kind === "loading") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ai/25 bg-ai-soft/40 px-3 py-2.5 text-[12px] text-ai">
        <Spinner size={13} /> {card.label}
      </div>
    );
  }
  if (card.kind === "unavailable") {
    return (
      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="flex items-center gap-1.5">
          <Badge tone="warn">
            <AlertTriangle size={10} /> Explanation unavailable
          </Badge>
        </div>
        <p className="mt-1.5 text-[12px] text-ink-soft">{card.reason}</p>
        <p className="mt-2 line-clamp-2 text-[11px] italic text-muted">“{card.reference.rawText}”</p>
        <a
          href={card.reference.searchUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        >
          <Link2 size={11} /> Search for this reference
        </a>
      </div>
    );
  }

  if (card.kind === "summary") {
    return (
      <div className="rounded-lg border border-ai/25 bg-ai-soft/30 p-3">
        <div className="flex items-center justify-between">
          <AiBadge meta={card.meta} />
          <GroundingChip grounding={card.summary.grounding} />
        </div>
        <p className="mt-1 text-[11px] font-medium text-muted">Summary · {truncate(card.paperTitle, 50)}</p>
        <p className="mt-2 text-[13px] leading-5.5 text-ink">{card.summary.summary}</p>
        <p className="mt-2 text-[12px] leading-5 text-ink-soft">
          <span className="font-medium text-ink">Key contribution: </span>
          {card.summary.keyContribution}
        </p>
      </div>
    );
  }

  const e = card.explanation;
  return (
    <div className="rounded-lg border border-ai/25 bg-ai-soft/30 p-3">
      <div className="flex items-center justify-between">
        <AiBadge meta={card.meta} />
        <GroundingChip grounding={e.grounding} />
      </div>
      <p className="mt-1 text-[11px] font-medium text-muted">
        Why this paper cites {card.marker} · {e.referencedPaper.title} ({e.referencedPaper.year ?? "n.d."})
      </p>
      <p className="mt-2 text-[13px] leading-5.5 text-ink">{e.summary}</p>
      <p className="mt-2 text-[12px] leading-5 text-ink-soft">
        <span className="font-medium text-ink">Key contribution: </span>
        {e.keyContribution}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-ink-soft">
        <span className="font-medium text-ink">Purpose: </span>
        <Badge tone="accent" className="mr-1">{e.citationPurpose.replace(/_/g, " ")}</Badge>
        {e.citationPurposeExplanation}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-ink-soft">
        <span className="font-medium text-ink">Relationship: </span>
        {e.relationshipToCurrentPaper}
      </p>
      {e.supportingEvidence.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {e.supportingEvidence.map((ev, i) => (
            <p key={i} className="flex gap-1.5 border-l-2 border-ai/40 pl-2 text-[11px] italic leading-4.5 text-ink-soft">
              <Quote size={10} className="mt-0.5 shrink-0 text-ai" />
              “{ev.quote}”
            </p>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-muted">{e.availabilityNote}</p>
      {e.sourceLinks.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {e.sourceLinks.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-[11px] font-medium text-accent hover:underline">
              {l.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reviews tab
// ---------------------------------------------------------------------------

const LIST_FIELDS = [
  ["contributions", "Contributions"],
  ["strengths", "Strengths"],
  ["weaknesses", "Weaknesses"],
  ["findings", "Findings"],
  ["openQuestions", "Open questions"],
] as const;

function ListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
      {items.map((it, i) => (
        <div key={i} className="mb-1 flex items-center gap-1">
          <Input
            value={it}
            className="h-7 text-[12px]"
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button className="rounded p-1 text-muted hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
        onClick={() => onChange([...items, ""])}
      >
        <Plus size={11} /> {placeholder}
      </button>
    </div>
  );
}

function ReviewCard({ review, mine, onDelete }: { review: Review; mine: boolean; onDelete?: () => void }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex items-center gap-1.5">
        <Avatar name={review.author.displayName} color={authorColor(review.author.id)} size={18} />
        <span className="text-xs font-medium">{review.author.displayName}</span>
        {mine && <Badge tone="accent">your review</Badge>}
        <span className="ml-auto text-[10px] text-muted">{relativeTime(review.updatedAt)}</span>
        {mine && onDelete && (
          <button className="rounded p-1 text-muted hover:text-danger" title="Delete review" onClick={onDelete}>
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <p className="mt-2 text-[13px] font-medium leading-5">{review.tldr}</p>
      {LIST_FIELDS.map(([k, label]) => {
        const items = review[k] as string[];
        if (items.length === 0) return null;
        return (
          <div key={k} className="mt-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12px] leading-4.5 text-ink-soft">
              {items.map((it, i) => (
                <li key={i}>{it}</li>
              ))}
            </ul>
          </div>
        );
      })}
      {review.relevance && (
        <p className="mt-2 rounded-md bg-surface-2 px-2.5 py-1.5 text-[12px] leading-5 text-ink-soft">
          <span className="font-medium text-ink">Relevance: </span>
          {review.relevance}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel shell
// ---------------------------------------------------------------------------

export type PanelTab = "discussion" | "ai" | "reviews";

export function RightPanel({
  paper,
  annotations,
  orphaned,
  reviews,
  aiCards,
  user,
  activeTab,
  onTabChange,
  onClose,
  onSummarize,
  onSelectAnnotation,
  onRefreshReviews,
  summarizeBusy,
  citeNotice,
}: {
  paper: LibraryPaper;
  annotations: Annotation[];
  orphaned: Annotation[];
  reviews: Review[];
  aiCards: AiCard[];
  user: SessionUser;
  activeTab: PanelTab;
  onTabChange: (t: PanelTab) => void;
  onClose: () => void;
  onSummarize: () => void;
  onSelectAnnotation: (a: Annotation) => void;
  onRefreshReviews: () => void;
  summarizeBusy: boolean;
  citeNotice?: string | null;
}) {
  const myReview = reviews.find((r) => r.author.id === user.id);
  const [editing, setEditing] = useState(false);
  const [tldr, setTldr] = useState("");
  const [lists, setLists] = useState<Record<(typeof LIST_FIELDS)[number][0], string[]>>({
    contributions: [],
    strengths: [],
    weaknesses: [],
    findings: [],
    openQuestions: [],
  });
  const [relevance, setRelevance] = useState("");
  const [saving, setSaving] = useState(false);
  const pinnedRef = useRef<string | null>(null);

  function startEdit() {
    setTldr(myReview?.tldr ?? "");
    setLists({
      contributions: myReview?.contributions ?? [],
      strengths: myReview?.strengths ?? [],
      weaknesses: myReview?.weaknesses ?? [],
      findings: myReview?.findings ?? [],
      openQuestions: myReview?.openQuestions ?? [],
    });
    setRelevance(myReview?.relevance ?? "");
    setEditing(true);
  }

  async function saveReview() {
    setSaving(true);
    try {
      await api.putMyReview(paper.groupId, paper.id, {
        tldr: tldr.trim(),
        contributions: lists.contributions.filter((s) => s.trim()),
        strengths: lists.strengths.filter((s) => s.trim()),
        weaknesses: lists.weaknesses.filter((s) => s.trim()),
        findings: lists.findings.filter((s) => s.trim()),
        openQuestions: lists.openQuestions.filter((s) => s.trim()),
        relevance: relevance.trim(),
      });
      setEditing(false);
      onRefreshReviews();
    } finally {
      setSaving(false);
    }
  }

  const discussionCount = annotations.length;

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col border-l border-line bg-bg-raised">
      <div className="flex items-center border-b border-line pr-1">
        <div className="flex-1">
          <Tabs
            active={activeTab}
            onChange={(id) => onTabChange(id as PanelTab)}
            tabs={[
              { id: "discussion", label: "Discussion", count: discussionCount, icon: <MessageSquare size={12} /> },
              { id: "ai", label: "AI", count: aiCards.length, icon: <Sparkles size={12} /> },
              { id: "reviews", label: "Reviews", count: reviews.length, icon: <ScrollText size={12} /> },
            ]}
          />
        </div>
        <button className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={onClose} aria-label="Close panel">
          <PanelRightClose size={15} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === "discussion" && (
          <div className="space-y-2">
            {annotations.length === 0 && orphaned.length === 0 && (
              <EmptyState
                icon={<MessageSquare size={18} />}
                title="No threads yet"
                body="Select text in the PDF to highlight it or start a discussion."
              />
            )}
            {annotations.map((a) => {
              const count = a.comments.reduce((n, c) => n + 1 + c.replies.length, 0);
              return (
                <button
                  key={a.id}
                  data-ann-id={a.id}
                  onClick={() => onSelectAnnotation(a)}
                  className={cn(
                    "w-full rounded-lg border border-line bg-surface p-2.5 text-left hover:border-line-strong",
                    pinnedRef.current === a.id && "border-accent/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: annotationColorCss(a.color) }} />
                    <span className="text-[11px] font-medium">{a.author.displayName}</span>
                    {a.visibility === "private" && (
                      <Badge tone="warn">
                        <EyeOff size={9} /> private
                      </Badge>
                    )}
                    <span className="ml-auto text-[10px] text-muted">
                      p.{a.anchor.pageIndex + 1} · {relativeTime(a.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] italic leading-4.5 text-ink-soft">
                    “{truncate(a.anchor.quote.exact, 100)}”
                  </p>
                  <p className="mt-1 text-[11px] text-muted">
                    {count} comment{count === 1 ? "" : "s"}
                  </p>
                </button>
              );
            })}
            {orphaned.length > 0 && (
              <div className="pt-2">
                <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-warn">
                  <AlertTriangle size={10} /> Orphaned anchors ({orphaned.length})
                </p>
                {orphaned.map((a) => (
                  <div key={a.id} className="mb-1.5 rounded-lg border border-warn/30 bg-warn-soft/40 p-2.5">
                    <p className="line-clamp-2 text-[11px] italic leading-4 text-ink-soft">
                      “{truncate(a.anchor.quote.exact, 90)}”
                    </p>
                    <p className="mt-1 text-[10px] text-muted">
                      {a.author.displayName} · text no longer found on page {a.anchor.pageIndex + 1}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "ai" && (
          <div className="space-y-2.5">
            {citeNotice && (
              <p className="rounded-md border border-warn/30 bg-warn-soft/40 px-2.5 py-1.5 text-[11px] leading-4 text-ink-soft">
                Citation index unavailable — {citeNotice}
              </p>
            )}
            <Button variant="outline" size="sm" className="w-full" disabled={summarizeBusy} onClick={onSummarize}>
              {summarizeBusy ? <Spinner size={13} /> : <Sparkles size={13} />}
              Summarize this paper
            </Button>
            {aiCards.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={18} />}
                title="AI side panel"
                body="Summarize this paper, or click a citation marker in the PDF and choose Explain — results stream here as cards."
              />
            ) : (
              aiCards.map((c) => <AiCardView key={c.id} card={c} />)
            )}
          </div>
        )}

        {activeTab === "reviews" && (
          <div className="space-y-2.5">
            {editing ? (
              <div className="space-y-3 rounded-lg border border-accent/30 bg-surface p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your review</p>
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">TL;DR *</p>
                  <Textarea rows={2} value={tldr} onChange={(e) => setTldr(e.target.value)} className="text-[13px]" placeholder="One-sentence take" />
                </div>
                {LIST_FIELDS.map(([k, label]) => (
                  <ListEditor
                    key={k}
                    label={label}
                    items={lists[k]}
                    onChange={(items) => setLists({ ...lists, [k]: items })}
                    placeholder={`Add ${label.toLowerCase().replace(/s$/, "")}`}
                  />
                ))}
                <div>
                  <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Relevance to our work</p>
                  <Textarea rows={2} value={relevance} onChange={(e) => setRelevance(e.target.value)} className="text-[13px]" />
                </div>
                <div className="flex gap-1.5">
                  <Button size="xs" disabled={saving || !tldr.trim()} onClick={saveReview}>
                    Save review
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={startEdit}>
                {myReview ? "Edit your review" : "Write a structured review"}
              </Button>
            )}
            {reviews.length === 0 && !editing && (
              <EmptyState
                icon={<ScrollText size={18} />}
                title="No reviews yet"
                body="Structured reviews — tldr, contributions, strengths, weaknesses — shared with the group."
              />
            )}
            {reviews.map((r) => (
              <ReviewCard
                key={r.id}
                review={r}
                mine={r.author.id === user.id}
                onDelete={
                  r.author.id === user.id
                    ? async () => {
                        await api.deleteMyReview(paper.groupId, paper.id);
                        onRefreshReviews();
                      }
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
