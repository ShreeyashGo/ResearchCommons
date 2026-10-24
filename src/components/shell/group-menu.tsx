"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, KeyRound, Plus, Users } from "lucide-react";
import type { Group } from "@/contracts";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/client/utils";
import { Button, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/overlay";

export function GroupMenu({
  groups,
  active,
  open,
  onOpenChange,
  onSelect,
  onChanged,
}: {
  groups: Group[];
  active: Group | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (g: Group) => void;
  onChanged: () => void;
}) {
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res =
        tab === "create"
          ? await api.createGroup({ name: name.trim(), description: description.trim() })
          : await api.joinGroup({ inviteCode: inviteCode.trim().toLowerCase() });
      onChanged();
      onOpenChange(false);
      setName("");
      setDescription("");
      setInviteCode("");
      onSelect(res.group);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative px-3 pb-2" ref={dropRef}>
      <button
        className="flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left shadow-card hover:border-line-strong"
        onClick={() => setDropOpen((v) => !v)}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-ink-soft">
          <Users size={13} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">
            {active ? active.name : "Select a group"}
          </span>
          {active && (
            <span className="block text-[11px] text-muted">
              {active.memberCount} member{active.memberCount === 1 ? "" : "s"} · {active.paperCount} papers
            </span>
          )}
        </span>
        <ChevronDown size={14} className="text-muted" />
      </button>

      {dropOpen && (
        <div className="absolute inset-x-3 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-surface shadow-pop">
          {groups.map((g) => (
            <button
              key={g.id}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2",
                g.id === active?.id && "bg-accent-soft/50",
              )}
              onClick={() => {
                setDropOpen(false);
                onSelect(g);
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{g.name}</span>
                <span className="block text-[11px] text-muted">
                  {g.memberCount} members · {g.paperCount} papers · {g.myRole}
                </span>
              </span>
              {g.id === active?.id && <Check size={14} className="text-accent" />}
            </button>
          ))}
          <button
            className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-[13px] text-accent-strong hover:bg-surface-2"
            onClick={() => {
              setDropOpen(false);
              onOpenChange(true);
            }}
          >
            <Plus size={14} /> Create or join a group
          </button>
        </div>
      )}

      {active && (
        <button
          className="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] text-muted hover:bg-surface-2 hover:text-ink"
          onClick={() => {
            navigator.clipboard?.writeText(active.inviteCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy invite code"
        >
          <KeyRound size={11} />
          Invite code <span className="font-mono text-ink-soft">{active.inviteCode}</span>
          {copied ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
        </button>
      )}

      <Dialog open={open} onClose={() => onOpenChange(false)} title="Create or join a group">
        <div className="mb-4 flex gap-1 rounded-lg bg-surface-2 p-1">
          {(["create", "join"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium capitalize transition-colors",
                tab === t ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {t === "create" ? "Create group" : "Join with code"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {tab === "create" ? (
            <>
              <Input
                placeholder="Group name, e.g. Robustness Lab"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              <Input
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </>
          ) : (
            <>
              <Input
                placeholder="Invite code, e.g. lab42x9"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                autoFocus
                className="font-mono"
              />
              <p className="text-xs text-muted">
                Ask a group owner for their invite code — it&apos;s shown under the group name in
                the sidebar.
              </p>
            </>
          )}
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <Button
            className="w-full"
            disabled={busy || (tab === "create" ? !name.trim() : inviteCode.trim().length < 4)}
            onClick={submit}
          >
            {busy ? "…" : tab === "create" ? "Create group" : "Join group"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
