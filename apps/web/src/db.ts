import Dexie, { type Table } from "dexie";
import { DATABASE_NAME } from "./constants";
import type {
  CachedWorkspace,
  DocumentBuffer,
  StoredSetting,
  WorkspaceFileRecord,
  WorkspaceManifest
} from "./types";

class TextWorkspaceDb extends Dexie {
  workspaces!: Table<CachedWorkspace, string>;
  files!: Table<WorkspaceFileRecord, string>;
  buffers!: Table<DocumentBuffer, string>;
  settings!: Table<StoredSetting, string>;
  manifests!: Table<WorkspaceManifest, string>;

  constructor() {
    super(DATABASE_NAME);

    this.version(3).stores({
      workspaces: "id, updatedAt",
      files: "id, workspaceId, path, modifiedAt",
      buffers: "documentId, workspaceId, dirty, lastAccessedAt",
      settings: "key",
      manifests: "workspaceId, updatedAt",
      documents: null,
      syncJobs: null
    });
  }
}

export const db = new TextWorkspaceDb();

export async function persistWorkspaceSnapshot(
  workspace: CachedWorkspace,
  files: WorkspaceFileRecord[],
  buffers: DocumentBuffer[]
) {
  await db.transaction("rw", db.workspaces, db.files, db.buffers, db.manifests, async () => {
    await db.workspaces.put(workspace);
    await db.files.bulkPut(files);
    await db.buffers.clear();

    if (buffers.length > 0) {
      await db.buffers.bulkPut(buffers);
    }

    if (workspace.manifest) {
      await db.manifests.put(workspace.manifest);
    }
  });
}

export async function loadWorkspaceSnapshot(workspaceId: string) {
  const [workspace, files, buffers] = await Promise.all([
    db.workspaces.get(workspaceId),
    db.files.where("workspaceId").equals(workspaceId).toArray(),
    db.buffers.where("workspaceId").equals(workspaceId).toArray()
  ]);

  return {
    workspace,
    files,
    buffers
  };
}

export async function persistSetting(key: string, value: string) {
  await db.settings.put({ key, value });
}

export async function loadSetting(key: string) {
  return db.settings.get(key);
}
