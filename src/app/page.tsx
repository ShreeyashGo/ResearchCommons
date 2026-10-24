"use client";

import { AppShell } from "@/components/shell/app-shell";
import { Spinner } from "@/components/ui/atoms";

export default function Home() {
  return (
    <AppShell>
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    </AppShell>
  );
}
