import { describe, expect, it } from "vitest";
import { mergeSampleWorkspaceBuffers, readSampleWorkspaceText, sampleBuffers } from "./sampleWorkspace";

describe("sample workspace helpers", () => {
  it("reads bundled sample file contents without a runtime provider", () => {
    expect(readSampleWorkspaceText("README.md")).toContain("This starter workspace shows");
  });

  it("restores built-in sample buffers when cached buffers are missing", () => {
    const merged = mergeSampleWorkspaceBuffers([]);

    expect(merged).toHaveLength(sampleBuffers.length);
    expect(merged.map((buffer) => buffer.documentId).sort()).toEqual(
      sampleBuffers.map((buffer) => buffer.documentId).sort()
    );
  });

  it("prefers cached sample buffers over the built-in defaults", () => {
    const override = {
      ...sampleBuffers[0],
      cachedBody: "# Custom sample",
      dirty: true,
      persistedLocal: true
    };

    const merged = mergeSampleWorkspaceBuffers([override]);
    const restored = merged.find((buffer) => buffer.documentId === override.documentId);

    expect(restored).toMatchObject({
      cachedBody: "# Custom sample",
      dirty: true,
      persistedLocal: true
    });
  });
});
