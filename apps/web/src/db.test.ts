import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db, loadWorkspaceSnapshot, persistWorkspaceSnapshot } from "./db";
import type { CachedWorkspace, DocumentBuffer, WorkspaceFileRecord, WorkspaceRoot } from "./types";

const workspaceRootA: WorkspaceRoot = {
  id: "workspace-a",
  provider: "local",
  rootId: "root-a",
  rootPath: "C:/workspace-a",
  displayName: "Workspace A",
  kind: "local-root"
};

const workspaceRootB: WorkspaceRoot = {
  id: "workspace-b",
  provider: "local",
  rootId: "root-b",
  rootPath: "C:/workspace-b",
  displayName: "Workspace B",
  kind: "local-root"
};

function createWorkspace(root: WorkspaceRoot, updatedAt: string): CachedWorkspace {
  return {
    id: root.id,
    root,
    tree: [],
    updatedAt
  };
}

function createFile(workspaceId: string, path: string): WorkspaceFileRecord {
  return {
    id: `local:${workspaceId}:${path}`,
    workspaceId,
    path,
    name: path.split("/").at(-1) ?? path,
    provider: "local",
    language: "plaintext",
    size: path.length,
    modifiedAt: "2026-04-23T00:00:00.000Z",
    lastSyncedModifiedAt: "2026-04-23T00:00:00.000Z",
    lastSyncedSize: path.length,
    foreignDrafts: [],
    pendingForeignDraftCount: 0
  };
}

function createBuffer(file: WorkspaceFileRecord, body: string): DocumentBuffer {
  return {
    documentId: file.id,
    workspaceId: file.workspaceId,
    encoding: "utf-8",
    lineEnding: "lf",
    dirty: false,
    cachedBody: body,
    lastAccessedAt: 1,
    persistedLocal: true
  };
}

describe("workspace snapshot persistence", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("removes files that disappeared from a later workspace snapshot", async () => {
    const workspace = createWorkspace(workspaceRootA, "2026-04-23T00:00:00.000Z");
    const readme = createFile(workspace.id, "README.md");
    const stale = createFile(workspace.id, "dist/old.js");

    await persistWorkspaceSnapshot(workspace, [readme, stale], [createBuffer(readme, "# readme")]);
    await persistWorkspaceSnapshot(
      createWorkspace(workspaceRootA, "2026-04-23T00:00:01.000Z"),
      [readme],
      []
    );

    const snapshot = await loadWorkspaceSnapshot(workspace.id);

    expect(snapshot.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(snapshot.buffers).toEqual([]);
  });

  it("replaces files and buffers for one workspace without clearing another workspace", async () => {
    const workspaceA = createWorkspace(workspaceRootA, "2026-04-23T00:00:00.000Z");
    const workspaceB = createWorkspace(workspaceRootB, "2026-04-23T00:00:00.000Z");
    const fileA = createFile(workspaceA.id, "README.md");
    const fileB = createFile(workspaceB.id, "notes/todo.md");

    await persistWorkspaceSnapshot(workspaceA, [fileA], [createBuffer(fileA, "alpha")]);
    await persistWorkspaceSnapshot(workspaceB, [fileB], [createBuffer(fileB, "beta")]);
    await persistWorkspaceSnapshot(
      createWorkspace(workspaceRootA, "2026-04-23T00:00:01.000Z"),
      [fileA],
      []
    );

    const snapshotA = await loadWorkspaceSnapshot(workspaceA.id);
    const snapshotB = await loadWorkspaceSnapshot(workspaceB.id);

    expect(snapshotA.files.map((file) => file.path)).toEqual(["README.md"]);
    expect(snapshotA.buffers).toEqual([]);
    expect(snapshotB.files.map((file) => file.path)).toEqual(["notes/todo.md"]);
    expect(snapshotB.buffers.map((buffer) => buffer.documentId)).toEqual([fileB.id]);
  });
});
