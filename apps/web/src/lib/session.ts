import { compareByUpdatedAtDesc } from "../../../../packages/core/index.js";
import {
  getBundleDraftFolderPath,
  getBundleManifestPath,
  getBundleResolutionFolderPath,
  getBundleSessionFolderPath
} from "./bundle";
import { DEVICE_ID_STORAGE_KEY } from "../constants";
import { hashText } from "./encoding";
import type {
  BundleBootstrap,
  DeviceSession,
  DraftRef,
  DraftResolutionRecord,
  LayoutState,
  SearchState,
  SessionCompareItem,
  SessionSelection,
  SidebarState,
  TextDocument,
  ThemeMode,
  WorkspaceManifest,
  WorkspaceReference
} from "../types";

function createRevisionId() {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

function getDocumentKey(documentPath: string) {
  return hashText(documentPath).slice(0, 12);
}

function sanitizeWorkspaceReference(reference: WorkspaceReference): WorkspaceReference {
  if (reference.kind !== "local") {
    return reference;
  }

  return {
    ...reference,
    deviceHints: []
  };
}

export function createDeviceId() {
  const stored = globalThis.localStorage?.getItem(DEVICE_ID_STORAGE_KEY);

  if (stored) {
    return stored;
  }

  const next = crypto.randomUUID();
  globalThis.localStorage?.setItem(DEVICE_ID_STORAGE_KEY, next);
  return next;
}

export function createDeviceName() {
  const platform = typeof navigator === "undefined" ? "unknown" : navigator.platform;
  const userAgent = typeof navigator === "undefined" ? "browser" : navigator.userAgent;
  const platformToken = userAgent.includes("Electron") ? "desktop" : "web";
  return `${platformToken}:${platform || "device"}`;
}

export function getManifestPath() {
  return getBundleManifestPath();
}

export function getDraftFolderPath() {
  return getBundleDraftFolderPath();
}

export function getResolutionFolderPath(documentPath?: string) {
  return getBundleResolutionFolderPath(documentPath ? getDocumentKey(documentPath) : undefined);
}

export function createBundleBootstrap(input: {
  workspaceId: string;
  displayName: string;
  workspaceRef: WorkspaceReference;
}): BundleBootstrap {
  return {
    version: 3,
    bundleFormat: "multi-device-v1",
    workspaceId: input.workspaceId,
    displayName: input.displayName,
    workspaceRef: sanitizeWorkspaceReference(input.workspaceRef)
  };
}

export function buildDraftRefs(deviceId: string, deviceName: string, documents: TextDocument[]): DraftRef[] {
  return documents
    .filter((document) => document.dirty)
    .map((document) => {
      const revisionId = createRevisionId();
      const docKey = getDocumentKey(document.path);
      return {
        revisionId,
        fileId: document.id,
        path: document.path,
        deviceId,
        deviceName,
        baseRemoteRevision: document.remoteRevision ?? `${document.lastSyncedModifiedAt}:${document.lastSyncedSize}`,
        updatedAt: new Date().toISOString(),
        blobPath: `${getDraftFolderPath()}/${deviceId}/${docKey}/${revisionId}.draft.json`,
        contentHash: hashText(document.cachedBody)
      };
    });
}

export function buildDraftClearRefs(
  deviceId: string,
  deviceName: string,
  activeDrafts: DraftRef[],
  dirtyPaths: Set<string>
): DraftRef[] {
  return activeDrafts
    .filter((draft) => !dirtyPaths.has(draft.path))
    .map((draft) => {
      const revisionId = createRevisionId();
      const docKey = getDocumentKey(draft.path);
      return {
        revisionId,
        path: draft.path,
        deviceId,
        deviceName,
        updatedAt: new Date().toISOString(),
        blobPath: `${getDraftFolderPath()}/${deviceId}/${docKey}/${revisionId}.draft.json`,
        contentHash: "",
        deleted: true
      };
    });
}

export function createSessionSnapshot(input: {
  deviceId: string;
  deviceName: string;
  workspacePath?: string;
  openTabs: string[];
  activeTab: string | null;
  editorGroups?: DeviceSession["editorGroups"];
  activeGroupId?: string;
  groupSizes?: number[];
  layout: LayoutState;
  sidebarState: SidebarState;
  searchState: SearchState;
  cursorState: Record<string, { line: number; column: number; scrollTop: number }>;
  themeMode: ThemeMode;
}): DeviceSession {
  return {
    revisionId: createRevisionId(),
    deviceId: input.deviceId,
    deviceName: input.deviceName,
    workspacePath: input.workspacePath,
    updatedAt: new Date().toISOString(),
    openTabs: [...input.openTabs],
    activeTab: input.activeTab,
    editorGroups: input.editorGroups?.map((group) => ({
      ...group,
      openTabs: [...group.openTabs]
    })),
    activeGroupId: input.activeGroupId,
    groupSizes: input.groupSizes ? [...input.groupSizes] : undefined,
    layout: input.layout,
    sidebarState: input.sidebarState,
    searchState: input.searchState,
    cursorState: input.cursorState,
    themeMode: input.themeMode
  };
}

export function createDraftPayload(draftRef: DraftRef, body: string) {
  return {
    revisionId: draftRef.revisionId,
    path: draftRef.path,
    deviceId: draftRef.deviceId,
    deviceName: draftRef.deviceName,
    baseRemoteRevision: draftRef.baseRemoteRevision,
    updatedAt: draftRef.updatedAt,
    contentHash: draftRef.contentHash,
    deleted: Boolean(draftRef.deleted),
    body
  };
}

export function createDraftResolutionRecord(input: {
  documentPath: string;
  deviceId: string;
  deviceName: string;
  clearedDraftRevisionIds: string[];
  finalBody: string;
}): DraftResolutionRecord {
  const revisionId = createRevisionId();

  return {
    revisionId,
    path: input.documentPath,
    resolvedAt: new Date().toISOString(),
    resolvedByDeviceId: input.deviceId,
    resolvedByDeviceName: input.deviceName,
    clearedDraftRevisionIds: [...input.clearedDraftRevisionIds],
    finalContentHash: hashText(input.finalBody),
    blobPath: `${getResolutionFolderPath(input.documentPath)}/${revisionId}.resolution.json`
  };
}

export function createDraftResolutionPayload(record: DraftResolutionRecord, body: string) {
  return {
    revisionId: record.revisionId,
    path: record.path,
    resolvedAt: record.resolvedAt,
    resolvedByDeviceId: record.resolvedByDeviceId,
    resolvedByDeviceName: record.resolvedByDeviceName,
    clearedDraftRevisionIds: record.clearedDraftRevisionIds,
    finalContentHash: record.finalContentHash,
    body
  };
}

function getLatestSessionPerDevice(sessions: DeviceSession[]) {
  const latestByDevice = new Map<string, DeviceSession>();

  for (const session of sessions) {
    const current = latestByDevice.get(session.deviceId);
    if (!current || compareByUpdatedAtDesc(current, session) > 0) {
      latestByDevice.set(session.deviceId, session);
    }
  }

  return [...latestByDevice.values()].sort(compareByUpdatedAtDesc);
}

function getLatestDraftPerDeviceAndPath(drafts: DraftRef[]) {
  const latestByKey = new Map<string, DraftRef>();

  for (const draft of drafts) {
    const key = `${draft.deviceId}::${draft.path}`;
    const current = latestByKey.get(key);
    if (!current || compareByUpdatedAtDesc(current, draft) > 0) {
      latestByKey.set(key, draft);
    }
  }

  return [...latestByKey.values()].sort(compareByUpdatedAtDesc);
}

export function createRuntimeManifest(input: {
  bootstrap: BundleBootstrap;
  sessions: DeviceSession[];
  drafts: DraftRef[];
  resolutions: DraftResolutionRecord[];
}): WorkspaceManifest {
  const latestSessions = getLatestSessionPerDevice(input.sessions);
  const latestDrafts = getLatestDraftPerDeviceAndPath(input.drafts);
  const sortedResolutions = [...input.resolutions].sort(
    (left, right) => right.resolvedAt.localeCompare(left.resolvedAt) || right.revisionId.localeCompare(left.revisionId)
  );
  const clearedDraftRevisionIds = new Set(sortedResolutions.flatMap((resolution) => resolution.clearedDraftRevisionIds));
  const latestResolution = sortedResolutions[0];
  const latestRevisionRecord = [
    latestSessions[0]
      ? { updatedAt: latestSessions[0].updatedAt, deviceId: latestSessions[0].deviceId, revisionId: latestSessions[0].revisionId }
      : null,
    latestDrafts[0]
      ? { updatedAt: latestDrafts[0].updatedAt, deviceId: latestDrafts[0].deviceId, revisionId: latestDrafts[0].revisionId }
      : null,
    latestResolution
      ? {
          updatedAt: latestResolution.resolvedAt,
          deviceId: latestResolution.resolvedByDeviceId,
          revisionId: latestResolution.revisionId
        }
      : null
  ]
    .filter((entry): entry is { updatedAt: string; deviceId: string; revisionId: string } => Boolean(entry))
    .sort(compareByUpdatedAtDesc)[0];
  const latestUpdate = latestRevisionRecord?.updatedAt ?? new Date(0).toISOString();
  const latestTimestamp = Date.parse(latestUpdate);

  return {
    version: input.bootstrap.version,
    workspaceId: input.bootstrap.workspaceId,
    displayName: input.bootstrap.displayName,
    workspaceRef: input.bootstrap.workspaceRef,
    themeMode: latestSessions[0]?.themeMode ?? "system",
    headRevision: Number.isFinite(latestTimestamp) ? latestTimestamp : 0,
    updatedAt: latestUpdate,
    lastWriterDeviceId: latestRevisionRecord?.deviceId ?? "",
    deviceSessions: latestSessions.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)),
    draftRefs: latestDrafts.filter((draft) => !draft.deleted && !clearedDraftRevisionIds.has(draft.revisionId)),
    resolutionRefs: sortedResolutions
  };
}

export function getPendingForeignSessions(
  manifest: WorkspaceManifest,
  currentDeviceId: string,
  acknowledgedRevisionIds: Set<string>
) {
  const ownSession = manifest.deviceSessions.find((session) => session.deviceId === currentDeviceId);

  return [...manifest.deviceSessions]
    .filter((session) => session.deviceId !== currentDeviceId)
    .filter((session) => !acknowledgedRevisionIds.has(session.revisionId))
    .filter((session) => !ownSession || session.updatedAt > ownSession.updatedAt)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.revisionId.localeCompare(left.revisionId));
}

export function buildSessionCompareItems(
  localSession: DeviceSession,
  remoteSession: DeviceSession,
  localThemeMode: ThemeMode,
  remoteThemeMode: ThemeMode
): SessionCompareItem[] {
  return [
    {
      id: "tabs",
      type: "tabs",
      label: "Open tabs",
      localValue: localSession.openTabs,
      remoteValue: remoteSession.openTabs,
      selection: "local"
    },
    {
      id: "activeTab",
      type: "activeTab",
      label: "Active file",
      localValue: localSession.activeTab,
      remoteValue: remoteSession.activeTab,
      selection: "remote"
    },
    {
      id: "layout",
      type: "layout",
      label: "Layout",
      localValue: localSession.layout,
      remoteValue: remoteSession.layout,
      selection: "local"
    },
    {
      id: "sidebar",
      type: "sidebar",
      label: "Sidebar state",
      localValue: localSession.sidebarState,
      remoteValue: remoteSession.sidebarState,
      selection: "local"
    },
    {
      id: "search",
      type: "search",
      label: "Search state",
      localValue: localSession.searchState,
      remoteValue: remoteSession.searchState,
      selection: "remote"
    },
    {
      id: "cursor",
      type: "cursor",
      label: "Cursor positions",
      localValue: localSession.cursorState,
      remoteValue: remoteSession.cursorState,
      selection: "remote"
    },
    {
      id: "theme",
      type: "theme",
      label: "Theme preference",
      localValue: localThemeMode,
      remoteValue: remoteThemeMode,
      selection: "remote"
    }
  ];
}

export function applySessionSelections(items: SessionCompareItem[]) {
  const pick = (id: string) => items.find((item) => item.id === id);
  const choose = <T,>(id: string) => {
    const item = pick(id);
    return (item?.selection === "remote" ? item?.remoteValue : item?.localValue) as T;
  };

  return {
    openTabs: choose<string[]>("tabs"),
    activeTab: choose<string | null>("activeTab"),
    layout: choose<DeviceSession["layout"]>("layout"),
    sidebarState: choose<DeviceSession["sidebarState"]>("sidebar"),
    searchState: choose<DeviceSession["searchState"]>("search"),
    cursorState: choose<DeviceSession["cursorState"]>("cursor"),
    themeMode: choose<ThemeMode>("theme")
  };
}

export function overwriteSelections(items: SessionCompareItem[], selection: SessionSelection) {
  return items.map((item) => ({
    ...item,
    selection
  }));
}

export function getSessionFilePath(deviceId: string, revisionId: string) {
  return `${getBundleSessionFolderPath(deviceId)}/${revisionId}.session.json`;
}
