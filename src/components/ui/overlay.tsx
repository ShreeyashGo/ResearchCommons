"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/client/utils";

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cn("anim-fade-slide w-full rounded-xl border border-line bg-surface shadow-pop", width)} role="dialog" aria-modal>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="font-serif text-base font-semibold text-ink">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export interface PopoverAnchor {
  /** Viewport coordinates where the popover should appear. */
  x: number;
  y: number;
}

/**
 * Anchored popover rendered in a portal at viewport coordinates. Flips above
 * the anchor when there isn't room below; closes on Escape and on outside
 * pointer down.
 */
export function Popover({
  anchor,
  onClose,
  children,
  width = 340,
}: {
  anchor: PopoverAnchor;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const x = Math.min(Math.max(anchor.x - rect.width / 2, margin), window.innerWidth - rect.width - margin);
    let y = anchor.y + 10;
    if (y + rect.height > window.innerHeight - margin) {
      y = anchor.y - rect.height - 10;
    }
    setPos({ x, y });
  }, [anchor]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={ref}
      className="anim-fade-slide fixed z-50 rounded-lg border border-line bg-surface shadow-pop"
      style={{ left: pos?.x ?? anchor.x, top: pos?.y ?? anchor.y, width, visibility: pos ? "visible" : "hidden" }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number; icon?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 border-b border-line px-2" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
            active === t.id
              ? "border-accent text-ink"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.icon}
          {t.label}
          {t.count !== undefined && (
            <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
