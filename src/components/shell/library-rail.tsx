"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, FileText, Search, Tag, X } from "lucide-react";
import type { LibraryPaper } from "@/contracts";
import { cn, authorList } from "@/lib/client/utils";
import { Badge, EmptyState, Skeleton } from "@/components/ui/atoms";

const STATUS_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  ready: { label: "ready", tone: "ok" },
  pending: { label: "queued", tone: "neutral" },
  processing: { label: "processing", tone: "warn" },
  failed: { label: "failed", tone: "danger" },
};

export function LibraryRail({
  groupId,
  papers,
}: {
  groupId: string | null;
  papers: LibraryPaper[] | null;
}) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const tags = useMemo(() => {
    const all = new Set<string>();
    for (const p of papers ?? []) for (const t of p.tags) all.add(t);
    return [...all].sort();
  }, [papers]);

  const filtered = useMemo(() => {
    let list = papers ?? [];
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(needle) ||
          p.authors.some((a) => a.toLowerCase().includes(needle)) ||
          (p.abstract ?? "").toLowerCase().includes(needle),
      );
    }
    return list;
  }, [papers, q, tag]);

  // "/" focuses search from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search library  ( / )"
            className="h-8 w-full rounded-md border border-line bg-surface pl-7 pr-7 text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none"
          />
          {q && (
            <button
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
              onClick={() => setQ("")}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => setTag(tag === t ? null : t)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                tag === t ? "bg-accent-soft text-accent-strong" : "bg-surface-2 text-ink-soft hover:text-ink",
              )}
            >
              <Tag size={10} /> {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {papers === null ? (
          <div className="space-y-2 px-1 pt-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={20} />}
            title={papers.length === 0 ? "Library is empty" : "No matches"}
            body={
              papers.length === 0
                ? "Import a paper from arXiv or upload a PDF above."
                : "Try a different search or clear the tag filter."
            }
          />
        ) : (
          <ul className="space-y-1">
            {filtered.map((p) => {
              const href = groupId ? `/g/${groupId}/p/${p.id}` : "#";
              const active = pathname === href;
              const st = STATUS_LABEL[p.processingStatus] ?? STATUS_LABEL.pending;
              return (
                <li key={p.id}>
                  <Link
                    href={href}
                    className={cn(
                      "block rounded-lg border px-2.5 py-2 transition-colors",
                      active
                        ? "border-accent/40 bg-accent-soft/40"
                        : "border-transparent hover:border-line hover:bg-surface",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <FileText size={13} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-[13px] font-medium leading-4.5 text-ink">
                          {p.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted">
                          {authorList(p.authors)}
                          {p.year ? ` · ${p.year}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Badge tone={st.tone} className={cn(st.label === "processing" && "animate-pulse")}>
                            {st.label}
                          </Badge>
                          {p.annotationCount > 0 && <Badge>{p.annotationCount} notes</Badge>}
                          {p.reviewCount > 0 && <Badge>{p.reviewCount} reviews</Badge>}
                          {p.tags.slice(0, 2).map((t) => (
                            <Badge key={t} className="font-normal text-muted">
                              #{t}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
