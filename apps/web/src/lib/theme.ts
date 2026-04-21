import type { ResolvedTheme, ThemeMode } from "../types";

export function resolveThemeMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") {
    return prefersDark ? "dark" : "light";
  }

  return mode;
}

export function getSystemThemePreference() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyResolvedTheme(theme: ResolvedTheme) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = theme;

  if (typeof window !== "undefined") {
    void window.electronAPI?.setWindowTheme(theme)?.catch(() => {
      // Ignore desktop theme sync failures and keep the renderer theme applied.
    });
  }
}
