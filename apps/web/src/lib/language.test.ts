import { describe, expect, it } from "vitest";
import { getLanguageMetadata, isMarkdownPath } from "./language";

describe("language mapping", () => {
  it("marks markdown files", () => {
    expect(getLanguageMetadata("README.md").label).toBe("Markdown");
    expect(isMarkdownPath("docs/guide.markdown")).toBe(true);
  });

  it("falls back to text for unknown extensions", () => {
    expect(getLanguageMetadata("notes.custom").label).toBe("Text");
  });
});
