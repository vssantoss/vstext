import { describe, expect, it, vi } from "vitest";
import { createProviderRegistry, createProviderStatuses, getConfiguredCloudProviderCount } from "./providers";
import type { AppDesktopApi, ProviderStatus, WorkspaceFileSnapshot } from "../types";

function createBrowserRefs() {
  return {
    browserWorkspaceDirectoryHandleRef: {
      current: null
    },
    browserWorkspaceFileHandlesRef: {
      current: new Map<string, FileSystemFileHandle>()
    }
  };
}

describe("provider runtime", () => {
  it("reports the local provider as ready and cloud providers as scaffolded or planned", () => {
    const statuses = createProviderStatuses();
    const local = statuses.find((status) => status.provider === "local");
    const clouds = statuses.filter((status) => status.provider !== "local");

    expect(local?.readiness).toBe("ready");
    expect(local?.configured).toBe(true);
    expect(clouds).toHaveLength(3);
    expect(clouds.every((status) => status.readiness === "scaffolded" || status.readiness === "needs-config")).toBe(
      true
    );
  });

  it("counts only configured cloud providers in the activity badge", () => {
    const statuses: ProviderStatus[] = [
      {
        provider: "local",
        label: "Local Filesystem",
        configured: true,
        connected: true,
        readiness: "ready",
        description: "Local provider",
        statusLabel: "Ready now",
        capabilities: {
          auth: false,
          workspaceDiscovery: true,
          openWorkspace: true,
          readFile: true,
          writeFile: true,
          pollWorkspace: true,
          bundleSync: true
        }
      },
      {
        provider: "onedrive",
        label: "OneDrive",
        configured: true,
        connected: false,
        readiness: "scaffolded",
        description: "Scaffolded",
        statusLabel: "Pending",
        capabilities: {
          auth: true,
          workspaceDiscovery: true,
          openWorkspace: true,
          readFile: true,
          writeFile: true,
          pollWorkspace: true,
          bundleSync: true
        }
      },
      {
        provider: "gdrive",
        label: "Google Drive",
        configured: false,
        connected: false,
        readiness: "needs-config",
        description: "Needs config",
        statusLabel: "Needs client id",
        capabilities: {
          auth: true,
          workspaceDiscovery: true,
          openWorkspace: true,
          readFile: true,
          writeFile: true,
          pollWorkspace: true,
          bundleSync: true
        }
      }
    ];

    expect(getConfiguredCloudProviderCount(statuses)).toBe(1);
  });

  it("routes local provider I/O through the desktop API when available", async () => {
    const snapshot: WorkspaceFileSnapshot = {
      path: "notes.md",
      absolutePath: "C:/workspace/notes.md",
      modifiedAt: "2026-04-20T12:00:00.000Z",
      size: 7,
      exists: true
    };

    const electronAPI = {
      readFile: vi.fn(async () => "# Notes"),
      readFileBytes: vi.fn(async () => new TextEncoder().encode("pdf").buffer),
      writeFile: vi.fn(async () => ({
        modifiedAt: "2026-04-20T12:00:00.000Z",
        size: 7
      })),
      getFileSnapshot: vi.fn(async () => snapshot),
      scanWorkspace: vi.fn(async () => [snapshot])
    } as Pick<AppDesktopApi, "readFile" | "readFileBytes" | "writeFile" | "getFileSnapshot" | "scanWorkspace"> as AppDesktopApi;

    const registry = createProviderRegistry({
      electronAPI,
      ...createBrowserRefs()
    });

    await expect(
      registry.local.readText({
        path: "notes.md",
        absolutePath: "C:/workspace/notes.md"
      })
    ).resolves.toBe("# Notes");
    await expect(
      registry.local.writeText(
        {
          path: "notes.md",
          absolutePath: "C:/workspace/notes.md"
        },
        "# Notes"
      )
    ).resolves.toEqual({
      modifiedAt: "2026-04-20T12:00:00.000Z",
      size: 7
    });
    await expect(
      registry.local.getSnapshot({
        path: "notes.md",
        absolutePath: "C:/workspace/notes.md"
      })
    ).resolves.toEqual(snapshot);
    await expect(registry.local.scanWorkspace("C:/workspace")).resolves.toEqual([snapshot]);

    expect(electronAPI.readFile).toHaveBeenCalledWith("C:/workspace/notes.md");
    expect(electronAPI.writeFile).toHaveBeenCalledWith("C:/workspace/notes.md", "# Notes");
    expect(electronAPI.getFileSnapshot).toHaveBeenCalledWith("C:/workspace/notes.md");
    expect(electronAPI.scanWorkspace).toHaveBeenCalledWith("C:/workspace", []);
  });

  it("forwards skipped folders when polling the current workspace", async () => {
    const electronAPI = {
      scanWorkspace: vi.fn(async () => [])
    } as Pick<AppDesktopApi, "scanWorkspace"> as AppDesktopApi;

    const registry = createProviderRegistry({
      electronAPI,
      ...createBrowserRefs()
    });

    await expect(registry.local.scanWorkspace("C:/workspace", ["node_modules", "dist"])).resolves.toEqual([]);
    expect(electronAPI.scanWorkspace).toHaveBeenCalledWith("C:/workspace", ["node_modules", "dist"]);
  });
});
