import { afterEach, describe, expect, it, vi } from "vitest";
import { applyResolvedTheme, resolveThemeMode } from "./theme";

describe("resolveThemeMode", () => {
  it("returns the system preference when theme mode is system", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
  });

  it("keeps an explicit override", () => {
    expect(resolveThemeMode("light", true)).toBe("light");
    expect(resolveThemeMode("dark", false)).toBe("dark");
  });
});

describe("applyResolvedTheme", () => {
  const originalElectronApi = window.electronAPI;

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    window.electronAPI = originalElectronApi;
  });

  it("updates the DOM theme and forwards it to Electron when available", () => {
    const setWindowTheme = vi.fn().mockResolvedValue(true);
    window.electronAPI = { setWindowTheme } as unknown as NonNullable<typeof window.electronAPI>;

    applyResolvedTheme("light");

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(setWindowTheme).toHaveBeenCalledWith("light");
  });
});
