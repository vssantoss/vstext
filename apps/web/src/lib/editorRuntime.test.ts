import { describe, expect, it } from "vitest";
import { createBufferFromBody, evictCleanBuffers, mergeLayout, resolvePreviewTabId } from "./editorRuntime";
import type { DocumentBuffer, LayoutState, WorkspaceFileRecord } from "../types";

const defaultLayout: LayoutState = {
  previewOpen: true,
  sidebarOpen: true,
  activeActivity: "files",
  mobilePanel: "tree"
};

function createFile(id: string, size = 1024): WorkspaceFileRecord {
  return {
    id,
    workspaceId: "workspace-1",
    path: `${id}.md`,
    name: `${id}.md`,
    provider: "local",
    language: "Markdown",
    size,
    modifiedAt: "2026-04-20T12:00:00.000Z",
    lastSyncedModifiedAt: "2026-04-20T12:00:00.000Z",
    lastSyncedSize: size,
    foreignDrafts: [],
    pendingForeignDraftCount: 0,
    isMarkdown: true
  };
}

function createBuffer(file: WorkspaceFileRecord, lastAccessedAt: number, dirty = false): DocumentBuffer {
  return createBufferFromBody(file, "# Notes", { lastAccessedAt, dirty });
}

describe("editor runtime", () => {
  it("coerces unavailable search views back to files in web mode", () => {
    expect(
      mergeLayout(
        {
          activeActivity: "search",
          mobilePanel: "search"
        },
        defaultLayout,
        false
      )
    ).toEqual({
      ...defaultLayout,
      activeActivity: "files",
      mobilePanel: "tree"
    });
  });

  it("evicts the oldest clean buffers while keeping dirty and pinned buffers resident", () => {
    const files = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => {
        const file = createFile(`doc-${index + 1}`);
        return [file.id, file];
      })
    );
    const buffers = Object.fromEntries(
      Object.values(files).map((file, index) => [file.id, createBuffer(file, index + 1, file.id === "doc-9")])
    );

    const retained = evictCleanBuffers(files, buffers, new Set(["doc-1"]));

    expect(Object.keys(retained)).toContain("doc-1");
    expect(Object.keys(retained)).toContain("doc-9");
    expect(Object.keys(retained)).toHaveLength(8);
    expect(retained["doc-2"]).toBeUndefined();
  });

  it("does not demote an already promoted tab on single-click activation", () => {
    expect(
      resolvePreviewTabId({
        asPreview: true,
        existingPreviewTabId: null,
        targetDocumentId: "doc-1",
        documentAlreadyOpen: true
      })
    ).toBeNull();
  });

  it("replaces the active preview tab only when opening a new preview document", () => {
    expect(
      resolvePreviewTabId({
        asPreview: true,
        existingPreviewTabId: "doc-preview",
        targetDocumentId: "doc-2",
        documentAlreadyOpen: false
      })
    ).toBe("doc-2");
  });
});
