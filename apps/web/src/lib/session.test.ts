import { describe, expect, it } from "vitest";
import { createBrowserLocalWorkspaceReference } from "./bundle";
import {
  buildDraftClearRefs,
  buildDraftRefs,
  buildSessionCompareItems,
  createDeviceId,
  createBundleBootstrap,
  createRuntimeManifest,
  createSessionSnapshot
} from "./session";
import type { TextDocument, WorkspaceRoot } from "../types";

const root: WorkspaceRoot = {
  id: "workspace-1",
  provider: "local",
  rootId: "workspace-1",
  displayName: "Workspace",
  kind: "local-root"
};

const dirtyDocument: TextDocument = {
  id: "doc-1",
  documentId: "doc-1",
  workspaceId: "workspace-1",
  path: "notes.md",
  name: "notes.md",
  provider: "local",
  encoding: "utf-8",
  lineEnding: "lf",
  language: "Markdown",
  size: 12,
  dirty: true,
  cachedBody: "# Hello",
  modifiedAt: "2026-04-16T00:00:00.000Z",
  lastSyncedModifiedAt: "2026-04-16T00:00:00.000Z",
  lastSyncedSize: 12,
  lastAccessedAt: Date.now(),
  persistedLocal: true,
  foreignDrafts: [],
  pendingForeignDraftCount: 0,
  isMarkdown: true
};

describe("workspace manifest helpers", () => {
  it("creates draft refs for dirty documents", () => {
    const refs = buildDraftRefs("device-1", "desktop:test", [dirtyDocument]);
    expect(refs).toHaveLength(1);
    expect(refs[0].blobPath).toContain("vstext/drafts/device-1");
    expect(refs[0].path).toBe("notes.md");
  });

  it("stores device ids under the vstext key", () => {
    globalThis.localStorage?.clear();

    const deviceId = createDeviceId();

    expect(deviceId).toBeTruthy();
    expect(globalThis.localStorage?.getItem("vstext-device-id")).toBe(deviceId);
  });

  it("creates tombstones for cleared drafts", () => {
    const refs = buildDraftRefs("device-1", "desktop:test", [dirtyDocument]);
    const cleared = buildDraftClearRefs("device-1", "desktop:test", refs, new Set());
    expect(cleared).toHaveLength(1);
    expect(cleared[0]?.deleted).toBe(true);
  });

  it("builds a runtime manifest from immutable session state", () => {
    const session = createSessionSnapshot({
      deviceId: "device-1",
      deviceName: "desktop:test",
      openTabs: ["notes.md"],
      activeTab: "notes.md",
      layout: { previewOpen: true, sidebarOpen: true, activeActivity: "files", mobilePanel: "tree" },
      sidebarState: { expandedPaths: [], searchOpen: true },
      searchState: { query: "hello", lastQuery: "hello", selectedPath: null },
      cursorState: {},
      themeMode: "dark"
    });

    const manifest = createRuntimeManifest({
      bootstrap: createBundleBootstrap({
        workspaceId: root.id,
        displayName: root.displayName,
        workspaceRef: createBrowserLocalWorkspaceReference(root.displayName)
      }),
      sessions: [session],
      drafts: buildDraftRefs("device-1", "desktop:test", [dirtyDocument]),
      resolutions: []
    });

    expect(manifest.deviceSessions[0]?.deviceId).toBe("device-1");
    expect(manifest.themeMode).toBe("dark");
    expect(manifest.workspaceRef.kind).toBe("local");
    expect(manifest.draftRefs[0]?.path).toBe("notes.md");
  });

  it("builds compare items for two sessions", () => {
    const localSession = createSessionSnapshot({
      deviceId: "device-1",
      deviceName: "desktop:test",
      openTabs: ["notes.md"],
      activeTab: "notes.md",
      layout: { previewOpen: true, sidebarOpen: true, activeActivity: "files", mobilePanel: "tree" },
      sidebarState: { expandedPaths: ["notes"], searchOpen: true },
      searchState: { query: "", lastQuery: "", selectedPath: null },
      cursorState: {},
      themeMode: "light"
    });
    const remoteSession = createSessionSnapshot({
      deviceId: "device-2",
      deviceName: "web:test",
      openTabs: ["notes.md", "todo.md"],
      activeTab: "todo.md",
      layout: { previewOpen: false, sidebarOpen: false, activeActivity: "search", mobilePanel: "preview" },
      sidebarState: { expandedPaths: [], searchOpen: false },
      searchState: { query: "todo", lastQuery: "todo", selectedPath: "todo.md" },
      cursorState: {},
      themeMode: "dark"
    });

    const items = buildSessionCompareItems(localSession, remoteSession, "light", "dark");
    expect(items.find((item) => item.id === "theme")?.remoteValue).toBe("dark");
    expect(items.find((item) => item.id === "tabs")?.type).toBe("tabs");
  });
});
