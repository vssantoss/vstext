import { describe, expect, it } from "vitest";
import {
  createBrowserLocalWorkspaceReference,
  createBundleDirectoryName,
  mergeDeviceWorkspaceHint
} from "./bundle";
import type { WorkspaceReference } from "../types";

describe("bundle helpers", () => {
  it("creates a safe bundle directory name", () => {
    expect(createBundleDirectoryName(' Project: Alpha? ')).toBe("Project- Alpha-vstext");
    expect(createBundleDirectoryName("notes-vstext")).toBe("notes-vstext");
  });

  it("replaces the current device hint and preserves other devices", () => {
    const reference = {
      ...createBrowserLocalWorkspaceReference("Workspace"),
      deviceHints: [
        {
          deviceId: "device-1",
          absolutePath: "C:/Users/Alice/OneDrive/Workspace",
          updatedAt: "2026-04-16T10:00:00.000Z"
        },
        {
          deviceId: "device-2",
          absolutePath: "D:/Shared/Workspace",
          updatedAt: "2026-04-16T11:00:00.000Z"
        }
      ]
    };

    const next = mergeDeviceWorkspaceHint(reference, "device-1", "C:/Users/Bob/OneDrive/Workspace");

    expect(next.deviceHints).toHaveLength(2);
    expect(next.deviceHints[0]?.absolutePath).toBe("C:/Users/Bob/OneDrive/Workspace");
    expect(next.deviceHints[1]?.deviceId).toBe("device-2");
  });

  it("keeps local and cloud references JSON serializable", () => {
    const local = createBrowserLocalWorkspaceReference("Workspace");
    const cloud: WorkspaceReference = {
      kind: "cloud",
      provider: "onedrive",
      displayName: "Workspace",
      referenceTokens: {
        driveId: "drive-1",
        folderId: "folder-1"
      }
    };

    expect(JSON.parse(JSON.stringify({ local, cloud }))).toEqual({ local, cloud });
  });
});
