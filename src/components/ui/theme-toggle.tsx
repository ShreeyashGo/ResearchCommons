"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/lib/client/theme";
import { cn } from "@/lib/client/utils";

const OPTIONS: { id: ThemeMode; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "Light", icon: <Sun size={13} /> },
  { id: "dark", label: "Dark", icon: <Moon size={13} /> },
  { id: "system", label: "System", icon: <Monitor size={13} /> },
];

/** Light / dark / system theme picker for the app header and landing page. */
export function ThemeToggle({ className }: { className?: string }) {
  const { mode, resolved, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // null before mount: render a neutral icon to avoid a hydration mismatch.
  const icon = resolved === "dark" ? <Moon size={15} /> : resolved === "light" ? <Sun size={15} /> : <Monitor size={15} />;

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        aria-label={`Theme: ${mode}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${mode}`}
        className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
      </button>
      {open && (
        <div
          role="menu"
          className="anim-fade-slide absolute right-0 top-full z-50 mt-1 w-32 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
        >
          {OPTIONS.map((o) => (
            <button
              key={o.id}
              role="menuitemradio"
              aria-checked={mode === o.id}
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-[12px] font-medium",
                mode === o.id ? "text-accent-strong" : "text-ink-soft hover:bg-surface-2 hover:text-ink",
              )}
              onClick={() => {
                setMode(o.id);
                setOpen(false);
              }}
            >
              {o.icon}
              <span className="flex-1 text-left">{o.label}</span>
              {mode === o.id && <Check size={12} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
