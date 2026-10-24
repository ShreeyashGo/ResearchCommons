"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import type { CitationContext, Reference } from "@/contracts";
import { authorList, truncate } from "@/lib/client/utils";
import { Badge } from "@/components/ui/atoms";
import { Button } from "@/components/ui/controls";
import { Popover } from "@/components/ui/overlay";

const MATCH_TONE: Record<string, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  resolved: { tone: "ok", label: "resolved" },
  ambiguous: { tone: "warn", label: "ambiguous" },
  unresolved: { tone: "neutral", label: "unresolved" },
};

export function CitationPreview({
  anchor,
  ctx,
  reference,
  onExplain,
  onClose,
}: {
  anchor: { x: number; y: number };
  ctx: CitationContext;
  reference: Reference | undefined;
  onExplain: (ref: Reference, ctx: CitationContext) => void;
  onClose: () => void;
}) {
  const work = reference?.work;
  const st = MATCH_TONE[reference?.matchStatus ?? "unresolved"];

  return (
    <Popover anchor={anchor} onClose={onClose} width={330}>
      <div className="p-3.5">
        <div className="flex items-center gap-1.5">
          <Badge tone="ai">{ctx.markerText}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
          {reference?.label && <span className="text-[11px] text-muted">ref [{reference.label}]</span>}
        </div>
        {work ? (
          <div className="mt-2">
            <p className="text-[13px] font-medium leading-5">{work.title}</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {authorList(work.authors, 3)}
              {work.year ? ` · ${work.year}` : ""}
              {work.venue ? ` · ${work.venue}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-2 line-clamp-3 text-[12px] italic leading-5 text-ink-soft">
            {reference?.rawText ?? ctx.sentence}
          </p>
        )}
        <p className="mt-2 line-clamp-2 border-l-2 border-line pl-2 text-[11px] leading-4 text-muted">
          “{truncate(ctx.sentence, 140)}”
        </p>
        <div className="mt-3 flex items-center gap-1.5">
          {reference && (
            <Button size="xs" onClick={() => onExplain(reference, ctx)}>
              <Sparkles size={12} /> Explain citation
            </Button>
          )}
          {work?.url && (
            <a href={work.url} target="_blank" rel="noreferrer">
              <Button size="xs" variant="ghost">
                <ExternalLink size={12} /> Source
              </Button>
            </a>
          )}
          {!work && reference?.searchUrl && (
            <a href={reference.searchUrl} target="_blank" rel="noreferrer">
              <Button size="xs" variant="ghost">
                <ExternalLink size={12} /> Search
              </Button>
            </a>
          )}
        </div>
      </div>
    </Popover>
  );
}
