import { describe, expect, it } from "vitest";
import { detectRuntimePlatform, formatAbsolutePathForClipboard } from "./platform";

describe("detectRuntimePlatform", () => {
  it("detects Windows, macOS, and Linux platform strings", () => {
    expect(detectRuntimePlatform("Win32")).toBe("windows");
    expect(detectRuntimePlatform("MacIntel")).toBe("mac");
    expect(detectRuntimePlatform("Linux x86_64")).toBe("linux");
  });
});

describe("formatAbsolutePathForClipboard", () => {
  it("converts Windows absolute paths back to native separators", () => {
    expect(formatAbsolutePathForClipboard("C:/Users/Victor/workspace/pnpm-lock.yaml", "windows")).toBe(
      "C:\\Users\\Victor\\workspace\\pnpm-lock.yaml"
    );
    expect(formatAbsolutePathForClipboard("//server/share/docs/readme.md", "windows")).toBe(
      "\\\\server\\share\\docs\\readme.md"
    );
  });

  it("leaves relative paths untouched on Windows", () => {
    expect(formatAbsolutePathForClipboard("src/components/Shell.tsx", "windows")).toBe("src/components/Shell.tsx");
  });

  it("leaves absolute paths untouched on non-Windows platforms", () => {
    expect(formatAbsolutePathForClipboard("C:/Users/Victor/workspace/pnpm-lock.yaml", "mac")).toBe(
      "C:/Users/Victor/workspace/pnpm-lock.yaml"
    );
  });
});
