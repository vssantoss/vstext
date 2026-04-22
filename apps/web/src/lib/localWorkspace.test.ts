import { describe, expect, it, vi } from "vitest";
import {
  buildTreeFromFiles,
  buildTreeFromSnapshots,
  loadBrowserWorkspaceFromHandle,
  pruneWorkspaceTreeForSkippedFolders,
  scanBrowserWorkspace
} from "./localWorkspace";
import type { FileTreeNode } from "../types";

function createFileHandle(
  name: string,
  body: string,
  options: { onGetFile?: () => void; onArrayBuffer?: () => void } = {}
): FileSystemFileHandle {
  return {
    kind: "file",
    name,
    async getFile() {
      options.onGetFile?.();
      const bytes = new TextEncoder().encode(body);

      return {
        size: bytes.byteLength,
        lastModified: Date.parse("2026-04-19T00:00:00.000Z"),
        async arrayBuffer() {
          options.onArrayBuffer?.();
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
      } as File;
    }
  } as unknown as FileSystemFileHandle;
}

function createDirectoryHandle(
  name: string,
  entries: Array<FileSystemFileHandle | FileSystemDirectoryHandle>
): FileSystemDirectoryHandle {
  return {
    kind: "directory",
    name,
    async *values() {
      for (const entry of entries) {
        yield entry;
      }
    }
  } as unknown as FileSystemDirectoryHandle;
}

describe("browser workspace loader", () => {
  it("returns the files loaded before cancellation", async () => {
    const controller = new AbortController();
    const root = createDirectoryHandle("workspace", [
      createFileHandle("first.md", "# First"),
      createFileHandle("second.md", "# Second", {
        onGetFile: () => controller.abort()
      })
    ]);

    const result = await loadBrowserWorkspaceFromHandle(root, {
      signal: controller.signal
    });

    expect(result.cancelled).toBe(true);
    expect(result.entriesProcessed).toBe(1);
    expect(result.filesLoaded).toBe(1);
    expect(result.files.map((file) => file.path)).toEqual(["first.md"]);
    expect(result.fileHandles.has("first.md")).toBe(true);
    expect(result.fileHandles.has("second.md")).toBe(false);
  });

  it("skips a requested folder and continues scanning siblings", async () => {
    const root = createDirectoryHandle("workspace", [
      createDirectoryHandle("node_modules", [
        createFileHandle("left-pad.js", "module.exports = () => {};")
      ]),
      createFileHandle("README.md", "# Workspace")
    ]);

    const result = await loadBrowserWorkspaceFromHandle(root, {
      shouldSkipFolder: (folderPath) => folderPath === "node_modules"
    });

    expect(result.cancelled).toBe(false);
    expect(result.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(result.fileHandles.has("README.md")).toBe(true);
    expect(result.fileHandles.has("node_modules/left-pad.js")).toBe(false);
  });

  it("drops files already scanned inside a folder once that folder gets skipped", async () => {
    let skipNodeModules = false;
    const root = createDirectoryHandle("workspace", [
      createDirectoryHandle("node_modules", [
        createFileHandle("keep.js", "module.exports = 'keep';", {
          onGetFile: () => {
            skipNodeModules = true;
          }
        }),
        createFileHandle("drop.js", "module.exports = 'drop';")
      ]),
      createFileHandle("README.md", "# Workspace")
    ]);

    const result = await loadBrowserWorkspaceFromHandle(root, {
      shouldSkipFolder: (folderPath) => skipNodeModules && folderPath === "node_modules"
    });

    expect(result.cancelled).toBe(false);
    expect(result.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(result.fileHandles.has("node_modules/keep.js")).toBe(true);
    expect(result.fileHandles.has("node_modules/drop.js")).toBe(false);
    expect(result.fileHandles.has("README.md")).toBe(true);
  });

  it("collects metadata without reading full file bodies during the initial scan", async () => {
    const arrayBufferSpy = vi.fn();
    const root = createDirectoryHandle("workspace", [
      createFileHandle("README.md", "# Workspace", {
        onArrayBuffer: arrayBufferSpy
      })
    ]);

    const result = await loadBrowserWorkspaceFromHandle(root);

    expect(result.files).toHaveLength(1);
    expect(arrayBufferSpy).not.toHaveBeenCalled();
  });

  it("excludes skipped folders from later browser workspace polls", async () => {
    const root = createDirectoryHandle("workspace", [
      createDirectoryHandle("node_modules", [
        createFileHandle("left-pad.js", "module.exports = () => {};")
      ]),
      createFileHandle("README.md", "# Workspace")
    ]);

    const snapshots = await scanBrowserWorkspace(root, new Map(), ["node_modules"]);

    expect(snapshots.map((snapshot) => snapshot.path)).toEqual(["README.md"]);
  });

  it("prunes cached tree entries that live under skipped folders", async () => {
    const tree: FileTreeNode[] = [
      {
        id: "node_modules",
        provider: "local",
        kind: "directory" as const,
        name: "node_modules",
        path: "node_modules",
        children: [
          {
            id: "node_modules/.pnpm",
            provider: "local",
            kind: "directory" as const,
            name: ".pnpm",
            path: "node_modules/.pnpm",
            children: [
              {
                id: "node_modules/.pnpm/pkg/index.js",
                provider: "local",
                kind: "file" as const,
                name: "index.js",
                path: "node_modules/.pnpm/pkg/index.js"
              }
            ]
          },
          {
            id: "node_modules/package.json",
            provider: "local",
            kind: "file" as const,
            name: "package.json",
            path: "node_modules/package.json"
          }
        ]
      }
    ];

    const pruned = pruneWorkspaceTreeForSkippedFolders(tree, ["node_modules/.pnpm"]);

    expect(pruned).toEqual([
      {
        id: "node_modules",
        provider: "local",
        kind: "directory",
        name: "node_modules",
        path: "node_modules",
        children: [
          {
            id: "node_modules/package.json",
            provider: "local",
            kind: "file",
            name: "package.json",
            path: "node_modules/package.json"
          }
        ]
      }
    ]);
  });

  it("rebuilds electron workspace trees with local:path ids", () => {
    const tree = buildTreeFromSnapshots(
      {
        id: "local-root:C:/workspace",
        provider: "local",
        rootId: "C:/workspace",
        rootPath: "C:/workspace",
        displayName: "workspace",
        kind: "local-root"
      },
      [
        {
          path: "src/index.ts",
          absolutePath: "C:/workspace/src/index.ts",
          modifiedAt: "2026-04-21T00:00:00.000Z",
          size: 10,
          exists: true
        }
      ]
    );

    expect(tree[0]?.id).toBe("local:src");
    expect(tree[0]?.children?.[0]?.id).toBe("local:src/index.ts");
  });

  it("rebuilds cached trees from file records using the persisted file ids", () => {
    const tree = buildTreeFromFiles(
      {
        id: "local-root:C:/workspace",
        provider: "local",
        rootId: "C:/workspace",
        rootPath: "C:/workspace",
        displayName: "workspace",
        kind: "local-root"
      },
      [
        {
          id: "local:src/index.ts",
          workspaceId: "local-root:C:/workspace",
          path: "src/index.ts",
          name: "index.ts",
          provider: "local",
          language: "TypeScript",
          size: 10,
          modifiedAt: "2026-04-21T00:00:00.000Z",
          lastSyncedModifiedAt: "2026-04-21T00:00:00.000Z",
          lastSyncedSize: 10,
          foreignDrafts: [],
          pendingForeignDraftCount: 0,
          absolutePath: "C:/workspace/src/index.ts"
        }
      ]
    );

    expect(tree[0]?.id).toBe("local:src");
    expect(tree[0]?.children?.[0]?.id).toBe("local:src/index.ts");
  });
});
