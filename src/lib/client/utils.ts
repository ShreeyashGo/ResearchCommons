export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const AUTHOR_PALETTE = [
  "#0d7377",
  "#7c5cbf",
  "#b45309",
  "#b3382c",
  "#3f7d4e",
  "#2563eb",
  "#a21caf",
  "#c2410c",
];

export function authorColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AUTHOR_PALETTE[hash % AUTHOR_PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";
}

export function authorList(authors: string[], max = 2): string {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} et al.`;
}

export const PAPER_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "neutral" | "danger" }> = {
  ready: { label: "ready", tone: "ok" },
  pending: { label: "queued", tone: "neutral" },
  processing: { label: "processing", tone: "warn" },
  failed: { label: "failed", tone: "danger" },
};

export const ANNOTATION_COLORS = [
  { name: "yellow", css: "#eab308" },
  { name: "green", css: "#22c55e" },
  { name: "blue", css: "#3b82f6" },
  { name: "pink", css: "#ec4899" },
  { name: "purple", css: "#a855f7" },
] as const;

export function annotationColorCss(name: string): string {
  return ANNOTATION_COLORS.find((c) => c.name === name)?.css ?? "#eab308";
}
