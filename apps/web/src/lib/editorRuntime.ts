import { detectLineEnding } from "./encoding";
import type {
  DeviceSession,
  DocumentBuffer,
  LayoutState,
  SearchEntry,
  TextDocument,
  WorkspaceFileRecord
} from "../types";

const MAX_CLEAN_BUFFER_COUNT = 6;
const MAX_CLEAN_BUFFER_BYTES = 12 * 1024 * 1024;

export interface EditorGroupState {
  id: string;
  openTabs: string[];
  activeTabId: string | null;
  previewTabId: string | null;
}

export interface TabDragState {
  fromGroupId: string;
  documentId: string;
  overGroupId: string | null;
  overTabId: string | null;
  before: boolean;
}

export function createGroupId(): string {
  return `group-${Math.random().toString(36).slice(2, 10)}`;
}

export function createEmptyGroup(): EditorGroupState {
  return { id: createGroupId(), openTabs: [], activeTabId: null, previewTabId: null };
}

export function resolvePreviewTabId(input: {
  asPreview: boolean;
  existingPreviewTabId: string | null;
  targetDocumentId: string;
  documentAlreadyOpen: boolean;
}) {
  const { asPreview, existingPreviewTabId, targetDocumentId, documentAlreadyOpen } = input;

  if (asPreview) {
    if (!documentAlreadyOpen || existingPreviewTabId === targetDocumentId) {
      return targetDocumentId;
    }

    return existingPreviewTabId;
  }

  return existingPreviewTabId === targetDocumentId ? null : existingPreviewTabId;
}

export function distributeEqualSizes(count: number): number[] {
  if (count <= 0) return [];
  const size = 100 / count;
  return Array.from({ length: count }, () => size);
}

export function mergeLayout(partial: Partial<LayoutState> | undefined, defaults: LayoutState, searchAvailable: boolean): LayoutState {
  const next = { ...defaults, ...(partial ?? {}) };

  if (!searchAvailable && next.activeActivity === "search") {
    next.activeActivity = "files";
  }

  if (!searchAvailable && next.mobilePanel === "search") {
    next.mobilePanel = "tree";
  }

  return next;
}

export function toFileMap(files: WorkspaceFileRecord[]) {
  return Object.fromEntries(files.map((file) => [file.id, file])) as Record<string, WorkspaceFileRecord>;
}

export function toBufferMap(buffers: DocumentBuffer[]) {
  return Object.fromEntries(buffers.map((buffer) => [buffer.documentId, buffer])) as Record<string, DocumentBuffer>;
}

export function getFirstFileId(files: WorkspaceFileRecord[]) {
  return files[0]?.id ?? null;
}

export function getBundleFsPath(bundlePath: string, relativePath: string) {
  return `${bundlePath}/${relativePath}`.replaceAll("\\", "/");
}

export function normalizeFile(file: WorkspaceFileRecord): WorkspaceFileRecord {
  const lastSyncedModifiedAt = file.lastSyncedModifiedAt ?? file.modifiedAt;
  const lastSyncedSize = file.lastSyncedSize ?? file.size;

  return {
    ...file,
    lastSyncedModifiedAt,
    lastSyncedSize,
    conflictState: file.conflictState,
    foreignDrafts: [...(file.foreignDrafts ?? [])],
    pendingForeignDraftCount: file.pendingForeignDraftCount ?? file.foreignDrafts?.length ?? 0,
    lastAppliedResolutionRevisionId: file.lastAppliedResolutionRevisionId
  };
}

export function normalizeBuffer(buffer: DocumentBuffer): DocumentBuffer {
  return {
    ...buffer,
    lastAccessedAt: buffer.lastAccessedAt ?? Date.now(),
    persistedLocal: Boolean(buffer.persistedLocal)
  };
}

export function toNormalizedFileMap(files: WorkspaceFileRecord[]) {
  return toFileMap(files.map(normalizeFile));
}

export function toNormalizedBufferMap(buffers: DocumentBuffer[]) {
  return toBufferMap(buffers.map(normalizeBuffer));
}

export function getFileMapByPath(fileMap: Record<string, WorkspaceFileRecord>) {
  return new Map(Object.values(fileMap).map((file) => [file.path, file]));
}

export function mapFileIdsToPaths(fileIds: string[], fileMap: Record<string, WorkspaceFileRecord>) {
  return fileIds
    .map((fileId) => fileMap[fileId]?.path)
    .filter((path): path is string => Boolean(path));
}

export function mapFileIdToPath(fileId: string | null, fileMap: Record<string, WorkspaceFileRecord>) {
  return fileId ? fileMap[fileId]?.path ?? null : null;
}

export function mapCursorStateToPaths(
  cursorState: Record<string, { line: number; column: number; scrollTop: number }>,
  fileMap: Record<string, WorkspaceFileRecord>
) {
  return Object.fromEntries(
    Object.entries(cursorState)
      .map(([documentId, snapshot]) => {
        const path = fileMap[documentId]?.path;
        return path ? [path, snapshot] : null;
      })
      .filter((entry): entry is [string, { line: number; column: number; scrollTop: number }] => Boolean(entry))
  );
}

export function hydrateSessionState(session: DeviceSession, nextFileMap: Record<string, WorkspaceFileRecord>) {
  const documentByPath = new Map(Object.values(nextFileMap).map((file) => [file.path, file]));
  const openTabs = session.openTabs
    .map((path) => documentByPath.get(path)?.id)
    .filter((documentId): documentId is string => Boolean(documentId));
  const activeTabId = session.activeTab ? documentByPath.get(session.activeTab)?.id ?? null : null;
  const cursorState = Object.fromEntries(
    Object.entries(session.cursorState)
      .map(([path, snapshot]) => {
        const documentId = documentByPath.get(path)?.id;
        return documentId ? [documentId, snapshot] : null;
      })
      .filter((entry): entry is [string, { line: number; column: number; scrollTop: number }] => Boolean(entry))
  );

  return {
    openTabs,
    activeTabId,
    cursorState
  };
}

export function composeTextDocument(
  file: WorkspaceFileRecord | null | undefined,
  buffer: DocumentBuffer | null | undefined
): TextDocument | null {
  if (!file) {
    return null;
  }

  if (!buffer) {
    if (!file.isPdf) {
      return null;
    }

    return {
      ...file,
      documentId: file.id,
      workspaceId: file.workspaceId,
      encoding: "utf-8",
      lineEnding: "lf",
      dirty: false,
      cachedBody: "",
      lastAccessedAt: 0,
      persistedLocal: false
    };
  }

  return {
    ...file,
    ...buffer
  };
}

export function createBufferFromBody(
  file: WorkspaceFileRecord,
  body: string,
  options: Partial<Pick<DocumentBuffer, "dirty" | "persistedLocal" | "lastAccessedAt">> = {}
): DocumentBuffer {
  return {
    documentId: file.id,
    workspaceId: file.workspaceId,
    encoding: "utf-8",
    lineEnding: detectLineEnding(body),
    cachedBody: body,
    dirty: options.dirty ?? false,
    lastAccessedAt: options.lastAccessedAt ?? Date.now(),
    persistedLocal: options.persistedLocal ?? false
  };
}

export function touchBuffer(buffer: DocumentBuffer): DocumentBuffer {
  return {
    ...buffer,
    lastAccessedAt: Date.now()
  };
}

export function getPinnedBufferIds(editorGroups: EditorGroupState[], bufferMap: Record<string, DocumentBuffer>) {
  const pinned = new Set<string>();

  for (const group of editorGroups) {
    if (group.activeTabId) {
      pinned.add(group.activeTabId);
    }
  }

  for (const buffer of Object.values(bufferMap)) {
    if (buffer.dirty) {
      pinned.add(buffer.documentId);
    }
  }

  return pinned;
}

function getBufferSize(fileMap: Record<string, WorkspaceFileRecord>, buffer: DocumentBuffer) {
  return fileMap[buffer.documentId]?.size ?? buffer.cachedBody.length;
}

export function evictCleanBuffers(
  fileMap: Record<string, WorkspaceFileRecord>,
  bufferMap: Record<string, DocumentBuffer>,
  pinnedIds: Set<string>,
  forceEvictIds: string[] = []
) {
  const next = { ...bufferMap };

  for (const id of forceEvictIds) {
    if (!pinnedIds.has(id) && !next[id]?.dirty) {
      delete next[id];
    }
  }

  let cleanEntries = Object.values(next)
    .filter((buffer) => !buffer.dirty && !pinnedIds.has(buffer.documentId))
    .sort((left, right) => left.lastAccessedAt - right.lastAccessedAt);
  let cleanBytes = cleanEntries.reduce((sum, buffer) => sum + getBufferSize(fileMap, buffer), 0);

  while (cleanEntries.length > MAX_CLEAN_BUFFER_COUNT || cleanBytes > MAX_CLEAN_BUFFER_BYTES) {
    const candidate = cleanEntries.shift();
    if (!candidate) {
      break;
    }

    cleanBytes -= getBufferSize(fileMap, candidate);
    delete next[candidate.documentId];
  }

  return next;
}

export function searchLoadedBuffers(
  query: string,
  fileMap: Record<string, WorkspaceFileRecord>,
  bufferMap: Record<string, DocumentBuffer>
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return Object.values(bufferMap)
    .map((buffer) => {
      const file = fileMap[buffer.documentId];
      if (!file || file.isPdf) {
        return null;
      }

      const haystack = `${file.name}\n${file.path}\n${buffer.cachedBody}`;
      const lowerHaystack = haystack.toLowerCase();
      const index = lowerHaystack.indexOf(normalizedQuery);
      if (index === -1) {
        return null;
      }

      const contentIndex = buffer.cachedBody.toLowerCase().indexOf(normalizedQuery);
      const snippet =
        contentIndex === -1
          ? ""
          : buffer.cachedBody
              .slice(Math.max(0, contentIndex - 32), Math.min(buffer.cachedBody.length, contentIndex + normalizedQuery.length + 64))
              .replace(/\s+/g, " ")
              .trim();

      return {
        documentId: file.id,
        path: file.path,
        title: file.name,
        snippet,
        score: 100 - index,
        indexedAt: new Date().toISOString()
      } satisfies SearchEntry;
    })
    .filter((entry): entry is SearchEntry => Boolean(entry))
    .sort((left, right) => right.score - left.score)
    .slice(0, 200);
}
