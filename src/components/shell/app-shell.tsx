"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import {
  ChevronsLeft,
  PanelLeft,
  Plus,
  Users,
} from "lucide-react";
import type { Group, LibraryPaper } from "@/contracts";
import { api, API_MOCK } from "@/lib/client/api";
import { signOut, useSessionUser } from "@/lib/client/auth";
import { cn } from "@/lib/client/utils";
import { Avatar, EmptyState, Spinner } from "@/components/ui/atoms";
import { Button } from "@/components/ui/controls";
import { GroupMenu } from "./group-menu";
import { LibraryRail } from "./library-rail";
import { ImportBar } from "./import-bar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { authorColor } from "@/lib/client/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useSessionUser();

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [papers, setPapers] = useState<LibraryPaper[] | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const gidMatch = pathname.match(/\/g\/([0-9a-fA-F-]{36})/);
  const activeGid = gidMatch?.[1] ?? null;
  const isReader = /\/g\/[0-9a-fA-F-]{36}\/p\//.test(pathname);

  useEffect(() => {
    if (isReader) setCollapsed(true);
  }, [isReader]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    api.me().then((res) => setGroups(res.groups)).catch(() => setGroups([]));
  }, [user]);

  const refreshLibrary = useCallback(() => {
    if (!activeGid) {
      setPapers([]);
      return;
    }
    api.listLibrary(activeGid).then((res) => setPapers(res.papers)).catch(() => setPapers([]));
  }, [activeGid]);

  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  // Mock-mode library live refresh (real mode gets it via realtime/refetch).
  // The mock module is lazy-imported so it stays out of real-mode bundles.
  useEffect(() => {
    if (!API_MOCK || !activeGid) return;
    let listeners: Set<(groupId: string) => void> | undefined;
    let alive = true;
    const listener = (gid: string) => {
      if (gid === activeGid) refreshLibrary();
    };
    void import("@/lib/client/mock").then((m) => {
      if (!alive) return;
      listeners = m.mockLibraryListeners;
      listeners.add(listener);
    });
    return () => {
      alive = false;
      listeners?.delete(listener);
    };
  }, [activeGid, refreshLibrary]);

  const activeGroup = useMemo(
    () => groups?.find((g) => g.id === activeGid) ?? null,
    [groups, activeGid],
  );

  // Redirect to the first group when landing inside the shell without a gid.
  useEffect(() => {
    if (!loading && user && groups && !activeGid && groups.length > 0) {
      router.replace(`/g/${groups[0].id}`);
    }
  }, [loading, user, groups, activeGid, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <Spinner size={22} />
      </div>
    );
  }

  const shellWide = isReader ? "grid" : "grid";

  return (
    <div className={cn("h-screen bg-bg text-ink", shellWide)} style={{ gridTemplateColumns: collapsed ? "0px 1fr" : "288px 1fr" }}>
      {/* Left rail */}
      <aside
        className={cn(
          "flex h-screen flex-col border-r border-line bg-bg-raised transition-[opacity] duration-150",
          collapsed && "pointer-events-none opacity-0",
        )}
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          <Image src="/logo.svg" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">Research Commons</span>
          <div className="ml-auto flex items-center">
            <ThemeToggle />
            <button
              aria-label="Collapse sidebar"
              className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
              onClick={() => setCollapsed(true)}
            >
              <ChevronsLeft size={15} />
            </button>
          </div>
        </div>

        {groups && groups.length > 0 ? (
          <>
            <GroupMenu
              groups={groups}
              active={activeGroup}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onSelect={(g) => router.push(`/g/${g.id}`)}
              onChanged={() => api.me().then((r) => setGroups(r.groups))}
            />
            <ImportBar groupId={activeGid} onImported={refreshLibrary} />
            <LibraryRail
              groupId={activeGid}
              papers={papers}
            />
          </>
        ) : (
          <div className="flex-1 px-4 py-8">
            <EmptyState
              icon={<Users size={22} />}
              title="No groups yet"
              body="Create a group or join one with an invite code to start a shared library."
              action={
                <Button size="sm" onClick={() => setMenuOpen(true)}>
                  <Plus size={14} /> New group
                </Button>
              }
            />
            <GroupMenu
              groups={groups ?? []}
              active={null}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onSelect={(g) => router.push(`/g/${g.id}`)}
              onChanged={() => api.me().then((r) => setGroups(r.groups))}
            />
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
          <Avatar name={user.displayName} color={authorColor(user.id)} size={24} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-4">{user.displayName}</p>
            <p className="truncate text-[11px] text-muted">{user.email}</p>
          </div>
          <button
            className="text-[11px] font-medium text-muted hover:text-ink"
            onClick={() => signOut().then(() => router.replace("/login"))}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Expand handle when collapsed */}
      {collapsed && (
        <button
          aria-label="Expand sidebar"
          className="fixed left-0 top-0 z-40 m-2 rounded-md border border-line bg-surface p-1.5 text-muted shadow-card hover:text-ink"
          onClick={() => setCollapsed(false)}
        >
          <PanelLeft size={16} />
        </button>
      )}

      <main className="h-screen overflow-hidden">{children}</main>
    </div>
  );
}
