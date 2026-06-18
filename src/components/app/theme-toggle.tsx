"use client";

import { useCallback, useSyncExternalStore } from "react";

import { Icon } from "@/components/ui/icon";
import { nextTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

// The applied theme lives on <html data-theme>, set before paint by the inline
// script in layout.tsx. We read it via useSyncExternalStore (no effect/setState,
// which this repo's lint bans, and it stays hydration-safe).
const listeners = new Set<() => void>();

function readStored(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onOsChange = (event: MediaQueryListEvent) => {
    // Follow the OS only while the user hasn't made an explicit choice.
    const stored = readStored();
    if (stored !== "light" && stored !== "dark") {
      document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    }
    onChange();
  };
  mq.addEventListener("change", onOsChange);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onOsChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can throw in private mode; the in-page switch still works.
  }
  listeners.forEach((notify) => notify());
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";
  const toggle = useCallback(() => applyTheme(nextTheme(theme)), [theme]);

  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon btn--sm"
      onClick={toggle}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label="Toggle color theme"
      aria-pressed={isDark}
    >
      <Icon name={isDark ? "sun" : "moon"} size={14} />
    </button>
  );
}
