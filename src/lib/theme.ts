// Pure color-theme helpers. Kept free of DOM/React so the resolve + toggle
// logic is unit-testable; the inline no-flash script in layout.tsx mirrors
// resolveInitialTheme, and ThemeToggle uses nextTheme.

export type Theme = "light" | "dark";

/** Key for the persisted explicit choice. Absent = follow the OS preference. */
export const THEME_STORAGE_KEY = "counter-theme";

/**
 * Theme to apply on load: an explicit stored "light"/"dark" wins; anything else
 * (absent or junk) falls back to the OS `prefers-color-scheme` signal.
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return prefersDark ? "dark" : "light";
}

/** The theme a toggle should switch to from the current one. */
export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}
