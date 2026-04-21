import { describe, expect, it } from "vitest";
import {
  isSupportedBinaryExtension,
  isSupportedTextExtension,
  normalizeBootstrapPayload,
  normalizeDraftPayload,
  normalizeResolutionPayload,
  normalizeSessionPayload
} from "../../../../packages/core/index.js";

describe("shared core helpers", () => {
  it("recognizes supported workspace file types from extensions or paths", () => {
    expect(isSupportedTextExtension("md")).toBe(true);
    expect(isSupportedTextExtension("notes/todo.tsx")).toBe(true);
    expect(isSupportedBinaryExtension("docs/spec.pdf")).toBe(true);
    expect(isSupportedTextExtension("archive.zip")).toBe(false);
  });

  it("normalizes bootstrap payloads without leaking device hints", () => {
    const bootstrap = normalizeBootstrapPayload({
      version: 4,
      workspaceId: "workspace-1",
      displayName: "Workspace",
      workspaceRef: {
        kind: "local",
        provider: "local",
        displayName: "Workspace",
        deviceHints: [
          {
            deviceId: "device-1",
            absolutePath: "C:/Workspace",
            updatedAt: "2026-04-20T10:00:00.000Z"
          }
        ]
      }
    });

    const workspaceRef = bootstrap?.workspaceRef as { kind?: string; deviceHints?: unknown[] } | undefined;

    expect(workspaceRef?.kind).toBe("local");
    if (workspaceRef?.kind === "local") {
      expect(workspaceRef.deviceHints).toEqual([]);
    }
  });

  it("normalizes session, draft, and resolution payloads from bundle blobs", () => {
    const session = normalizeSessionPayload(
      {
        deviceId: "device-1",
        deviceName: "desktop:test",
        openTabs: ["notes.md"],
        activeTab: "notes.md",
        layout: { sidebarOpen: true },
        sidebarState: { expandedPaths: [] },
        searchState: { query: "" },
        cursorState: {},
        themeMode: "dark"
      },
      "vstext/sessions/device-1/rev-1.session.json"
    );
    const draft = normalizeDraftPayload(
      {
        deviceId: "device-1",
        path: "notes.md",
        contentHash: "hash-1"
      },
      "vstext/drafts/device-1/doc/rev-2.draft.json"
    );
    const resolution = normalizeResolutionPayload(
      {
        path: "notes.md",
        resolvedByDeviceId: "device-1",
        clearedDraftRevisionIds: ["rev-2"]
      },
      "vstext/resolutions/doc/rev-3.resolution.json"
    );

    expect(session?.revisionId).toBe("rev-1");
    expect(draft?.revisionId).toBe("rev-2");
    expect(draft?.blobPath).toContain("rev-2.draft.json");
    expect(resolution?.revisionId).toBe("rev-3");
    expect(resolution?.clearedDraftRevisionIds).toEqual(["rev-2"]);
  });
});
