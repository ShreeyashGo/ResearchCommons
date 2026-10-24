"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "rc-theme";

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Applies a mode to <html>; returns the resolved theme. */
export function applyTheme(mode: ThemeMode): "light" | "dark" {
  const dark = mode === "dark" || (mode === "system" && systemDark());
  document.documentElement.classList.toggle("dark", dark);
  return dark ? "dark" : "light";
}

export function setThemeMode(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {}
  applyTheme(mode);
}

/**
 * Current theme mode + resolved theme. While mode is "system", a
 * prefers-color-scheme change re-applies the class live.
 */
export function useTheme(): { mode: ThemeMode; resolved: "light" | "dark" | null; setMode: (m: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode | null>(null);
  const [resolved, setResolved] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    const m = getThemeMode();
    setMode(m);
    setResolved(applyTheme(m));
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(applyTheme("system"));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [mode]);

  const set = (m: ThemeMode) => {
    setMode(m);
    setThemeMode(m);
    setResolved(document.documentElement.classList.contains("dark") ? "dark" : "light");
  };

  return { mode: mode ?? "system", resolved, setMode: set };
}
