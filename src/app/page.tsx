"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  BookOpen,
  FileText,
  Highlighter,
  Library,
  Link2,
  Sparkles,
  Users,
} from "lucide-react";
import type { Group } from "@/contracts";
import { api } from "@/lib/client/api";
import { useSessionUser } from "@/lib/client/auth";
import { cn } from "@/lib/client/utils";
import { Badge, Skeleton } from "@/components/ui/atoms";
import { Button } from "@/components/ui/controls";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { GroupMenu } from "@/components/shell/group-menu";

/* ---------------------------------------------------------------------------
 * Stylized reader preview — pure CSS, demonstrates the product better than a
 * stock screenshot ever could. The "page" stays white, like the real PDF.
 * ------------------------------------------------------------------------ */

function MockLine({ w, light }: { w: string; light?: boolean }) {
  return (
    <div
      className={cn("h-[5px] rounded-full", light ? "bg-[#eceae2]" : "bg-[#d9d6cb]")}
      style={{ width: w }}
    />
  );
}

function ReaderMock() {
  return (
    <div
      aria-hidden
      className="anim-fade-slide relative rounded-2xl border border-line bg-bg-raised p-2.5 shadow-pop"
    >
      {/* window chrome */}
      <div className="flex items-center gap-1.5 px-1.5 pb-2.5">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <div className="ml-2 flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-[10px] font-medium text-ink-soft">
          <FileText size={10} className="text-muted" />
          Attention Is All You Need
        </div>
      </div>

      <div className="flex gap-2.5">
        {/* PDF page — always white */}
        <div className="relative flex-1 rounded-lg bg-white p-4 shadow-card">
          <div className="mx-auto w-3/4">
            <div className="mx-auto h-2.5 w-4/5 rounded-sm bg-[#3a382f]" />
            <div className="mx-auto mt-1.5 h-1.5 w-3/5 rounded-full bg-[#d9d6cb]" />
          </div>
          <div className="mt-4 space-y-2">
            <MockLine w="100%" />
            <MockLine w="96%" />
            <MockLine w="99%" />
            <MockLine w="88%" />
          </div>
          {/* highlighted passage + annotation dot */}
          <div className="relative mt-3 space-y-2">
            <div className="h-[5px] w-[97%] rounded-full bg-[#d9d6cb]" />
            <div className="relative">
              <div className="absolute -inset-x-0.5 -inset-y-0.5 rounded-sm bg-[#fde68a]" />
              <MockLine w="94%" light />
            </div>
            <span className="absolute -right-3.5 top-1 flex h-4 w-4 items-center justify-center rounded-full border-[1.5px] border-white bg-[#eab308] text-[8px] font-bold text-white shadow-sm">
              2
            </span>
            <MockLine w="99%" />
            <MockLine w="70%" />
          </div>
          {/* citation hotspot */}
          <div className="mt-3 space-y-2">
            <MockLine w="98%" />
            <div className="flex items-center gap-1">
              <MockLine w="38%" />
              <span className="rounded-sm border-b-[1.5px] border-dashed border-[#6d5bd0] px-0.5 text-[8px] font-semibold leading-3 text-[#6d5bd0]">
                [12]
              </span>
              <MockLine w="46%" />
            </div>
            <MockLine w="91%" />
            <MockLine w="60%" />
          </div>
        </div>

        {/* right panel */}
        <div className="hidden w-[118px] shrink-0 flex-col gap-1.5 sm:flex">
          <div className="flex gap-1 border-b border-line pb-1.5 text-[8px] font-semibold text-muted">
            <span className="border-b-2 border-accent pb-0.5 text-ink">Discuss</span>
            <span className="pb-0.5">AI</span>
            <span className="pb-0.5">Reviews</span>
          </div>
          <div className="rounded-md border border-line bg-surface p-1.5">
            <div className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-[#0d7377]" />
              <span className="text-[8px] font-medium text-ink">Alice</span>
            </div>
            <p className="mt-1 text-[7.5px] italic leading-2.5 text-ink-soft">
              “…dominant sequence transduction models…”
            </p>
            <p className="mt-0.5 text-[7px] text-muted">2 comments</p>
          </div>
          <div className="rounded-md border border-[#6d5bd0]/25 bg-[#6d5bd0]/10 p-1.5">
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[#6d5bd0]/15 px-1.5 py-px text-[7px] font-semibold text-[#6d5bd0]">
              <Sparkles size={7} /> Mock AI
            </span>
            <p className="mt-1 text-[7.5px] leading-2.5 text-ink-soft">
              Vaswani et al. replace recurrence with self-attention…
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------- */

const FEATURES = [
  {
    icon: <Library size={17} />,
    title: "A shared paper library",
    body: "Every group gets a library you build together — import from arXiv or drop in a PDF.",
  },
  {
    icon: <FileText size={17} />,
    title: "The PDF stays center stage",
    body: "A fast, virtualized reader that keeps the paper front and center while you work.",
  },
  {
    icon: <Highlighter size={17} />,
    title: "Annotations as dots on the page",
    body: "Highlight a passage and it becomes a colored dot — click it to open the discussion thread.",
  },
  {
    icon: <Link2 size={17} />,
    title: "Citation intelligence",
    body: "Reference markers light up in the text with preview cards, resolution status, and context.",
  },
  {
    icon: <Sparkles size={17} />,
    title: "An AI side panel",
    body: "Summaries and citation explanations stream into a side panel — clearly badged, always grounded.",
  },
] as const;

const STEPS = [
  { n: "1", title: "Import a paper", body: "Paste an arXiv link or upload a PDF to your group's library." },
  { n: "2", title: "Read and mark it up", body: "Highlights, private notes, and threaded discussion land right on the page." },
  { n: "3", title: "Let context come to you", body: "Citations resolve to real works; the AI panel summarizes and explains." },
] as const;

function BrandMark({ size = 7 }: { size?: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-md bg-accent text-accent-ink"
      style={{ width: size * 4, height: size * 4 }}
    >
      <BookOpen size={size * 2.2} />
    </span>
  );
}

export default function Home() {
  const { user, loading } = useSessionUser();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.me().then((r) => setGroups(r.groups)).catch(() => setGroups([]));
  }, [user]);

  const firstGroup = groups?.[0] ?? null;
  const primaryCta = loading ? null : user ? (
    firstGroup ? (
      <Link href={`/g/${firstGroup.id}`}>
        <Button size="md">
          Open {firstGroup.name} <ArrowRight size={15} />
        </Button>
      </Link>
    ) : groups === null ? (
      <Skeleton className="h-9 w-44" />
    ) : (
      <Button size="md" onClick={() => setMenuOpen(true)}>
        Create or join a group <ArrowRight size={15} />
      </Button>
    )
  ) : (
    <Link href="/login">
      <Button size="md">
        Sign in <ArrowRight size={15} />
      </Button>
    </Link>
  );

  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2.5 px-5">
          <Image src="/logo.svg" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">Research Commons</span>
          <span className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            {!loading && !user && (
              <Link href="/login">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
            )}
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : user ? (
              firstGroup ? (
                <Link href={`/g/${firstGroup.id}`}>
                  <Button variant="outline" size="sm">Open app</Button>
                </Link>
              ) : null
            ) : (
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            )}
          </span>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <div>
            <Badge tone="accent" className="mb-4">
              <Users size={11} /> Local-first · collaborative paper reader
            </Badge>
            <h1 className="font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
              Read papers together, not alone.
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-7 text-ink-soft">
              Research Commons gives your lab a shared library where the PDF stays
              center stage — highlights become discussion dots on the page,
              citations resolve into previews, and an AI panel explains what
              you&apos;re reading.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              {primaryCta}
              {!loading && !user && (
                <Link href="/signup">
                  <Button variant="outline" size="md">Create an account</Button>
                </Link>
              )}
              {user && groups !== null && groups.length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {groups.slice(1).map((g) => (
                    <Link
                      key={g.id}
                      href={`/g/${g.id}`}
                      className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-ink-soft transition-colors hover:border-accent/40 hover:text-ink"
                    >
                      {g.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            {user && groups !== null && groups.length === 0 && (
              <div className="mt-3">
                <GroupMenu
                  bare
                  groups={groups}
                  active={null}
                  open={menuOpen}
                  onOpenChange={setMenuOpen}
                  onSelect={() => window.location.reload()}
                  onChanged={() => api.me().then((r) => setGroups(r.groups))}
                />
              </div>
            )}
          </div>
          <ReaderMock />
        </div>
      </section>

      {/* features */}
      <section className="border-t border-line bg-bg-raised/60">
        <div className="mx-auto max-w-6xl px-5 py-14">
          <h2 className="font-serif text-2xl font-semibold tracking-tight">
            One room for the whole reading group
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={cn(
                  "anim-fade-slide rounded-xl border border-line bg-surface p-5 shadow-card transition-transform duration-150 hover:-translate-y-0.5",
                  i === FEATURES.length - 1 && "sm:col-span-2 lg:col-span-1",
                )}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                  {f.icon}
                </span>
                <p className="mt-3.5 text-[14px] font-semibold">{f.title}</p>
                <p className="mt-1 text-[13px] leading-5.5 text-ink-soft">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-5 py-14">
        <h2 className="font-serif text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-3.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-accent-soft font-serif text-[14px] font-semibold text-accent-strong">
                {s.n}
              </span>
              <div>
                <p className="text-[14px] font-semibold">{s.title}</p>
                <p className="mt-1 text-[13px] leading-5.5 text-ink-soft">{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-5 py-6 text-[12px] text-muted">
          <BrandMark size={5} />
          <span>Research Commons</span>
          <span className="mx-1">·</span>
          <span>Runs entirely on your machine — local Supabase, deterministic Mock AI, no keys required.</span>
        </div>
      </footer>
    </div>
  );
}
