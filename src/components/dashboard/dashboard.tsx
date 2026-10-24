"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  BookOpen,
  FileText,
  Highlighter,
  MessageSquare,
  ScrollText,
  Users,
} from "lucide-react";
import type { ActivityItem, DashboardResponse, Group, LibraryPaper } from "@/contracts";
import { api } from "@/lib/client/api";
import { authorColor, authorList, cn, PAPER_STATUS, relativeTime, truncate } from "@/lib/client/utils";
import { Avatar, Badge, Card, EmptyState, Skeleton } from "@/components/ui/atoms";

function StatCard({
  icon,
  label,
  value,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  delay?: number;
}) {
  return (
    <Card
      className="anim-fade-slide flex items-center gap-3 px-4 py-3.5 transition-transform duration-150 hover:-translate-y-0.5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        {icon}
      </span>
      <div>
        <p className="text-xl font-semibold leading-6">{value}</p>
        <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      </div>
    </Card>
  );
}

function PaperRow({ groupId, paper, accent }: { groupId: string; paper: LibraryPaper; accent?: boolean }) {
  const st = PAPER_STATUS[paper.processingStatus] ?? PAPER_STATUS.pending;
  return (
    <Link
      href={`/g/${groupId}/p/${paper.id}`}
      className={cn(
        "group flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        accent ? "border-accent/30 bg-accent-soft/30 hover:bg-accent-soft/50" : "border-line bg-surface hover:border-line-strong",
      )}
    >
      <FileText size={15} className="mt-0.5 shrink-0 text-muted transition-colors group-hover:text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-ink">{paper.title}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          {authorList(paper.authors)}
          {paper.year ? ` · ${paper.year}` : ""} · added {relativeTime(paper.addedAt)}
          {paper.addedBy ? ` by ${paper.addedBy.displayName}` : ""}
        </p>
      </div>
      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <Badge tone={st.tone} className={cn(paper.processingStatus === "processing" && "animate-pulse")}>
          {st.label}
        </Badge>
        {paper.annotationCount > 0 && (
          <Badge tone="accent">
            <Highlighter size={10} /> {paper.annotationCount}
          </Badge>
        )}
        {paper.reviewCount > 0 && <Badge>{paper.reviewCount} reviews</Badge>}
      </span>
    </Link>
  );
}

function ActivityRow({ item, groupId }: { item: ActivityItem; groupId: string }) {
  const href = `/g/${groupId}/p/${item.paperId}`;
  const verb =
    item.type === "paper_added"
      ? "added"
      : item.type === "annotation_created"
        ? "highlighted"
        : item.type === "comment_created"
          ? "commented on"
          : "reviewed";
  const snippet =
    item.type === "annotation_created"
      ? `“${truncate(item.quote, 90)}”`
      : item.type === "comment_created"
        ? `“${truncate(item.excerpt, 90)}”`
        : item.type === "review_saved"
          ? `“${truncate(item.tldr, 90)}”`
          : null;

  return (
    <Link href={href} className="flex gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
      {item.actor ? (
        <Avatar name={item.actor.displayName} color={authorColor(item.actor.id)} size={24} />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-2 text-muted">
          <Activity size={12} />
        </span>
      )}
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <span className="font-medium">{item.actor?.displayName ?? "Someone"}</span>{" "}
        <span className="text-ink-soft">{verb}</span>{" "}
        <span className="font-medium">{truncate(item.paperTitle, 60)}</span>
        {snippet && <span className="block truncate text-muted">{snippet}</span>}
      </div>
      <span className="shrink-0 pt-0.5 text-[11px] text-muted">{relativeTime(item.at)}</span>
    </Link>
  );
}

export function Dashboard({ groupId }: { groupId: string }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    Promise.all([api.dashboard(groupId), api.getGroup(groupId)])
      .then(([d, g]) => {
        if (!alive) return;
        setData(d);
        setGroup(g.group);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      alive = false;
    };
  }, [groupId]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="Couldn't load the dashboard" body={error} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <header className="mb-6 anim-fade-slide">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">
              {group?.name ?? <Skeleton className="inline-block h-7 w-40" />}
            </h1>
            {group && (
              <span className="flex items-center gap-2 text-xs text-muted">
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[10px]">
                  invite · {group.inviteCode}
                </span>
                <span>
                  {group.memberCount} member{group.memberCount === 1 ? "" : "s"} · {group.paperCount} paper
                  {group.paperCount === 1 ? "" : "s"}
                </span>
              </span>
            )}
          </div>
          {group?.description ? (
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-soft">{group.description}</p>
          ) : null}
        </header>

        {!data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-[72px]" />
              ))}
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-5">
              <div className="space-y-1.5 lg:col-span-3">
                <Skeleton className="h-3 w-28" />
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[62px]" />
                ))}
              </div>
              <div className="lg:col-span-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-2.5 h-64" />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <StatCard icon={<BookOpen size={16} />} label="Papers" value={data.stats.papers} />
              <StatCard icon={<Highlighter size={16} />} label="Notes" value={data.stats.annotations} delay={40} />
              <StatCard icon={<MessageSquare size={16} />} label="Comments" value={data.stats.comments} delay={80} />
              <StatCard icon={<ScrollText size={16} />} label="Reviews" value={data.stats.reviews} delay={120} />
              <StatCard icon={<Users size={16} />} label="Members" value={data.stats.members} delay={160} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-5">
              <section className="lg:col-span-3">
                <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Recently added
                </h2>
                <div className="space-y-1.5">
                  {data.recentPapers.length === 0 ? (
                    <EmptyState
                      title="No papers yet"
                      body="Import an arXiv paper or upload a PDF from the sidebar."
                    />
                  ) : (
                    data.recentPapers.map((p) => <PaperRow key={p.id} groupId={groupId} paper={p} />)
                  )}
                </div>

                {data.recentlyAnnotated.length > 0 && (
                  <>
                    <h2 className="mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-wider text-muted">
                      Active discussions
                    </h2>
                    <div className="space-y-1.5">
                      {data.recentlyAnnotated.map((p) => (
                        <PaperRow key={p.id} groupId={groupId} paper={p} accent />
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="lg:col-span-2">
                <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  Activity
                </h2>
                <Card className="divide-y divide-line px-1 py-1">
                  {data.activity.length === 0 ? (
                    <EmptyState title="Quiet so far" body="Highlights and comments will show up here." />
                  ) : (
                    data.activity.map((item, i) => <ActivityRow key={i} item={item} groupId={groupId} />)
                  )}
                </Card>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
