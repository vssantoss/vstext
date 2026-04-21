import { describe, expect, it, vi } from "vitest";
import { loadBrowserWorkspaceFromHandle } from "./localWorkspace";

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

  it("keeps files already scanned inside a folder that gets skipped", async () => {
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
    expect(result.files.map((file) => file.path)).toEqual(["node_modules/keep.js", "README.md"]);
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
});
