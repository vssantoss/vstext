import { useEffect, useMemo, useRef, useState } from "react";
import { EditorGroup } from "./components/EditorGroup";
import type { EditorGroupTabInfo } from "./components/EditorGroup";
import { useStableCallback } from "./lib/useStableCallback";
import {
  ActivityBar,
  ConfirmationDialog,
  FilesPanel,
  MessageDialog,
  ProvidersPanel,
  SearchPanel,
  SavePromptDialog,
  SessionCompareDialog,
  SessionPickerDialog,
  SessionsPanel,
  SettingsPanel,
  StatusBar,
  TitleBar,
  WorkspaceFileConflictDialog,
  WorkspaceErrorBanner,
  WorkspaceScanOverlay
} from "./components/Shell";
import { db, loadSetting, loadWorkspaceSnapshot, persistSetting, persistWorkspaceSnapshot } from "./db";
import {
  buildTreeFromFiles,
  buildTreeFromSnapshots,
  createBrowserBundleDirectory,
  inflateElectronWorkspace,
  openBrowserBundleDirectory,
  openBrowserWorkspace,
  pruneWorkspaceTreeForSkippedFolders,
  readBrowserJson,
  writeBrowserJson
} from "./lib/localWorkspace";
import { scanBrowserBundle } from "./lib/bundleRuntime";
import {
  createBrowserLocalWorkspaceReference,
  createBundleDirectoryName,
  isLocalWorkspaceReference,
  mergeDeviceWorkspaceHint
} from "./lib/bundle";
import {
  composeTextDocument,
  createBufferFromBody,
  createEmptyGroup,
  createGroupId,
  distributeEqualSizes,
  EditorGroupState,
  evictCleanBuffers,
  getBundleFsPath,
  getFileMapByPath,
  getPinnedBufferIds,
  hydrateSessionState,
  mapCursorStateToPaths,
  mapEditorGroupsToPaths,
  mapFileIdsToPaths,
  mapFileIdToPath,
  mergeLayout,
  normalizeFile,
  resolvePreviewTabId,
  searchLoadedBuffers,
  TabDragState,
  toNormalizedBufferMap,
  toNormalizedFileMap,
  touchBuffer
} from "./lib/editorRuntime";
import { createProviderRegistry, getConfiguredCloudProviderCount } from "./lib/providers";
import { detectLineEnding, hashText } from "./lib/encoding";
import { getLanguageMetadata, isMarkdownPath } from "./lib/language";
import { formatAbsolutePathForClipboard } from "./lib/platform";
import {
  applySessionSelections,
  buildDraftClearRefs,
  buildDraftRefs,
  buildSessionCompareItems,
  createBundleBootstrap,
  createDraftPayload,
  createDraftResolutionPayload,
  createDraftResolutionRecord,
  createDeviceId,
  createDeviceName,
  createSessionSnapshot,
  createRuntimeManifest,
  getPendingForeignSessions,
  getSessionFilePath,
  getManifestPath,
  overwriteSelections
} from "./lib/session";
import { applyResolvedTheme, getSystemThemePreference, resolveThemeMode } from "./lib/theme";
import {
  mergeSampleWorkspaceBuffers,
  readSampleWorkspaceText,
  sampleBuffers,
  sampleFiles,
  sampleRoot,
  sampleTree
} from "./sampleWorkspace";
import type {
  ActivityId,
  BundleBootstrap,
  BundleScanResult,
  DeviceSession,
  DocumentBuffer,
  DraftResolutionRecord,
  FileTreeNode,
  LayoutState,
  SearchEntry,
  SearchState,
  SessionCompareItem,
  SidebarState,
  TextDocument,
  ThemeMode,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot,
  WorkspaceEntryOperation,
  WorkspaceBundleLink,
  WorkspaceManifest,
  WorkspaceReference,
  WorkspaceRoot,
  WorkspaceScanFolder,
  WorkspaceScanProgress
} from "./types";
import type { BrowserWorkspaceScanProgress } from "./lib/localWorkspace";

void db;

const defaultLayout: LayoutState = {
  previewOpen: true,
  sidebarOpen: true,
  activeActivity: "files",
  mobilePanel: "tree"
};

const defaultSidebarState: SidebarState = {
  expandedPaths: ["notes"],
  searchOpen: true
};

const defaultSearchState: SearchState = {
  query: "",
  lastQuery: "",
  selectedPath: null
};

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_GROUP_PCT = 15;
const WORKSPACE_SKIP_FOLDER_THRESHOLD_MS = 10_000;

function sortForeignDrafts(left: { savedAt: string; revisionId: string }, right: { savedAt: string; revisionId: string }) {
  return right.savedAt.localeCompare(left.savedAt) || right.revisionId.localeCompare(left.revisionId);
}

function sortResolutions(left: DraftResolutionRecord, right: DraftResolutionRecord) {
  return right.resolvedAt.localeCompare(left.resolvedAt) || right.revisionId.localeCompare(left.revisionId);
}

function areDraftListsEqual(left: WorkspaceFileRecord["foreignDrafts"], right: WorkspaceFileRecord["foreignDrafts"]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every(
    (entry, index) =>
      entry.revisionId === right[index]?.revisionId &&
      entry.deviceId === right[index]?.deviceId &&
      entry.savedAt === right[index]?.savedAt
  );
}

type DraftMergeEntry = TextDocument["foreignDrafts"][number] & { body: string };

type DraftMergeState = {
  documentId: string;
  entries: DraftMergeEntry[];
  currentIndex: number;
};

type PendingDirtyTabClose = {
  documentId: string;
  groupId: string;
  tabIdsToClose: string[];
  reason: "user-close" | "context-menu";
};

type SaveDocumentResult = "saved" | "blocked";

function createWorkspaceScanId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `scan:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

function getSkipFolderCandidate(folderStack: WorkspaceScanFolder[], now = Date.now()) {
  for (let index = folderStack.length - 1; index >= 0; index -= 1) {
    const folder = folderStack[index];
    if (now - folder.enteredAtMs >= WORKSPACE_SKIP_FOLDER_THRESHOLD_MS) {
      return folder;
    }
  }

  return null;
}

function withWorkspaceScanDerivedState(progress: WorkspaceScanProgress, now = Date.now()): WorkspaceScanProgress {
  const skipFolder = getSkipFolderCandidate(progress.folderStack, now);

  return {
    ...progress,
    skipFolderPath: skipFolder?.path ?? null,
    skipFolderName: skipFolder?.name ?? null
  };
}

function formatCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function getWorkspaceScanWarningSuffix(loadWarnings?: string[]) {
  const firstWarning = loadWarnings?.[0];
  return firstWarning ? ` First issue: ${firstWarning}` : "";
}

function getWorkspaceScanDetail(input: {
  cancelled?: boolean;
  entriesProcessed?: number;
  filesLoaded?: number;
  skippedEntryCount?: number;
  loadWarnings?: string[];
}) {
  if (input.cancelled) {
    const entriesProcessed = input.entriesProcessed ?? 0;
    const filesLoaded = input.filesLoaded ?? 0;
    return `Scan cancelled. Showing ${formatCount(filesLoaded, "loaded file", "loaded files")} after ${formatCount(
      entriesProcessed,
      "scanned entry",
      "scanned entries"
    )}.${getWorkspaceScanWarningSuffix(input.loadWarnings)}`;
  }

  const skippedEntryCount = input.skippedEntryCount ?? 0;

  if (skippedEntryCount === 0) {
    return "";
  }

  return `Workspace scan skipped ${formatCount(skippedEntryCount, "entry", "entries")}.${getWorkspaceScanWarningSuffix(
    input.loadWarnings
  )}`;
}

function getWorkspaceOpenStatus(result: {
  displayName: string;
  cancelled?: boolean;
  entriesProcessed?: number;
  filesLoaded?: number;
  skippedEntryCount?: number;
  loadWarnings?: string[];
}) {
  const detail = getWorkspaceScanDetail(result);
  return detail ? `Opened ${result.displayName}. ${detail}` : `Opened ${result.displayName}`;
}

function getWorkspaceBundleOpenStatus(
  bundleName: string,
  result: {
    cancelled?: boolean;
    entriesProcessed?: number;
    filesLoaded?: number;
    skippedEntryCount?: number;
    loadWarnings?: string[];
  }
) {
  const detail = getWorkspaceScanDetail(result);
  return detail ? `Opened workspace bundle ${bundleName}. ${detail}` : `Opened workspace bundle ${bundleName}.`;
}

function logAppActivity(
  type: "status" | "error" | "scan" | "tab" | "file" | "buffer",
  message: string,
  detail?: Record<string, unknown>
) {
  const timestamp = new Date().toISOString();
  const payload =
    detail && Object.keys(detail).length > 0
      ? ` ${JSON.stringify(Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined)))}`
      : "";

  console.log(`[app:${type}] ${timestamp} ${message}${payload}`);
}

function isPathWithinSkippedFolder(targetPath: string, skippedFolders: string[]) {
  return skippedFolders.some((folderPath) => targetPath === folderPath || targetPath.startsWith(`${folderPath}/`));
}

type BundleSaveOptions = {
  createBundleIfNeeded?: boolean;
  bundleOverride?: WorkspaceBundleLink;
  fileMapOverride?: Record<string, WorkspaceFileRecord>;
  bufferMapOverride?: Record<string, DocumentBuffer>;
};

type FileTreeClipboardEntry = {
  kind: "file" | "directory";
  path: string;
  absolutePath?: string;
};

type PendingCreateTreeEntry = {
  kind: "file" | "directory";
  parentPath: string | null;
};

function joinWorkspacePath(parentPath: string | null | undefined, name: string) {
  return [parentPath, name].filter(Boolean).join("/");
}

function getParentPath(path: string) {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex === -1 ? null : path.slice(0, slashIndex);
}

function getPathName(path: string) {
  return path.split("/").at(-1) ?? path;
}

function normalizeRelativeEntryName(input: string | null, fallback: string) {
  const raw = (input ?? "").trim() || fallback;
  return raw.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
}

function splitNameExtension(name: string) {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return { base: name, extension: "" };
  }

  return {
    base: name.slice(0, dotIndex),
    extension: name.slice(dotIndex)
  };
}

function getCopiedName(name: string) {
  const { base, extension } = splitNameExtension(name);
  return `${base} copy${extension}`;
}

function getCopyNumberedName(name: string, copyNumber: number) {
  const { base, extension } = splitNameExtension(name);
  return `${base} copy ${copyNumber}${extension}`;
}

function isSameOrChildPath(path: string, parentPath: string) {
  return path === parentPath || path.startsWith(`${parentPath}/`);
}

function collectDirectoryPaths(nodes: FileTreeNode[]) {
  const paths = new Set<string>();

  const visit = (node: FileTreeNode) => {
    if (node.kind !== "directory") {
      return;
    }

    paths.add(node.path);
    node.children?.forEach(visit);
  };

  nodes.forEach(visit);
  return paths;
}

function sortTreeNodes(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .map((node) =>
      node.kind === "directory"
        ? {
            ...node,
            children: sortTreeNodes(node.children ?? [])
          }
        : node
    )
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function upsertDirectoryNode(nodes: FileTreeNode[], workspaceRoot: WorkspaceRoot, directoryPath: string): FileTreeNode[] {
  const parts = directoryPath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return nodes;
  }

  const insert = (siblings: FileTreeNode[], depth: number): FileTreeNode[] => {
    const path = parts.slice(0, depth + 1).join("/");
    const existing = siblings.find((node) => node.kind === "directory" && node.path === path);
    if (existing) {
      if (depth >= parts.length - 1) {
        return siblings;
      }

      return sortTreeNodes(
        siblings.map((node) =>
          node === existing ? { ...node, children: insert(node.children ?? [], depth + 1) } : node
        )
      );
    }

    const nextNode: FileTreeNode = {
      id: `${workspaceRoot.id}:${path}`,
      provider: workspaceRoot.provider,
      kind: "directory",
      name: parts[depth],
      path,
      absolutePath: workspaceRoot.rootPath ? `${workspaceRoot.rootPath}/${path}`.replaceAll("\\", "/") : undefined,
      children: depth < parts.length - 1 ? insert([], depth + 1) : []
    };

    return sortTreeNodes([...siblings, nextNode]);
  };

  return insert(nodes, 0);
}

function removeTreePath(nodes: FileTreeNode[], targetPath: string): FileTreeNode[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) =>
      node.kind === "directory"
        ? {
            ...node,
            children: removeTreePath(node.children ?? [], targetPath)
          }
        : node
    );
}

function countTreeDescendants(node: FileTreeNode): number {
  if (node.kind !== "directory") {
    return 0;
  }

  return (node.children ?? []).reduce((count, child) => count + 1 + countTreeDescendants(child), 0);
}

function areSetsEqual<T>(left: Set<T>, right: Set<T>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function getCreateEntryErrorMessage(kind: "file" | "directory") {
  return kind === "file"
    ? "Unable to create file. Check the name and try again."
    : "Unable to create folder. Check the name and try again.";
}

function getWorkspaceSessionSignature(session: DeviceSession | null | undefined) {
  if (!session) {
    return "";
  }

  return JSON.stringify({
    workspacePath: session.workspacePath ?? "",
    openTabs: session.openTabs,
    activeTab: session.activeTab,
    editorGroups: session.editorGroups ?? [],
    activeGroupId: session.activeGroupId ?? null,
    groupSizes: session.groupSizes ?? [],
    layout: session.layout,
    sidebarState: session.sidebarState,
    searchState: session.searchState,
    cursorState: session.cursorState,
    themeMode: session.themeMode
  });
}

export default function App() {
  const currentDeviceId = useRef(createDeviceId()).current;
  const currentDeviceName = useRef(createDeviceName()).current;
  const searchAvailable = Boolean(window.electronAPI);
  const browserWorkspaceDirectoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const browserWorkspaceFileHandlesRef = useRef<Map<string, FileSystemFileHandle>>(new Map());
  const browserBundleDirectoryHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
  const browserBundleFileHandlesRef = useRef<Map<string, FileSystemFileHandle>>(new Map());
  const providerRegistry = useRef(
    createProviderRegistry({
      electronAPI: window.electronAPI,
      browserWorkspaceDirectoryHandleRef,
      browserWorkspaceFileHandlesRef
    })
  ).current;
  const workspacePollInFlightRef = useRef(false);
  const bufferLoadInFlightRef = useRef(new Map<string, Promise<DocumentBuffer | null>>());
  const activeSearchRequestIdRef = useRef<string | null>(null);
  const scanCancelRef = useRef<(() => void) | null>(null);
  const scanSkipFolderRef = useRef<((folderPath: string) => void) | null>(null);
  const editorFocusTokenRef = useRef(0);
  const workspaceCloseInProgressRef = useRef(false);
  const lastSavedWorkspaceFileSessionSignatureRef = useRef<string | null>(null);

  const [workspace, setWorkspace] = useState<WorkspaceRoot>(sampleRoot);
  const [tree, setTree] = useState<FileTreeNode[]>(sampleTree);
  const [fileMap, setFileMap] = useState<Record<string, WorkspaceFileRecord>>(toNormalizedFileMap(sampleFiles));
  const [bufferMap, setBufferMap] = useState<Record<string, DocumentBuffer>>(toNormalizedBufferMap(sampleBuffers));
  const initialGroup = useRef(createEmptyGroup()).current;
  const [editorGroups, setEditorGroups] = useState<EditorGroupState[]>([initialGroup]);
  const [activeGroupId, setActiveGroupId] = useState<string>(initialGroup.id);
  const [groupSizes, setGroupSizes] = useState<number[]>([100]);
  const [layout, setLayout] = useState<LayoutState>(() => mergeLayout(defaultLayout, defaultLayout, searchAvailable));
  const [sidebarState, setSidebarState] = useState<SidebarState>(defaultSidebarState);
  const [searchState, setSearchState] = useState<SearchState>(defaultSearchState);
  const [searchResults, setSearchResults] = useState<SearchEntry[]>([]);
  const [cursorState, setCursorState] = useState<Record<string, { line: number; column: number; scrollTop: number }>>(
    {}
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [prefersDark, setPrefersDark] = useState(getSystemThemePreference());
  const [bundleLink, setBundleLink] = useState<WorkspaceBundleLink | null>(null);
  const [manifest, setManifest] = useState<WorkspaceManifest | undefined>();
  const [acknowledgedRemoteSessionIds, setAcknowledgedRemoteSessionIds] = useState<Set<string>>(new Set());
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [selectedRemoteSessionRevisionId, setSelectedRemoteSessionRevisionId] = useState<string | null>(null);
  const [sessionCompareItems, setSessionCompareItems] = useState<SessionCompareItem[] | null>(null);
  const [draftMergeState, setDraftMergeState] = useState<DraftMergeState | null>(null);
  const [diskConflict, setDiskConflict] = useState<{
    documentId: string;
    remoteBody: string;
    deleted?: boolean;
    snapshot: WorkspaceFileSnapshot | null;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState("Opening workspace...");
  const [scanProgress, setScanProgress] = useState<WorkspaceScanProgress | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const editorRegionRef = useRef<HTMLElement | null>(null);
  const [resizingGroupIndex, setResizingGroupIndex] = useState<number | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  const [fileTreeClipboard, setFileTreeClipboard] = useState<FileTreeClipboardEntry | null>(null);
  const [selectedTreeEntryId, setSelectedTreeEntryId] = useState<string | null>(null);
  const [treeSelectionCleared, setTreeSelectionCleared] = useState(false);
  const [pendingDeleteEntry, setPendingDeleteEntry] = useState<{ node: FileTreeNode; message: string } | null>(null);
  const [pendingCreateTreeEntry, setPendingCreateTreeEntry] = useState<PendingCreateTreeEntry | null>(null);
  const [renamingTreeNodeId, setRenamingTreeNodeId] = useState<string | null>(null);
  const [operationErrorMessage, setOperationErrorMessage] = useState<string | null>(null);
  const [editorFocusRequest, setEditorFocusRequest] = useState<{ groupId: string; documentId: string; token: number } | null>(null);
  const [loadingBufferIds, setLoadingBufferIds] = useState<Set<string>>(() => new Set());
  const [pdfBlobEntries, setPdfBlobEntries] = useState<Record<string, { url: string; error?: string }>>({});
  const [cacheBootstrapSettled, setCacheBootstrapSettled] = useState(false);
  const [dirtyTabClosePrompt, setDirtyTabClosePrompt] = useState<PendingDirtyTabClose | null>(null);
  const [dirtyTabCloseSavePending, setDirtyTabCloseSavePending] = useState(false);
  const [closeWorkspacePromptOpen, setCloseWorkspacePromptOpen] = useState(false);
  const [closeWorkspaceSavePending, setCloseWorkspaceSavePending] = useState(false);
  const loadedPdfIdsRef = useRef<Set<string>>(new Set());
  const cacheBootstrapRunRef = useRef(0);
  const scanActiveRef = useRef(false);
  const fileMapRef = useRef(fileMap);
  fileMapRef.current = fileMap;
  const bufferMapRef = useRef(bufferMap);
  bufferMapRef.current = bufferMap;
  const editorGroupsRef = useRef(editorGroups);
  editorGroupsRef.current = editorGroups;
  const activeGroupIdRef = useRef(activeGroupId);
  activeGroupIdRef.current = activeGroupId;
  const tabDragRef = useRef(tabDrag);
  tabDragRef.current = tabDrag;

  const files = useMemo(() => Object.values(fileMap).sort((left, right) => left.path.localeCompare(right.path)), [fileMap]);
  const dirtyBuffers = useMemo(
    () => Object.values(bufferMap).filter((buffer) => buffer.dirty),
    [bufferMap]
  );
  const activeGroup = editorGroups.find((group) => group.id === activeGroupId) ?? editorGroups[0];
  const activeTabId = activeGroup?.activeTabId ?? null;
  const openTabs = activeGroup?.openTabs ?? [];
  const allOpenTabIds = useMemo(() => {
    const seen = new Set<string>();
    for (const group of editorGroups) {
      for (const id of group.openTabs) seen.add(id);
    }
    return seen;
  }, [editorGroups]);
  const activeFile = activeTabId ? fileMap[activeTabId] ?? null : null;
  const activeBuffer = activeTabId ? bufferMap[activeTabId] ?? null : null;
  const activeTreeEntryId = treeSelectionCleared ? null : selectedTreeEntryId ?? activeTabId;
  const activeDocument = composeTextDocument(activeFile, activeBuffer);
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const activeDocumentRef = useRef(activeDocument);
  activeDocumentRef.current = activeDocument;
  const activePdfIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of editorGroups) {
      if (!group.activeTabId) continue;
      const file = fileMap[group.activeTabId];
      if (file?.isPdf) ids.push(file.id);
    }
    return ids;
  }, [editorGroups, fileMap]);
  const resolvedTheme = resolveThemeMode(themeMode, prefersDark);
  const dirtyDocumentIds = useMemo(() => new Set(dirtyBuffers.map((entry) => entry.documentId)), [dirtyBuffers]);
  const providerStatuses = providerRegistry.statuses;
  const configuredCloudProviders = getConfiguredCloudProviderCount(providerStatuses);
  const activeCursor = activeTabId ? cursorState[activeTabId] : undefined;
  const activeDraftMerge =
    draftMergeState && activeDocument?.id === draftMergeState.documentId ? draftMergeState : null;
  const activeDraftMergeEntry = activeDraftMerge?.entries[activeDraftMerge.currentIndex] ?? null;
  const pendingRemoteSessions = useMemo(
    () => (manifest ? getPendingForeignSessions(manifest, currentDeviceId, acknowledgedRemoteSessionIds) : []),
    [manifest, currentDeviceId, acknowledgedRemoteSessionIds]
  );
  const selectedRemoteSession =
    pendingRemoteSessions.find((session) => session.revisionId === selectedRemoteSessionRevisionId) ?? null;
  const bundleRuntimeReady = Boolean(
    bundleLink && (window.electronAPI ? bundleLink.bundlePath : browserBundleDirectoryHandleRef.current)
  );
  const workspaceSnapshotSignature = useMemo(
    () =>
      JSON.stringify({
        workspaceId: workspace.id,
        tree,
        editorGroups,
        activeGroupId,
        groupSizes,
        layout,
        sidebarState,
        searchState,
        cursorState,
        themeMode,
        bundleName: bundleLink?.name,
        files: files.map((file) => [
          file.id,
          file.path,
          file.modifiedAt,
          file.size,
          file.conflictState,
          file.pendingForeignDraftCount,
          file.unavailable
        ]),
        dirtyBuffers: dirtyBuffers.map((buffer) => [
          buffer.documentId,
          hashText(buffer.cachedBody),
          buffer.lastAccessedAt,
          buffer.persistedLocal
        ])
      }),
    [
      workspace.id,
      tree,
      editorGroups,
      activeGroupId,
      groupSizes,
      layout,
      sidebarState,
      searchState,
      cursorState,
      themeMode,
      bundleLink?.name,
      files,
      dirtyBuffers
    ]
  );
  const sessionSaveSignature = useMemo(
    () =>
      JSON.stringify({
        themeMode,
        openTabs,
        activeTabId,
        editorGroups,
        activeGroupId,
        groupSizes,
        layout,
        sidebarState,
        searchState,
        cursorState,
        bundleName: bundleLink?.name,
        dirtyBuffers: dirtyBuffers.map((buffer) => [
          buffer.documentId,
          fileMap[buffer.documentId]?.modifiedAt ?? "",
          hashText(buffer.cachedBody)
        ])
      }),
    [
      themeMode,
      openTabs,
      activeTabId,
      editorGroups,
      activeGroupId,
      groupSizes,
      layout,
      sidebarState,
      searchState,
      cursorState,
      bundleLink?.name,
      dirtyBuffers,
      fileMap
    ]
  );

  function getRuntimeLabel() {
    return window.electronAPI ? "desktop" : "web";
  }

  function getDocumentLogDetail(
    document: Pick<WorkspaceFileRecord, "id" | "path" | "name" | "workspaceId"> | null | undefined,
    detail: Record<string, unknown> = {}
  ) {
    return {
      runtime: getRuntimeLabel(),
      workspaceId: document?.workspaceId ?? workspace.id,
      documentId: document?.id,
      documentName: document?.name,
      documentPath: document?.path,
      ...detail
    };
  }

  function logTabActivity(
    message: string,
    document: Pick<WorkspaceFileRecord, "id" | "path" | "name" | "workspaceId"> | null | undefined,
    detail: Record<string, unknown> = {}
  ) {
    logAppActivity("tab", message, getDocumentLogDetail(document, detail));
  }

  function logFileActivity(
    message: string,
    document: Pick<WorkspaceFileRecord, "id" | "path" | "name" | "workspaceId"> | null | undefined,
    detail: Record<string, unknown> = {}
  ) {
    logAppActivity("file", message, getDocumentLogDetail(document, detail));
  }

  function logBufferActivity(
    message: string,
    document: Pick<WorkspaceFileRecord, "id" | "path" | "name" | "workspaceId"> | null | undefined,
    detail: Record<string, unknown> = {}
  ) {
    logAppActivity("buffer", message, getDocumentLogDetail(document, detail));
  }

  function clearWorkspaceAccess() {
    browserWorkspaceDirectoryHandleRef.current = null;
    browserWorkspaceFileHandlesRef.current = new Map();
  }

  function clearBundleAccess() {
    browserBundleDirectoryHandleRef.current = null;
    browserBundleFileHandlesRef.current = new Map();
  }

  function getLatestResolutionByPath(resolutionRefs: DraftResolutionRecord[]) {
    const latestByPath = new Map<string, DraftResolutionRecord>();

    for (const resolution of [...resolutionRefs].sort(sortResolutions)) {
      if (!latestByPath.has(resolution.path)) {
        latestByPath.set(resolution.path, resolution);
      }
    }

    return latestByPath;
  }

  function getClearedDraftRevisionIds(resolutionRefs: DraftResolutionRecord[]) {
    return new Set(resolutionRefs.flatMap((resolution) => resolution.clearedDraftRevisionIds));
  }

  async function buildWorkspaceReferenceForRoot(
    targetWorkspace: WorkspaceRoot,
    bundlePath: string | undefined,
    existingReference?: WorkspaceReference
  ): Promise<WorkspaceReference> {
    if (targetWorkspace.provider !== "local") {
      if (existingReference?.kind === "cloud") {
        return existingReference;
      }

      throw new Error("Cloud workspace bundles are not supported yet.");
    }

    if (window.electronAPI && targetWorkspace.rootPath && bundlePath) {
      const nextReference = await window.electronAPI.createLocalWorkspaceRef({
        workspacePath: targetWorkspace.rootPath,
        bundlePath,
        deviceId: currentDeviceId,
        displayName: targetWorkspace.displayName
      });

      if (existingReference && isLocalWorkspaceReference(existingReference)) {
        return mergeDeviceWorkspaceHint(
          {
            ...existingReference,
            displayName: targetWorkspace.displayName,
            bundleRelativePath: nextReference.bundleRelativePath,
            oneDriveRelativePath: nextReference.oneDriveRelativePath
          },
          currentDeviceId,
          targetWorkspace.rootPath
        );
      }

      return nextReference;
    }

    if (existingReference && isLocalWorkspaceReference(existingReference)) {
      return {
        ...existingReference,
        displayName: targetWorkspace.displayName
      };
    }

    return createBrowserLocalWorkspaceReference(targetWorkspace.displayName);
  }

  function hydrateWorkspace(
    nextWorkspace: WorkspaceRoot,
    nextTree: FileTreeNode[],
    nextFiles: WorkspaceFileRecord[],
    nextBuffers: DocumentBuffer[] = [],
    nextManifest?: WorkspaceManifest,
    nextBundleLink: WorkspaceBundleLink | null = null,
    nextCachedSession?: DeviceSession
  ) {
    const skippedFolders = nextWorkspace.skippedFolders ?? [];
    const filteredFiles = skippedFolders.length
      ? nextFiles.filter((file) => !isPathWithinSkippedFolder(file.path, skippedFolders))
      : nextFiles;
    const filteredTree = buildTreeFromFiles(nextWorkspace, filteredFiles);
    const nextFileMap = toNormalizedFileMap(filteredFiles);
    const nextBufferMap = toNormalizedBufferMap(nextBuffers.filter((buffer) => nextFileMap[buffer.documentId]));
    setWorkspace(nextWorkspace);
    setTree(filteredTree);
    setFileMap(nextFileMap);
    setBufferMap(evictCleanBuffers(nextFileMap, nextBufferMap, getPinnedBufferIds(editorGroupsRef.current, nextBufferMap)));
    setBundleLink(nextBundleLink);
    setManifest(nextManifest);
    setAcknowledgedRemoteSessionIds(new Set());
    setSessionPickerOpen(false);
    setSelectedRemoteSessionRevisionId(null);
    setSessionCompareItems(null);
    setDraftMergeState(null);
    setDiskConflict(null);
    setSearchResults([]);
    setLoadingBufferIds(new Set());

    const ownSession = nextManifest?.deviceSessions.find((session) => session.deviceId === currentDeviceId);
    lastSavedWorkspaceFileSessionSignatureRef.current = ownSession ? getWorkspaceSessionSignature(ownSession) : null;

    const sessionToRestore = nextCachedSession ?? ownSession;
    if (sessionToRestore) {
      const hydratedSession = hydrateSessionState(sessionToRestore, nextFileMap);
      const filteredTabs = hydratedSession.openTabs;
      const restoredTabs = filteredTabs;
      const restoredActive =
        hydratedSession.activeTabId && nextFileMap[hydratedSession.activeTabId]
          ? hydratedSession.activeTabId
          : filteredTabs[0] ?? null;

      if (hydratedSession.editorGroups?.length) {
        const validActiveGroupId =
          hydratedSession.activeGroupId && hydratedSession.editorGroups.some((group) => group.id === hydratedSession.activeGroupId)
            ? hydratedSession.activeGroupId
            : hydratedSession.editorGroups[0].id;
        setEditorGroups(hydratedSession.editorGroups);
        setActiveGroupId(validActiveGroupId);
        setGroupSizes(
          hydratedSession.groupSizes?.length === hydratedSession.editorGroups.length
            ? hydratedSession.groupSizes
            : distributeEqualSizes(hydratedSession.editorGroups.length)
        );
      } else {
        replaceAllGroupsWithSingle(restoredTabs, restoredActive);
      }

      setLayout(mergeLayout(sessionToRestore.layout, defaultLayout, searchAvailable));
      setSidebarState(sessionToRestore.sidebarState);
      setSearchState(sessionToRestore.searchState);
      setCursorState(hydratedSession.cursorState);
      setThemeMode(sessionToRestore.themeMode);
    } else {
      replaceAllGroupsWithSingle([], null);
      setLayout(mergeLayout(defaultLayout, defaultLayout, searchAvailable));
      setSidebarState(defaultSidebarState);
      setSearchState(defaultSearchState);
      setCursorState({});
    }
  }

  async function bootstrapFromCache(isStale: () => boolean) {
    try {
      const [storedTheme, lastWorkspaceSetting] = await Promise.all([
        loadSetting("theme-mode"),
        loadSetting("last-workspace-id")
      ]);

      if (isStale()) {
        return;
      }

      if (storedTheme) {
        setThemeMode(storedTheme.value as ThemeMode);
      }

      if (!lastWorkspaceSetting) {
        setStatusMessage("Loaded sample workspace.");
        return;
      }

      const snapshot = await loadWorkspaceSnapshot(lastWorkspaceSetting.value);

      if (isStale()) {
        return;
      }

      if (!snapshot.workspace) {
        setStatusMessage("Loaded sample workspace.");
        return;
      }

      if (window.electronAPI && snapshot.workspace.root.rootPath) {
        const restoredAccess = await window.electronAPI.restoreWorkspaceAccess(snapshot.workspace.root.rootPath);
        if (isStale()) {
          return;
        }

        if (!restoredAccess) {
          setWorkspaceError("Reopen the workspace folder to restore desktop filesystem access.");
        }
      }

      const restoredBuffers =
        snapshot.workspace.root.id === sampleRoot.id ? mergeSampleWorkspaceBuffers(snapshot.buffers) : snapshot.buffers;

      hydrateWorkspace(
        snapshot.workspace.root,
        snapshot.workspace.tree,
        snapshot.files,
        restoredBuffers,
        snapshot.workspace.manifest,
        snapshot.workspace.bundle ?? null,
        snapshot.workspace.session
      );
      setStatusMessage(`Restored cached workspace: ${snapshot.workspace.root.displayName}`);
    } catch {
      if (!isStale()) {
        setStatusMessage("Loaded sample workspace.");
      }
    }
  }

  async function persistCurrentWorkspaceCache() {
    await persistSetting("last-workspace-id", workspace.id);
    await persistWorkspaceSnapshot(
      {
        id: workspace.id,
        root: workspace,
        tree,
        manifest,
        bundle: bundleLink ?? undefined,
        session: createCurrentSessionSnapshot(),
        updatedAt: new Date().toISOString()
      },
      files,
      dirtyBuffers.map((buffer) => ({
        ...buffer,
        persistedLocal: true
      }))
    );
  }

  useEffect(() => {
    let disposed = false;
    const runId = ++cacheBootstrapRunRef.current;
    const isStale = () => disposed || cacheBootstrapRunRef.current !== runId;

    void bootstrapFromCache(isStale).finally(() => {
      if (!isStale()) {
        setCacheBootstrapSettled(true);
      }
    });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!cacheBootstrapSettled) {
      return;
    }

    logAppActivity("status", statusMessage, {
      runtime: window.electronAPI ? "desktop" : "web",
      workspaceId: workspace.id
    });
  }, [cacheBootstrapSettled, statusMessage, workspace.id]);

  useEffect(() => {
    if (!workspaceError) {
      return;
    }

    logAppActivity("error", workspaceError, {
      runtime: window.electronAPI ? "desktop" : "web",
      workspaceId: workspace.id
    });
  }, [workspaceError, workspace.id]);

  useEffect(() => {
    if (scanProgress && !scanActiveRef.current) {
      scanActiveRef.current = true;
      logAppActivity("scan", "Workspace scan started.", {
        runtime: window.electronAPI ? "desktop" : "web",
        workspaceId: workspace.id,
        source: scanProgress.source
      });
      return;
    }

    if (!scanProgress && scanActiveRef.current) {
      scanActiveRef.current = false;
      logAppActivity("scan", "Workspace scan finished.", {
        runtime: window.electronAPI ? "desktop" : "web",
        workspaceId: workspace.id
      });
    }
  }, [scanProgress, workspace.id]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);

    mediaQuery.addEventListener("change", handleThemeChange);
    applyResolvedTheme(resolvedTheme);

    return () => {
      mediaQuery.removeEventListener("change", handleThemeChange);
    };
  }, [resolvedTheme]);

  useEffect(() => {
    void persistSetting("theme-mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (!bundleLink) {
      lastSavedWorkspaceFileSessionSignatureRef.current = null;
      return;
    }

    const ownSession = manifest?.deviceSessions.find((session) => session.deviceId === currentDeviceId);
    lastSavedWorkspaceFileSessionSignatureRef.current = ownSession ? getWorkspaceSessionSignature(ownSession) : null;
  }, [bundleLink, manifest?.updatedAt, currentDeviceId]);

  useEffect(() => {
    if (!cacheBootstrapSettled) {
      return;
    }

    const timer = window.setTimeout(() => {
      void persistCurrentWorkspaceCache();
    }, 350);

    return () => window.clearTimeout(timer);
  }, [cacheBootstrapSettled, workspaceSnapshotSignature, workspace, tree, manifest, bundleLink, files, dirtyBuffers]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id || !bundleRuntimeReady) {
      return;
    }

    const interval = window.setInterval(() => {
      void pollRemoteManifest();
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void persistCurrentWorkspaceCache();
        return;
      }

      if (document.visibilityState === "visible") {
        void pollRemoteManifest();
        void pollWorkspaceChanges("bundle-visibility");
      }
    };

    const handleFocus = () => {
      void pollRemoteManifest();
      void pollWorkspaceChanges("bundle-focus");
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [workspace.id, bundleRuntimeReady, manifest?.updatedAt, workspaceSnapshotSignature, sessionSaveSignature]);

  function isWorkspaceFileBehindCache() {
    if (!bundleLink || !bundleRuntimeReady) {
      return false;
    }

    return getWorkspaceSessionSignature(createCurrentSessionSnapshot()) !== lastSavedWorkspaceFileSessionSignatureRef.current;
  }

  async function closeDesktopWindowAfterCachePersist() {
    if (!window.electronAPI || workspaceCloseInProgressRef.current) {
      return;
    }

    workspaceCloseInProgressRef.current = true;
    try {
      await persistCurrentWorkspaceCache();
      await window.electronAPI.confirmClose();
    } finally {
      workspaceCloseInProgressRef.current = false;
    }
  }

  async function handleDesktopCloseRequested() {
    await persistCurrentWorkspaceCache();

    if (isWorkspaceFileBehindCache()) {
      setCloseWorkspacePromptOpen(true);
      return;
    }

    await closeDesktopWindowAfterCachePersist();
  }

  async function handleSaveWorkspaceBeforeClose() {
    setCloseWorkspaceSavePending(true);
    await persistCurrentWorkspaceCache();
    await saveWorkspaceSession("Workspace bundle persisted.");

    if (isWorkspaceFileBehindCache()) {
      setCloseWorkspaceSavePending(false);
      return;
    }

    setCloseWorkspacePromptOpen(false);
    setCloseWorkspaceSavePending(false);
    await closeDesktopWindowAfterCachePersist();
  }

  async function handleCloseWithoutSavingWorkspaceFile() {
    setCloseWorkspacePromptOpen(false);
    await closeDesktopWindowAfterCachePersist();
  }

  function handleCancelDesktopClose() {
    setCloseWorkspacePromptOpen(false);
    setCloseWorkspaceSavePending(false);
  }

  useEffect(() => {
    if (!window.electronAPI) {
      return;
    }

    return window.electronAPI.onCloseRequested(() => {
      void handleDesktopCloseRequested();
    });
  }, [workspaceSnapshotSignature, sessionSaveSignature, bundleRuntimeReady, bundleLink]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id) {
      return;
    }

    if (!(window.electronAPI ? workspace.rootPath : browserWorkspaceDirectoryHandleRef.current)) {
      return;
    }

    const interval = window.setInterval(() => {
      void pollWorkspaceChanges("interval");
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [workspace.id, workspace.rootPath, tree, activeTabId, diskConflict?.documentId]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id) {
      return;
    }

    if (!(window.electronAPI ? workspace.rootPath : browserWorkspaceDirectoryHandleRef.current)) {
      return;
    }

    const handleFocus = () => {
      void pollWorkspaceChanges("focus");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollWorkspaceChanges("visibility");
      }
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [workspace.id, workspace.rootPath, tree, activeTabId, diskConflict?.documentId]);

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (event: MouseEvent) => {
      const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, event.clientX - 48));
      setSidebarWidth(next);
    };
    const handleUp = () => setIsResizingSidebar(false);

    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizingSidebar]);

  useEffect(() => {
    if (resizingGroupIndex === null) return;

    const handleMove = (event: MouseEvent) => {
      if (!editorRegionRef.current) return;
      const rect = editorRegionRef.current.getBoundingClientRect();
      handleResizeGroups(resizingGroupIndex, event.clientX, rect);
    };
    const handleUp = () => setResizingGroupIndex(null);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizingGroupIndex]);

  useEffect(() => {
    if (!manifest) {
      return;
    }

    if (pendingRemoteSessions.length === 0) {
      if (sessionPickerOpen) {
        setSessionPickerOpen(false);
      }
      if (selectedRemoteSessionRevisionId !== null) {
        setSelectedRemoteSessionRevisionId(null);
      }
      return;
    }

    if (
      !selectedRemoteSessionRevisionId ||
      !pendingRemoteSessions.some((session) => session.revisionId === selectedRemoteSessionRevisionId)
    ) {
      setSelectedRemoteSessionRevisionId(pendingRemoteSessions[0].revisionId);
    }
  }, [manifest, pendingRemoteSessions, selectedRemoteSessionRevisionId, sessionPickerOpen]);

  useEffect(() => {
    if (!manifest || workspace.id === sampleRoot.id) {
      return;
    }

    void syncDocumentBundleState(manifest);
  }, [bundleRuntimeReady, manifest?.updatedAt, workspace.id]);

  useEffect(() => {
    for (const group of editorGroups) {
      const fileId = group.activeTabId;
      if (!fileId) {
        continue;
      }

      const file = fileMap[fileId];
      if (!file || file.isPdf || bufferMapRef.current[fileId]) {
        continue;
      }

      void ensureBuffer(fileId);
    }
  }, [editorGroups, fileMap]);

  useEffect(() => {
    if (!searchAvailable) {
      if (layout.activeActivity === "search") {
        setLayout((previous) => mergeLayout(previous, previous, false));
      }
      setSearchResults([]);
      return;
    }

    const trimmedQuery = searchState.query.trim();
    if (!trimmedQuery) {
      if (activeSearchRequestIdRef.current && window.electronAPI) {
        void window.electronAPI.cancelWorkspaceSearch(activeSearchRequestIdRef.current).catch(() => {});
        activeSearchRequestIdRef.current = null;
      }
      setSearchResults([]);
      return;
    }

    if (workspace.id === sampleRoot.id || !window.electronAPI || !workspace.rootPath) {
      setSearchResults(searchLoadedBuffers(trimmedQuery, fileMap, bufferMap));
      return;
    }

    const electronApi = window.electronAPI;
    const timeout = window.setTimeout(() => {
      const nextRequestId = createWorkspaceScanId();
      const previousRequestId = activeSearchRequestIdRef.current;
      activeSearchRequestIdRef.current = nextRequestId;
      if (previousRequestId) {
        void electronApi.cancelWorkspaceSearch(previousRequestId).catch(() => {});
      }

      void electronApi
        .searchWorkspace(workspace.rootPath!, trimmedQuery, nextRequestId, 200)
        .then((entries) => {
          if (activeSearchRequestIdRef.current !== nextRequestId) {
            return;
          }

          const fileByPath = getFileMapByPath(fileMapRef.current);
          const mapped = entries
            .map((entry) => {
              const file = fileByPath.get(entry.path);
              return file
                ? {
                    ...entry,
                    documentId: file.id
                  }
                : null;
            })
            .filter((entry): entry is SearchEntry => Boolean(entry));

          setSearchResults(mapped);
        })
        .catch(() => {
          if (activeSearchRequestIdRef.current === nextRequestId) {
            setSearchResults([]);
          }
        });
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchAvailable, searchState.query, workspace.id, workspace.rootPath, bufferMap, fileMap, layout.activeActivity]);

  useEffect(() => {
    const needed = new Set(activePdfIds);

    setPdfBlobEntries((prev) => {
      let changed = false;
      const next: Record<string, { url: string; error?: string }> = {};
      for (const [id, entry] of Object.entries(prev)) {
        if (needed.has(id)) {
          next[id] = entry;
        } else {
          if (entry.url) URL.revokeObjectURL(entry.url);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    for (const id of activePdfIds) {
      if (loadedPdfIdsRef.current.has(id)) continue;
      const file = fileMap[id];
      if (!file) continue;
      loadedPdfIdsRef.current.add(id);
      void (async () => {
        try {
          const blob = await readWorkspaceDocumentBlob(file, "application/pdf");
          const url = URL.createObjectURL(blob);
          setPdfBlobEntries((latest) => ({ ...latest, [id]: { url } }));
        } catch (error) {
          loadedPdfIdsRef.current.delete(id);
          setPdfBlobEntries((latest) => ({
            ...latest,
            [id]: { url: "", error: error instanceof Error ? error.message : String(error) }
          }));
        }
      })();
    }

    for (const id of Array.from(loadedPdfIdsRef.current)) {
      if (!needed.has(id)) {
        loadedPdfIdsRef.current.delete(id);
      }
    }
  }, [activePdfIds, fileMap]);

  async function trackWorkspaceScan<T>(
    work: (context: {
      onBrowserProgress: (progress: BrowserWorkspaceScanProgress) => void;
      signal: AbortSignal;
      registerElectronScan: () => string;
      shouldSkipFolder: (folderPath: string) => boolean;
      getSkippedFolders: () => string[];
    }) => Promise<T>
  ): Promise<T> {
    setWorkspaceError(null);

    let latest: WorkspaceScanProgress | null = null;
    let showTimer: number | null = null;
    let skipFolderTimer: number | null = null;
    let shown = false;
    let cancelRequested = false;
    let activeElectronScanId: string | null = null;
    const abortController = new AbortController();
    const skippedFolders = new Set<string>();

    const isPathWithinFolder = (targetPath: string, folderPath: string) =>
      targetPath === folderPath || targetPath.startsWith(`${folderPath}/`);

    const shouldSkipFolder = (folderPath: string) => {
      for (const skippedFolder of skippedFolders) {
        if (isPathWithinFolder(folderPath, skippedFolder)) {
          return true;
        }
      }

      return false;
    };

    const clearSkipFolderTimer = () => {
      if (skipFolderTimer !== null) {
        window.clearTimeout(skipFolderTimer);
        skipFolderTimer = null;
      }
    };

    const refreshVisibleProgress = (now = Date.now()) => {
      if (!latest) {
        return;
      }

      latest = withWorkspaceScanDerivedState(
        {
          ...latest,
          folderStack: latest.folderStack.filter((folder) => !shouldSkipFolder(folder.path))
        },
        now
      );
      if (shown) {
        setScanProgress(latest);
      }
    };

    const scheduleSkipFolderTimer = () => {
      clearSkipFolderTimer();

      if (!latest || latest.folderStack.length === 0) {
        return;
      }

      if (latest.skipFolderPath) {
        return;
      }

      const now = Date.now();
      const nextAt = latest.folderStack.reduce((earliest, folder) => {
        const thresholdAt = folder.enteredAtMs + WORKSPACE_SKIP_FOLDER_THRESHOLD_MS;
        return thresholdAt < earliest ? thresholdAt : earliest;
      }, Number.POSITIVE_INFINITY);

      if (!Number.isFinite(nextAt)) {
        return;
      }

      const delay = Math.max(0, nextAt - now);
      skipFolderTimer = window.setTimeout(() => {
        skipFolderTimer = null;
        refreshVisibleProgress();
        scheduleSkipFolderTimer();
      }, delay);
    };

    const applyCancelState = () => {
      cancelRequested = true;

      if (!latest) {
        latest = {
          source: "local",
          entriesProcessed: 0,
          filesLoaded: 0,
          currentPath: "",
          folderStack: [],
          skipFolderPath: null,
          skipFolderName: null,
          cancelRequested: true
        };
      } else {
        latest = withWorkspaceScanDerivedState(
          {
            ...latest,
            cancelRequested: true
          },
          Date.now()
        );
      }

      if (shown && latest) {
        setScanProgress(latest);
      }
    };

    const requestCancel = () => {
      if (cancelRequested) {
        return;
      }

      applyCancelState();
      abortController.abort();

      if (window.electronAPI && activeElectronScanId) {
        void window.electronAPI.cancelOpenDirectoryScan(activeElectronScanId).catch(() => {});
      }
    };

    const requestSkipFolder = (folderPath: string) => {
      if (!folderPath || shouldSkipFolder(folderPath)) {
        return;
      }

      skippedFolders.add(folderPath);
      logAppActivity("scan", "Skipped folder during workspace scan.", {
        runtime: window.electronAPI ? "desktop" : "web",
        folderName: folderPath.split("/").at(-1) ?? folderPath,
        folderPath
      });

      if (window.electronAPI && activeElectronScanId) {
        void window.electronAPI.skipOpenDirectoryFolder(activeElectronScanId, folderPath).catch(() => {});
      }

      refreshVisibleProgress();
      scheduleSkipFolderTimer();
    };

    const pushLatest = (next: WorkspaceScanProgress) => {
      const filteredFolderStack = next.folderStack.filter((folder) => !shouldSkipFolder(folder.path));
      latest = withWorkspaceScanDerivedState(
        {
          ...next,
          folderStack: filteredFolderStack,
          cancelRequested
        },
        Date.now()
      );
      scheduleSkipFolderTimer();

      if (shown) {
        setScanProgress(latest);
        return;
      }

      if (showTimer === null) {
        showTimer = window.setTimeout(() => {
          showTimer = null;
          shown = true;
          if (latest) {
            setScanProgress(latest);
          }
        }, 150);
      }
    };

    const mergeAndPush = (partial: Partial<WorkspaceScanProgress>) => {
      const base: WorkspaceScanProgress = latest ?? {
        source: "local",
        entriesProcessed: 0,
        filesLoaded: 0,
        currentPath: "",
        folderStack: [],
        skipFolderPath: null,
        skipFolderName: null,
        cancelRequested
      };
      pushLatest({ ...base, ...partial });
    };

    const unsubscribe = window.electronAPI?.onOpenDirectoryProgress((event) => {
      if (activeElectronScanId && event.scanId !== activeElectronScanId) {
        return;
      }

      mergeAndPush({
        entriesProcessed: event.entriesProcessed,
        filesLoaded: event.filesLoaded,
        currentPath: event.currentPath,
        folderStack: event.folderStack
      });
    });

    const onBrowserProgress = (progress: BrowserWorkspaceScanProgress) => {
      mergeAndPush({
        entriesProcessed: progress.entriesProcessed,
        filesLoaded: progress.filesLoaded,
        currentPath: progress.currentPath,
        folderStack: progress.folderStack
      });
    };

    const registerElectronScan = () => {
      const scanId = createWorkspaceScanId();
      activeElectronScanId = scanId;

      if (cancelRequested && window.electronAPI) {
        void window.electronAPI.cancelOpenDirectoryScan(scanId).catch(() => {});
      }

      return scanId;
    };

    const getSkippedFolders = () => [...skippedFolders].sort();

    scanCancelRef.current = requestCancel;
    scanSkipFolderRef.current = requestSkipFolder;

    try {
      return await work({
        onBrowserProgress,
        signal: abortController.signal,
        registerElectronScan,
        shouldSkipFolder,
        getSkippedFolders
      });
    } finally {
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
      clearSkipFolderTimer();
      unsubscribe?.();
      activeElectronScanId = null;
      if (scanCancelRef.current === requestCancel) {
        scanCancelRef.current = null;
      }
      if (scanSkipFolderRef.current === requestSkipFolder) {
        scanSkipFolderRef.current = null;
      }
      if (shown) {
        setScanProgress(null);
      }
    }
  }

  async function handleOpenLocalWorkspace() {
    try {
      await trackWorkspaceScan(async ({ onBrowserProgress, signal, registerElectronScan, shouldSkipFolder, getSkippedFolders }) => {
        if (window.electronAPI) {
          const result = await window.electronAPI.openDirectory(registerElectronScan());

          if (!result) {
            return;
          }

          const inflated = inflateElectronWorkspace(result);
          clearWorkspaceAccess();
          clearBundleAccess();
          hydrateWorkspace(inflated.root, inflated.tree, inflated.files);
          setStatusMessage(getWorkspaceOpenStatus(result));
          return;
        }

        const browserWorkspace = await openBrowserWorkspace({
          onProgress: onBrowserProgress,
          signal,
          shouldSkipFolder
        });

        if (!browserWorkspace) {
          return;
        }

        clearBundleAccess();
        browserWorkspaceDirectoryHandleRef.current = browserWorkspace.directoryHandle;
        browserWorkspaceFileHandlesRef.current = browserWorkspace.fileHandles;
        hydrateWorkspace(
          {
            ...browserWorkspace.root,
            skippedFolders: getSkippedFolders()
          },
          browserWorkspace.tree,
          browserWorkspace.files
        );
        setStatusMessage(
          getWorkspaceOpenStatus({
            displayName: browserWorkspace.root.displayName,
            cancelled: browserWorkspace.cancelled,
            entriesProcessed: browserWorkspace.entriesProcessed,
            filesLoaded: browserWorkspace.filesLoaded
          })
        );
      });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to open the workspace.");
    }
  }

  async function handleOpenWorkspaceBundle() {
    try {
      await trackWorkspaceScan(async ({ onBrowserProgress, signal, registerElectronScan, shouldSkipFolder, getSkippedFolders }) => {
        if (window.electronAPI) {
          const selection = await window.electronAPI.openBundleDirectory();

          if (!selection) {
            return;
          }

          const bundleState = await window.electronAPI.scanBundle(selection.path);

          if (!bundleState.bootstrap) {
            throw new Error("The selected folder is not a workspace bundle.");
          }

          if (!isLocalWorkspaceReference(bundleState.bootstrap.workspaceRef)) {
            throw new Error("Cloud workspace bundles are not supported yet.");
          }

          let resolvedWorkspace = null;
          const latestCurrentSession = bundleState.sessions.find((session) => session.deviceId === currentDeviceId);
          const candidates = latestCurrentSession?.workspacePath ? [latestCurrentSession.workspacePath] : [];
          candidates.push(
            ...(await window.electronAPI.resolveLocalWorkspaceCandidates({
              bundlePath: selection.path,
              workspaceRef: bundleState.bootstrap.workspaceRef,
              deviceId: currentDeviceId
            }))
          );

          for (const candidate of candidates) {
            resolvedWorkspace = await window.electronAPI.openDirectoryByPath(candidate, registerElectronScan());

            if (resolvedWorkspace) {
              break;
            }
          }

          if (!resolvedWorkspace) {
            resolvedWorkspace = await window.electronAPI.openDirectory(registerElectronScan());
          }

          if (!resolvedWorkspace) {
            return;
          }

          const inflated = inflateElectronWorkspace(resolvedWorkspace);
          const nextWorkspaceRef = await buildWorkspaceReferenceForRoot(
            inflated.root,
            selection.path,
            bundleState.bootstrap.workspaceRef
          );
          const nextBundleLink: WorkspaceBundleLink = {
            name: selection.name,
            bundlePath: selection.path,
            workspaceRef: nextWorkspaceRef
          };

          clearWorkspaceAccess();
          clearBundleAccess();
          hydrateWorkspace(
            inflated.root,
            inflated.tree,
            inflated.files,
            [],
            createRuntimeManifestFromScan(bundleState, nextWorkspaceRef),
            nextBundleLink
          );
          setStatusMessage(getWorkspaceBundleOpenStatus(selection.name, resolvedWorkspace));
          return;
        }

        const bundleSelection = await openBrowserBundleDirectory();

        if (!bundleSelection) {
          return;
        }

        const bundleState = await scanBrowserBundle(bundleSelection);

        if (!bundleState.bootstrap || !isLocalWorkspaceReference(bundleState.bootstrap.workspaceRef)) {
          throw new Error("Cloud workspace bundles are not supported yet.");
        }

        const browserWorkspace = await openBrowserWorkspace({
          onProgress: onBrowserProgress,
          signal,
          shouldSkipFolder
        });

        if (!browserWorkspace) {
          return;
        }

        clearWorkspaceAccess();
        clearBundleAccess();
        browserWorkspaceDirectoryHandleRef.current = browserWorkspace.directoryHandle;
        browserWorkspaceFileHandlesRef.current = browserWorkspace.fileHandles;
        browserBundleDirectoryHandleRef.current = bundleSelection.directoryHandle;
        browserBundleFileHandlesRef.current = bundleSelection.fileHandles;

        const nextWorkspaceRef = await buildWorkspaceReferenceForRoot(
          browserWorkspace.root,
          undefined,
          bundleState.bootstrap.workspaceRef
        );
        const nextBundleLink: WorkspaceBundleLink = {
          name: bundleSelection.name,
          workspaceRef: nextWorkspaceRef
        };

        hydrateWorkspace(
          {
            ...browserWorkspace.root,
            skippedFolders: getSkippedFolders()
          },
          browserWorkspace.tree,
          browserWorkspace.files,
          [],
          createRuntimeManifestFromScan(bundleState, nextWorkspaceRef),
          nextBundleLink
        );
        setStatusMessage(
          getWorkspaceBundleOpenStatus(bundleSelection.name, {
            cancelled: browserWorkspace.cancelled,
            entriesProcessed: browserWorkspace.entriesProcessed,
            filesLoaded: browserWorkspace.filesLoaded
          })
        );
      });
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Unable to open the workspace bundle.");
    }
  }

  function applyBufferPolicy(
    nextBufferMap: Record<string, DocumentBuffer>,
    forceEvictIds: string[] = [],
    reason = "buffer-policy"
  ) {
    const next = evictCleanBuffers(
      fileMapRef.current,
      nextBufferMap,
      getPinnedBufferIds(editorGroupsRef.current, nextBufferMap),
      forceEvictIds
    );

    const evictedIds = Object.keys(nextBufferMap).filter((documentId) => !next[documentId]);
    for (const documentId of evictedIds) {
      const file = fileMapRef.current[documentId];
      logBufferActivity("Removed buffer from memory cache.", file, { reason });
    }

    return next;
  }

  function evictBufferIfClean(documentId: string, reason = "explicit-evict") {
    setBufferMap((previous) => applyBufferPolicy(previous, [documentId], reason));
  }

  async function ensureBuffer(documentId: string, reason = "buffer-load"): Promise<DocumentBuffer | null> {
    const file = fileMapRef.current[documentId];
    if (!file || file.isPdf) {
      return null;
    }

    const existing = bufferMapRef.current[documentId];
    if (existing) {
      const touched = touchBuffer(existing);
      logBufferActivity("Buffer cache hit.", file, { reason, cachedLength: existing.cachedBody.length });
      if (touched.lastAccessedAt !== existing.lastAccessedAt) {
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [documentId]: touched
          }, [], "buffer-touch")
        );
      }
      return touched;
    }

    const inFlight = bufferLoadInFlightRef.current.get(documentId);
    if (inFlight) {
      return inFlight;
    }

    setLoadingBufferIds((previous) => {
      const next = new Set(previous);
      next.add(documentId);
      return next;
    });

    const pending = (async () => {
      try {
        const latestFile = fileMapRef.current[documentId];
        if (!latestFile || latestFile.isPdf) {
          return null;
        }

        const body = await readWorkspaceDocumentBody(latestFile, reason);
        const nextBuffer = createBufferFromBody(latestFile, body);
        logBufferActivity("Loaded buffer into memory cache.", latestFile, {
          reason,
          cachedLength: body.length
        });
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [documentId]: nextBuffer
          }, [], "buffer-load")
        );
        return nextBuffer;
      } finally {
        bufferLoadInFlightRef.current.delete(documentId);
        setLoadingBufferIds((previous) => {
          if (!previous.has(documentId)) {
            return previous;
          }
          const next = new Set(previous);
          next.delete(documentId);
          return next;
        });
      }
    })();

    bufferLoadInFlightRef.current.set(documentId, pending);
    return pending;
  }

  /**
   * Starts the remote-draft review for a specific file record.
   *
   * @param file - The workspace file whose foreign drafts should be reviewed.
   * @returns A promise that settles after the review state is initialized or skipped.
   */
  async function startDraftMergeForFile(file: WorkspaceFileRecord) {
    if (!file || file.pendingForeignDraftCount === 0 || file.foreignDrafts.length === 0) {
      return;
    }

    if (draftMergeState?.documentId === file.id) {
      return;
    }

    const entries: DraftMergeEntry[] = [];

    for (const foreignDraft of [...file.foreignDrafts].sort(sortForeignDrafts)) {
      try {
        entries.push({
          ...foreignDraft,
          body: await readDraftBlob(foreignDraft.blobPath)
        });
      } catch {
        continue;
      }
    }

    if (entries.length === 0) {
      return;
    }

    setDraftMergeState({
      documentId: file.id,
      entries,
      currentIndex: 0
    });
    setStatusMessage(`Reviewing ${entries.length} remote draft${entries.length === 1 ? "" : "s"} for ${file.name}.`);
  }

  /**
   * Starts the remote-draft review for the document currently known in state.
   *
   * @param documentId - The document id whose foreign drafts should be reviewed.
   * @returns A promise that settles after the review state is initialized or skipped.
   */
  async function startDraftMerge(documentId: string) {
    const file = fileMap[documentId];
    if (!file) {
      return;
    }

    await startDraftMergeForFile(file);
  }

  function handleActivateFile(
    documentId: string,
    options: { preview?: boolean; groupId?: string } = {}
  ) {
    setSelectedTreeEntryId(documentId);
    setTreeSelectionCleared(false);
    const asPreview = options.preview ?? true;
    const targetGroupId = options.groupId ?? activeGroupId;
    const resolvedTargetGroupId = editorGroupsRef.current.find((group) => group.id === targetGroupId)?.id ?? editorGroupsRef.current[0]?.id ?? targetGroupId;
    const existingTargetGroup = editorGroupsRef.current.find((group) => group.id === resolvedTargetGroupId);
    const file = fileMap[documentId];
    const willCreateTab = !existingTargetGroup?.openTabs.includes(documentId);
    const nextPreviewTabId = resolvePreviewTabId({
      asPreview,
      existingPreviewTabId: existingTargetGroup?.previewTabId ?? null,
      targetDocumentId: documentId,
      documentAlreadyOpen: !willCreateTab
    });
    const replacedPreviewId =
      nextPreviewTabId === documentId &&
      existingTargetGroup?.previewTabId &&
      existingTargetGroup.previewTabId !== documentId &&
      existingTargetGroup.openTabs.includes(existingTargetGroup.previewTabId)
        ? existingTargetGroup.previewTabId
        : null;

    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== resolvedTargetGroupId) return group;
        let nextTabs = group.openTabs;
        let nextPreview = group.previewTabId;
        if (!nextTabs.includes(documentId)) {
          if (asPreview && group.previewTabId && nextTabs.includes(group.previewTabId)) {
            nextTabs = nextTabs.map((id) => (id === group.previewTabId ? documentId : id));
          } else {
            nextTabs = [...nextTabs, documentId];
          }
        }
        nextPreview = nextPreviewTabId;
        return { ...group, openTabs: nextTabs, previewTabId: nextPreview, activeTabId: documentId };
      })
    );
    setActiveGroupId(resolvedTargetGroupId);

    if (willCreateTab && file) {
      logTabActivity("Created tab.", file, {
        groupId: resolvedTargetGroupId,
        mode: asPreview ? "preview" : "pinned"
      });
    }

    if (replacedPreviewId) {
      const replacedPreviewFile = fileMapRef.current[replacedPreviewId];
      logTabActivity("Replaced preview tab.", replacedPreviewFile, {
        groupId: resolvedTargetGroupId,
        nextDocumentId: documentId,
        nextDocumentPath: file?.path
      });
      const openElsewhere = editorGroupsRef.current.some(
        (group) => group.id !== resolvedTargetGroupId && group.openTabs.includes(replacedPreviewId)
      );
      if (!openElsewhere) {
        evictBufferIfClean(replacedPreviewId, "preview-replaced");
      }
    }

    if (!file) {
      return;
    }

    if (!file.isPdf) {
      void ensureBuffer(documentId, willCreateTab ? "tab-open" : "tab-focus");
    }

    if (file.conflictState === "disk-changed") {
      void queueDiskConflict(file);
      return;
    }

    if (file.pendingForeignDraftCount > 0) {
      void startDraftMerge(documentId);
    }
  }

  function handlePromoteTab(documentId: string, groupId?: string) {
    setSelectedTreeEntryId(documentId);
    setTreeSelectionCleared(false);
    const targetGroupId = groupId ?? activeGroupId;
    const resolvedTargetGroupId = editorGroupsRef.current.find((group) => group.id === targetGroupId)?.id ?? editorGroupsRef.current[0]?.id ?? targetGroupId;
    const existingTargetGroup = editorGroupsRef.current.find((group) => group.id === resolvedTargetGroupId);
    const file = fileMap[documentId];
    const willCreateTab = !existingTargetGroup?.openTabs.includes(documentId);
    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== resolvedTargetGroupId) return group;
        const nextTabs = group.openTabs.includes(documentId) ? group.openTabs : [...group.openTabs, documentId];
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: documentId,
          previewTabId: group.previewTabId === documentId ? null : group.previewTabId
        };
      })
    );
    setActiveGroupId(resolvedTargetGroupId);
    if (file) {
      logTabActivity(willCreateTab ? "Created pinned tab." : "Promoted tab.", file, {
        groupId: resolvedTargetGroupId
      });
    }
    if (file && !file.isPdf) {
      void ensureBuffer(documentId, willCreateTab ? "tab-promote-create" : "tab-promote");
      requestEditorFocus(resolvedTargetGroupId, documentId);
    }
  }

  function handleReorderTabs(groupId: string, fromId: string, toId: string, before: boolean) {
    if (fromId === toId) return;
    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== groupId) return group;
        const without = group.openTabs.filter((id) => id !== fromId);
        const targetIndex = without.indexOf(toId);
        if (targetIndex === -1) return group;
        const insertIndex = before ? targetIndex : targetIndex + 1;
        const nextTabs = [...without.slice(0, insertIndex), fromId, ...without.slice(insertIndex)];
        return { ...group, openTabs: nextTabs };
      })
    );
  }

  /**
   * Checks whether a document remains open after a pending group close operation.
   *
   * @param documentId - The document id being considered for closure.
   * @param groupId - The editor group where tabs are being closed.
   * @param tabIdsToClose - The tab ids scheduled to close in the group.
   * @returns True when another tab instance will still keep the document open.
   */
  function isDocumentOpenAfterTabClose(documentId: string, groupId: string, tabIdsToClose: Set<string>) {
    return editorGroupsRef.current.some((group) => {
      if (group.id !== groupId) {
        return group.openTabs.includes(documentId);
      }

      return group.openTabs.some((id) => id === documentId && !tabIdsToClose.has(id));
    });
  }

  /**
   * Finds the first dirty document that needs user confirmation before closing.
   *
   * @param groupId - The editor group where tabs are being closed.
   * @param tabIdsToClose - The tab ids scheduled to close in the group.
   * @returns The dirty document id that blocks closing, or null when no prompt is needed.
   */
  function getDirtyTabCloseBlocker(groupId: string, tabIdsToClose: Set<string>) {
    for (const documentId of tabIdsToClose) {
      if (bufferMapRef.current[documentId]?.dirty && !isDocumentOpenAfterTabClose(documentId, groupId, tabIdsToClose)) {
        return documentId;
      }
    }

    return null;
  }

  /**
   * Requests tab closure and prompts before discarding or saving dirty documents.
   *
   * @param groupId - The editor group where tabs should close.
   * @param tabIdsToClose - The tab ids requested for closure.
   * @param reason - The user action that initiated the close request.
   * @returns Nothing.
   */
  function requestCloseTabsFromGroup(
    groupId: string,
    tabIdsToClose: Set<string>,
    reason: "user-close" | "context-menu"
  ) {
    if (tabIdsToClose.size === 0) return;

    const dirtyDocumentId = getDirtyTabCloseBlocker(groupId, tabIdsToClose);
    if (dirtyDocumentId) {
      setDirtyTabCloseSavePending(false);
      setDirtyTabClosePrompt({
        documentId: dirtyDocumentId,
        groupId,
        tabIdsToClose: [...tabIdsToClose],
        reason
      });
      return;
    }

    performCloseTabsFromGroup(groupId, tabIdsToClose, reason);
  }

  /**
   * Closes tabs after any required dirty-document prompt has been resolved.
   *
   * @param groupId - The editor group where tabs should close.
   * @param tabIdsToClose - The tab ids that can close immediately.
   * @param reason - The user action that initiated the close request.
   * @returns Nothing.
   */
  function performCloseTabsFromGroup(
    groupId: string,
    tabIdsToClose: Set<string>,
    reason: "user-close" | "context-menu"
  ) {
    if (tabIdsToClose.size === 0) return;
    for (const documentId of tabIdsToClose) {
      const file = fileMapRef.current[documentId];
      logTabActivity("Closed tab.", file, { groupId, reason });
    }
    let removedGroupIndex = -1;
    setEditorGroups((groups) => {
      const next = groups.map((group) => {
        if (group.id !== groupId) return group;
        const nextTabs = group.openTabs.filter((id) => !tabIdsToClose.has(id));
        let nextActive = group.activeTabId;
        if (group.activeTabId && tabIdsToClose.has(group.activeTabId)) {
          nextActive = nextTabs.at(-1) ?? null;
        }
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: nextActive,
          previewTabId: group.previewTabId && tabIdsToClose.has(group.previewTabId) ? null : group.previewTabId
        };
      });
      if (next.length > 1) {
        const emptyIndex = next.findIndex((g) => g.id === groupId && g.openTabs.length === 0);
        if (emptyIndex !== -1) {
          removedGroupIndex = emptyIndex;
          return next.filter((_, i) => i !== emptyIndex);
        }
      }
      return next;
    });
    if (removedGroupIndex !== -1) {
      setGroupSizes((sizes) => {
        if (sizes.length <= 1) return sizes;
        const removed = sizes[removedGroupIndex] ?? 0;
        const remaining = sizes.filter((_, i) => i !== removedGroupIndex);
        if (remaining.length === 0) return sizes;
        const share = removed / remaining.length;
        return remaining.map((s) => s + share);
      });
      setActiveGroupId((current) => {
        if (current !== groupId) return current;
        return editorGroups[Math.max(0, removedGroupIndex - 1)]?.id ?? editorGroups[0]?.id ?? current;
      });
    }
    for (const documentId of tabIdsToClose) {
      if (!isDocumentOpenAfterTabClose(documentId, groupId, tabIdsToClose)) {
        evictBufferIfClean(documentId, "tab-closed");
      }
    }
  }

  /**
   * Handles a single tab close request from the tab strip.
   *
   * @param documentId - The document id for the tab being closed.
   * @param groupId - The editor group id that owns the tab.
   * @returns Nothing.
   */
  function handleCloseTab(documentId: string, groupId?: string) {
    requestCloseTabsFromGroup(groupId ?? activeGroupId, new Set([documentId]), "user-close");
  }

  function handleCloseOtherTabs(documentId: string, groupId: string) {
    const group = editorGroupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    requestCloseTabsFromGroup(groupId, new Set(group.openTabs.filter((id) => id !== documentId)), "context-menu");
  }

  function handleCloseTabsToRight(documentId: string, groupId: string) {
    const group = editorGroupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    const index = group.openTabs.indexOf(documentId);
    if (index === -1) return;
    requestCloseTabsFromGroup(groupId, new Set(group.openTabs.slice(index + 1)), "context-menu");
  }

  function handleCloseSavedTabs(groupId: string) {
    const group = editorGroupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    const toClose = group.openTabs.filter((id) => !bufferMapRef.current[id]?.dirty);
    requestCloseTabsFromGroup(groupId, new Set(toClose), "context-menu");
  }

  function handleCloseAllTabs(groupId: string) {
    const group = editorGroupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    requestCloseTabsFromGroup(groupId, new Set(group.openTabs), "context-menu");
  }

  /**
   * Continues a deferred tab close request after the dirty document is resolved.
   *
   * @param pendingClose - The pending close request captured before prompting.
   * @returns Nothing.
   */
  function continuePendingDirtyTabClose(pendingClose: PendingDirtyTabClose) {
    requestCloseTabsFromGroup(
      pendingClose.groupId,
      new Set(pendingClose.tabIdsToClose),
      pendingClose.reason
    );
  }

  /**
   * Clears this device's local dirty cache for one document without touching other devices.
   *
   * @param documentId - The dirty document id being discarded locally.
   * @returns A promise that settles after local state and bundle draft tombstones are updated.
   */
  async function discardDirtyDocumentFromCurrentDevice(documentId: string) {
    const file = fileMapRef.current[documentId];
    if (!file || !bufferMapRef.current[documentId]) {
      return;
    }

    const nextBufferMap = { ...bufferMapRef.current };
    delete nextBufferMap[documentId];

    bufferMapRef.current = nextBufferMap;
    setBufferMap(applyBufferPolicy(nextBufferMap, [], "discard-tab-close"));
    setStatusMessage(`Discarded local changes for ${file.name}.`);
    await persistSetting("last-workspace-id", workspace.id);
    await persistWorkspaceSnapshot(
      {
        id: workspace.id,
        root: workspace,
        tree,
        manifest,
        bundle: bundleLink ?? undefined,
        session: createCurrentSessionSnapshot(),
        updatedAt: new Date().toISOString()
      },
      Object.values(fileMapRef.current),
      Object.values(nextBufferMap)
        .filter((entry) => entry.dirty)
        .map((entry) => ({
          ...entry,
          persistedLocal: true
        }))
    );

    if (bundleRuntimeReady) {
      await saveWorkspaceSession(`Discarded local changes for ${file.name}.`, {
        fileMapOverride: fileMapRef.current,
        bufferMapOverride: nextBufferMap
      });
    }
  }

  /**
   * Saves the prompted dirty tab, then resumes the close request.
   *
   * @returns A promise that settles after save and close processing completes.
   */
  async function handleSaveDirtyTabBeforeClose() {
    if (!dirtyTabClosePrompt) {
      return;
    }

    const pendingClose = dirtyTabClosePrompt;
    setDirtyTabCloseSavePending(true);
    const result = await saveDocumentById(pendingClose.documentId, {
      requireMergedDrafts: true,
      clearAllDeviceDrafts: true
    });
    setDirtyTabCloseSavePending(false);

    if (result !== "saved") {
      setDirtyTabClosePrompt(null);
      return;
    }

    setDirtyTabClosePrompt(null);
    continuePendingDirtyTabClose(pendingClose);
  }

  /**
   * Discards this device's dirty cache for the prompted tab, then resumes closing.
   *
   * @returns A promise that settles after discard and close processing completes.
   */
  async function handleDontSaveDirtyTabBeforeClose() {
    if (!dirtyTabClosePrompt) {
      return;
    }

    const pendingClose = dirtyTabClosePrompt;
    setDirtyTabClosePrompt(null);
    await discardDirtyDocumentFromCurrentDevice(pendingClose.documentId);
    continuePendingDirtyTabClose(pendingClose);
  }

  /**
   * Cancels a pending dirty-tab close prompt.
   *
   * @returns Nothing.
   */
  function handleCancelDirtyTabClose() {
    setDirtyTabClosePrompt(null);
    setDirtyTabCloseSavePending(false);
  }

  function handleCopyFilePath(documentId: string) {
    const file = fileMapRef.current[documentId];
    if (file?.absolutePath) {
      navigator.clipboard.writeText(formatAbsolutePathForClipboard(file.absolutePath));
    }
  }

  function handleCopyRelativePath(documentId: string) {
    const file = fileMapRef.current[documentId];
    if (file?.path) {
      navigator.clipboard.writeText(file.path);
    }
  }

  function requestEditorFocus(groupId: string, documentId: string) {
    editorFocusTokenRef.current += 1;
    setEditorFocusRequest({
      groupId,
      documentId,
      token: editorFocusTokenRef.current
    });
  }

  function showOperationError(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message : fallback;
    setStatusMessage(message);
    setOperationErrorMessage(message);
  }

  function expandParentDirectories(path: string) {
    const parts = path.split("/").filter(Boolean);
    const parents = parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
    if (parents.length === 0) {
      return;
    }

    setSidebarState((previous) => ({
      ...previous,
      expandedPaths: [...new Set([...previous.expandedPaths, ...parents])]
    }));
  }

  function handleStartCreateTreeEntry(kind: "file" | "directory", parentPath: string | null) {
    if (workspace.id !== sampleRoot.id && !window.electronAPI && !browserWorkspaceDirectoryHandleRef.current) {
      setStatusMessage(
        kind === "file"
          ? "Reopen the workspace folder in this browser session to create files."
          : "Reopen the workspace folder in this browser session to create folders."
      );
      return;
    }

    setRenamingTreeNodeId(null);
    setPendingCreateTreeEntry({ kind, parentPath });
    if (parentPath) {
      setSidebarState((previous) => ({
        ...previous,
        expandedPaths: [...new Set([...previous.expandedPaths, parentPath])]
      }));
    }
  }

  async function confirmCreateTreeEntry(kind: "file" | "directory", parentPath: string | null, rawName: string) {
    setPendingCreateTreeEntry(null);
    const fallback = kind === "file" ? "untitled.txt" : "New Folder";
    const name = normalizeRelativeEntryName(rawName, fallback);
    if (!name) {
      return;
    }

    const path = joinWorkspacePath(parentPath, name);
    if (getExistingEntryPaths().has(path)) {
      setStatusMessage(`${path} already exists.`);
      return;
    }

    try {
      if (kind === "file") {
        const writeResult =
          workspace.id === sampleRoot.id
            ? { modifiedAt: new Date().toISOString(), size: 0 }
            : await providerRegistry.local.createTextFile({
                path,
                absolutePath: getAbsolutePathForRelativePath(path)
              });
        const nextFile = createFileRecordFromPath(path, writeResult);
        const nextFileMap = {
          ...fileMapRef.current,
          [nextFile.id]: nextFile
        };

        fileMapRef.current = nextFileMap;
        setFileMap(nextFileMap);
        setTree(rebuildTreeFromFileMap(nextFileMap, [...collectDirectoryPaths(tree)]));
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [nextFile.id]: createBufferFromBody(nextFile, "")
          }, [], "tree-create-file")
        );
        expandParentDirectories(path);
        addTabToActiveGroup(nextFile.id, true, { promote: true, focus: true });
        setSelectedTreeEntryId(nextFile.id);
        setTreeSelectionCleared(false);
        setStatusMessage(`Created ${nextFile.path}`);
        return;
      }

      if (workspace.id !== sampleRoot.id) {
        await providerRegistry.local.createDirectory({
          path,
          absolutePath: getAbsolutePathForRelativePath(path)
        });
      }

      setTree((previous) => upsertDirectoryNode(previous, workspace, path));
      expandParentDirectories(`${path}/placeholder`);
      setStatusMessage(`Created ${path}`);
    } catch (error) {
      showOperationError(new Error(getCreateEntryErrorMessage(kind)), getCreateEntryErrorMessage(kind));
    }
  }

  function handleCopyTreeEntry(node: FileTreeNode) {
    setFileTreeClipboard(getEntryOperation(node));
    setStatusMessage(`Copied ${node.path}`);
  }

  function handleSelectTreeEntry(entryId: string) {
    setSelectedTreeEntryId(entryId);
    setTreeSelectionCleared(false);
  }

  function handleClearTreeSelection() {
    setSelectedTreeEntryId(null);
    setTreeSelectionCleared(true);
  }

  async function copyTreeEntryToPath(source: FileTreeClipboardEntry, targetPath: string) {
    if (source.kind === "directory" && isSameOrChildPath(targetPath, source.path)) {
      setStatusMessage("A folder cannot be copied into itself.");
      return;
    }

    try {
      if (workspace.id !== sampleRoot.id) {
        await providerRegistry.local.copyEntry(source, getEntryOperationForPath(targetPath, source.kind));
      }

      const now = new Date().toISOString();
      const sourceFiles = Object.values(fileMapRef.current).filter((file) =>
        source.kind === "directory" ? isSameOrChildPath(file.path, source.path) : file.path === source.path
      );
      const idMap = new Map<string, string>();
      const nextFiles: WorkspaceFileRecord[] = [];

      for (const sourceFile of sourceFiles) {
        const nextPath =
          source.kind === "directory"
            ? `${targetPath}${sourceFile.path.slice(source.path.length)}`
            : targetPath;
        const nextId = getDocumentIdForPath(nextPath);
        idMap.set(sourceFile.id, nextId);
        const snapshot =
          workspace.id === sampleRoot.id
            ? null
            : await providerRegistry.local.getSnapshot({
                path: nextPath,
                absolutePath: getAbsolutePathForRelativePath(nextPath)
              });
        const modifiedAt = snapshot?.modifiedAt ?? now;
        const size = snapshot?.size ?? sourceFile.size;
        const metadata = getLanguageMetadata(nextPath);
        const pdf = nextPath.toLowerCase().endsWith(".pdf");
        nextFiles.push(
          normalizeFile({
            ...sourceFile,
            id: nextId,
            path: nextPath,
            name: getPathName(nextPath),
            language: pdf ? "PDF" : metadata.label,
            size,
            modifiedAt,
            lastSyncedModifiedAt: modifiedAt,
            lastSyncedSize: size,
            absolutePath: snapshot?.absolutePath ?? getAbsolutePathForRelativePath(nextPath),
            conflictState: undefined,
            foreignDrafts: [],
            pendingForeignDraftCount: 0,
            isMarkdown: !pdf && Boolean(metadata.markdown ?? isMarkdownPath(nextPath)),
            isPdf: pdf,
            unavailable: false
          })
        );
      }

      setFileMap((previous) => {
        const next = { ...previous };
        for (const file of nextFiles) {
          next[file.id] = file;
        }
        const directoryPaths = [...collectDirectoryPaths(tree)];
        if (source.kind === "directory") {
          directoryPaths.push(targetPath);
          for (const directoryPath of collectDirectoryPaths(tree)) {
            if (isSameOrChildPath(directoryPath, source.path)) {
              directoryPaths.push(`${targetPath}${directoryPath.slice(source.path.length)}`);
            }
          }
        }
        setTree(rebuildTreeFromFileMap(next, directoryPaths));
        fileMapRef.current = next;
        return next;
      });
      setBufferMap((previous) => {
        const next = { ...previous };
        for (const file of nextFiles) {
          const sourceId = [...idMap.entries()].find(([, nextId]) => nextId === file.id)?.[0];
          const sourceBuffer = sourceId ? previous[sourceId] : undefined;
          if (sourceBuffer && !file.isPdf) {
            next[file.id] = createBufferFromBody(file, sourceBuffer.cachedBody);
          }
        }
        return applyBufferPolicy(next, [], "tree-copy-entry");
      });
      expandParentDirectories(targetPath);
      setStatusMessage(`Copied ${source.path} to ${targetPath}`);
    } catch (error) {
      showOperationError(error, `Unable to copy ${source.path}.`);
    }
  }

  async function handlePasteTreeEntry(targetDirectoryPath: string | null) {
    if (!fileTreeClipboard) {
      return;
    }

    const targetPath = getUniquePath(targetDirectoryPath, getPathName(fileTreeClipboard.path));
    await copyTreeEntryToPath(fileTreeClipboard, targetPath);
  }

  async function handleDuplicateTreeEntry(node: FileTreeNode) {
    const parentPath = getParentPath(node.path);
    const targetPath = getUniquePath(parentPath, getPathName(node.path));
    await copyTreeEntryToPath(getEntryOperation(node), targetPath);
  }

  function handleRenameTreeEntry(node: FileTreeNode) {
    setRenamingTreeNodeId(node.id);
    if (node.kind === "file") {
      setSelectedTreeEntryId(node.id);
      setTreeSelectionCleared(false);
    }
  }

  async function confirmRenameTreeEntry(node: FileTreeNode, rawName: string) {
    setRenamingTreeNodeId(null);
    const nextName = normalizeRelativeEntryName(rawName, node.name);
    if (!nextName || nextName === node.name) {
      return;
    }

    const targetPath = joinWorkspacePath(getParentPath(node.path), nextName);
    if (getExistingEntryPaths().has(targetPath)) {
      setStatusMessage(`${targetPath} already exists.`);
      return;
    }

    if (node.kind === "directory" && isSameOrChildPath(targetPath, node.path)) {
      setStatusMessage("A folder cannot be moved into itself.");
      return;
    }

    try {
      if (workspace.id !== sampleRoot.id) {
        await providerRegistry.local.moveEntry(getEntryOperation(node), getEntryOperationForPath(targetPath, node.kind));
      }

      const idMap = new Map<string, string>();
      const nextFileMap: Record<string, WorkspaceFileRecord> = {};
      for (const [documentId, file] of Object.entries(fileMapRef.current)) {
        if (!isSameOrChildPath(file.path, node.path)) {
          nextFileMap[documentId] = file;
          continue;
        }

        const nextPath = node.kind === "directory" ? `${targetPath}${file.path.slice(node.path.length)}` : targetPath;
        const nextId = getDocumentIdForPath(nextPath);
        const metadata = getLanguageMetadata(nextPath);
        const pdf = nextPath.toLowerCase().endsWith(".pdf");
        idMap.set(documentId, nextId);
        nextFileMap[nextId] = normalizeFile({
          ...file,
          id: nextId,
          path: nextPath,
          name: getPathName(nextPath),
          language: pdf ? "PDF" : metadata.label,
          absolutePath: getAbsolutePathForRelativePath(nextPath),
          isMarkdown: !pdf && Boolean(metadata.markdown ?? isMarkdownPath(nextPath)),
          isPdf: pdf
        });
      }

      const nextDirectories = [...collectDirectoryPaths(tree)]
        .filter((directoryPath) => !isSameOrChildPath(directoryPath, node.path))
        .concat(
          [...collectDirectoryPaths(tree)]
            .filter((directoryPath) => isSameOrChildPath(directoryPath, node.path))
            .map((directoryPath) => `${targetPath}${directoryPath.slice(node.path.length)}`)
        );
      fileMapRef.current = nextFileMap;
      setFileMap(nextFileMap);
      setBufferMap((previous) => applyBufferPolicy(remapBuffersForDocumentIdMap(previous, idMap), [], "tree-rename-entry"));
      updateGroupsForDocumentIdMap(idMap);
      setTree(rebuildTreeFromFileMap(nextFileMap, nextDirectories));
      expandParentDirectories(targetPath);
      setStatusMessage(`Renamed ${node.path} to ${targetPath}`);
    } catch (error) {
      showOperationError(error, `Unable to rename ${node.path}.`);
    }
  }

  function handleDeleteTreeEntry(node: FileTreeNode) {
    const affectedFiles = Object.values(fileMapRef.current).filter((file) =>
      node.kind === "directory" ? isSameOrChildPath(file.path, node.path) : file.path === node.path
    );
    const dirtyCount = affectedFiles.filter((file) => bufferMapRef.current[file.id]?.dirty).length;
    const descendantCount = countTreeDescendants(node);
    const isNonEmptyFolder = node.kind === "directory" && descendantCount > 0;
    const message = dirtyCount > 0
      ? `This folder is not empty. Delete ${node.path} and discard ${dirtyCount} unsaved file${dirtyCount === 1 ? "" : "s"}?`
      : isNonEmptyFolder
        ? `This folder is not empty. Delete ${node.path} and all of its contents?`
        : `Delete ${node.path}?`;

    setPendingDeleteEntry({ node, message });
  }

  async function confirmDeleteTreeEntry(node: FileTreeNode) {
    try {
      if (workspace.id !== sampleRoot.id) {
        await providerRegistry.local.deleteEntry(getEntryOperation(node));
      }

      const affectedFiles = Object.values(fileMapRef.current).filter((file) =>
        node.kind === "directory" ? isSameOrChildPath(file.path, node.path) : file.path === node.path
      );
      const removedIds = new Set(affectedFiles.map((file) => file.id));
      setFileMap((previous) => {
        const next = { ...previous };
        for (const id of removedIds) {
          delete next[id];
        }
        fileMapRef.current = next;
        return next;
      });
      setBufferMap((previous) => {
        const next = { ...previous };
        for (const id of removedIds) {
          delete next[id];
        }
        return next;
      });
      setSelectedTreeEntryId((entryId) => (entryId && removedIds.has(entryId) ? null : entryId));
      if (selectedTreeEntryId && removedIds.has(selectedTreeEntryId)) {
        setTreeSelectionCleared(true);
      }
      filterGroupsByDocumentPredicate((documentId) => !removedIds.has(documentId));
      setTree((previous) => removeTreePath(previous, node.path));
      setStatusMessage(`Deleted ${node.path}`);
    } catch (error) {
      showOperationError(error, `Unable to delete ${node.path}.`);
    }
  }

  function handleCopyTreePath(node: FileTreeNode) {
    const absolutePath = node.absolutePath ?? getAbsolutePathForRelativePath(node.path);
    if (absolutePath) {
      navigator.clipboard.writeText(formatAbsolutePathForClipboard(absolutePath));
      setStatusMessage(`Copied path for ${node.name}`);
    }
  }

  function handleCopyTreeRelativePath(node: FileTreeNode) {
    navigator.clipboard.writeText(node.path);
    setStatusMessage(`Copied relative path for ${node.name}`);
  }

  async function handleRevealTreeEntry(node: FileTreeNode) {
    try {
      await providerRegistry.local.revealEntry(getEntryOperation(node));
    } catch (error) {
      showOperationError(error, `Unable to reveal ${node.path}.`);
    }
  }

  /**
   * Updates the active document buffer and logs only the clean-to-dirty transition.
   *
   * @param nextValue - The next editor text for the active document.
   * @returns Nothing.
   */
  function handleUpdateDocument(nextValue: string) {
    if (!activeFile) {
      return;
    }

    const documentId = activeFile.id;
    const groupId = activeGroupId;
    const previousBuffer = bufferMapRef.current[documentId];
    const previousBody = previousBuffer?.cachedBody ?? "";
    const delta = nextValue.length - previousBody.length;
    const isCleanToDirty = nextValue !== previousBody && !previousBuffer?.dirty;
    const updatedAt = new Date().toISOString();
    setEditorGroups((groups) =>
      groups.map((group) =>
        group.id === groupId && group.previewTabId === documentId
          ? { ...group, previewTabId: null }
          : group
      )
    );

    if (isCleanToDirty) {
      logFileActivity(
        "Document changed from clean to dirty.",
        activeFile,
        {
          groupId,
          previousLength: previousBody.length,
          nextLength: nextValue.length,
          deltaChars: delta
        }
      );
    }

    setBufferMap((previous) =>
      applyBufferPolicy({
        ...previous,
        [documentId]: {
          ...(previous[documentId] ?? createBufferFromBody(activeFile, nextValue)),
          documentId,
          workspaceId: activeFile.workspaceId,
          cachedBody: nextValue,
          dirty: true,
          lineEnding: detectLineEnding(nextValue),
          lastAccessedAt: Date.now(),
          persistedLocal: true
        }
      }, [], "document-edit")
    );
    setFileMap((previous) => ({
      ...previous,
      [documentId]: {
        ...previous[documentId],
        size: nextValue.length,
        modifiedAt: updatedAt
      }
    }));
  }

  function handleSplitRight(sourceGroupId: string, documentId?: string) {
    const source = editorGroups.find((group) => group.id === sourceGroupId);
    const seedDocId = documentId ?? source?.activeTabId ?? null;
    const newGroup: EditorGroupState = {
      id: createGroupId(),
      openTabs: seedDocId ? [seedDocId] : [],
      activeTabId: seedDocId,
      previewTabId: null
    };
    setEditorGroups((groups) => {
      const index = groups.findIndex((group) => group.id === sourceGroupId);
      if (index === -1) return [...groups, newGroup];
      return [...groups.slice(0, index + 1), newGroup, ...groups.slice(index + 1)];
    });
    setGroupSizes((sizes) => {
      const index = editorGroups.findIndex((group) => group.id === sourceGroupId);
      if (index === -1 || sizes.length === 0) return distributeEqualSizes(editorGroups.length + 1);
      const sourceSize = sizes[index] ?? 100 / sizes.length;
      const half = sourceSize / 2;
      return [...sizes.slice(0, index), half, half, ...sizes.slice(index + 1)];
    });
    setActiveGroupId(newGroup.id);
  }

  function handleFocusGroup(groupId: string) {
    setActiveGroupId(groupId);
  }

  function replaceAllGroupsWithSingle(openTabs: string[], activeTabId: string | null) {
    const group: EditorGroupState = {
      id: createGroupId(),
      openTabs,
      activeTabId,
      previewTabId: null
    };
    setEditorGroups([group]);
    setActiveGroupId(group.id);
    setGroupSizes([100]);
  }

  function filterGroupsByDocumentPredicate(predicate: (documentId: string) => boolean) {
    const removedOpenTabs = new Set<string>();
    for (const group of editorGroupsRef.current) {
      for (const documentId of group.openTabs) {
        if (!predicate(documentId)) {
          removedOpenTabs.add(documentId);
        }
      }
    }

    for (const documentId of removedOpenTabs) {
      const file = fileMapRef.current[documentId];
      logTabActivity("Closed tab.", file, { reason: "document-filtered" });
    }

    setEditorGroups((groups) => {
      const next = groups.map((group) => {
        const openTabs = group.openTabs.filter(predicate);
        const activeTabId =
          group.activeTabId && predicate(group.activeTabId) ? group.activeTabId : openTabs.at(-1) ?? null;
        const previewTabId =
          group.previewTabId && predicate(group.previewTabId) ? group.previewTabId : null;
        return { ...group, openTabs, activeTabId, previewTabId };
      });
      if (next.length <= 1) return next;
      const pruned = next.filter((group) => group.openTabs.length > 0);
      return pruned.length > 0 ? pruned : [next[0]];
    });
    setGroupSizes((sizes) => {
      if (sizes.length <= 1) return sizes;
      return sizes;
    });
  }

  function addTabToActiveGroup(documentId: string, makeActive = false, options: { promote?: boolean; focus?: boolean } = {}) {
    const targetGroupId = activeGroupId;
    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== targetGroupId) return group;
        const nextTabs = group.openTabs.includes(documentId) ? group.openTabs : [...group.openTabs, documentId];
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: makeActive ? documentId : group.activeTabId,
          previewTabId: options.promote && group.previewTabId === documentId ? null : group.previewTabId
        };
      })
    );
    const file = fileMapRef.current[documentId];
    if (file && !file.isPdf) {
      void ensureBuffer(documentId, makeActive ? "add-tab-active" : "add-tab-background");
      if (options.focus) {
        requestEditorFocus(targetGroupId, documentId);
      }
    }
  }

  function handleTabDragStart(fromGroupId: string, documentId: string) {
    setTabDrag({ fromGroupId, documentId, overGroupId: null, overTabId: null, before: true });
  }

  function handleTabDragOver(overGroupId: string, overTabId: string | null, before: boolean) {
    setTabDrag((current) =>
      current &&
      (current.overGroupId !== overGroupId || current.overTabId !== overTabId || current.before !== before)
        ? { ...current, overGroupId, overTabId, before }
        : current
    );
  }

  function handleTabDragEnd() {
    setTabDrag(null);
  }

  function handleTabDrop(toGroupId: string, anchorTabId: string | null, before: boolean) {
    if (!tabDrag) return;
    const { fromGroupId, documentId } = tabDrag;
    setTabDrag(null);

    if (fromGroupId === toGroupId) {
      if (anchorTabId && anchorTabId !== documentId) {
        handleReorderTabs(fromGroupId, documentId, anchorTabId, before);
      }
      return;
    }

    handleMoveTabToGroup(fromGroupId, documentId, toGroupId, anchorTabId, before);
  }

  function handleMoveTabToGroup(
    fromGroupId: string,
    documentId: string,
    toGroupId: string,
    anchorTabId: string | null,
    before: boolean
  ) {
    let removedGroupIndex = -1;
    setEditorGroups((groups) => {
      const next = groups.map((group) => {
        if (group.id === fromGroupId) {
          const openTabs = group.openTabs.filter((id) => id !== documentId);
          let activeTabId = group.activeTabId;
          if (activeTabId === documentId) {
            activeTabId = openTabs.at(-1) ?? null;
          }
          return {
            ...group,
            openTabs,
            activeTabId,
            previewTabId: group.previewTabId === documentId ? null : group.previewTabId
          };
        }
        if (group.id === toGroupId) {
          const without = group.openTabs.filter((id) => id !== documentId);
          let insertIndex = without.length;
          if (anchorTabId) {
            const anchorIndex = without.indexOf(anchorTabId);
            if (anchorIndex !== -1) {
              insertIndex = before ? anchorIndex : anchorIndex + 1;
            }
          }
          const openTabs = [...without.slice(0, insertIndex), documentId, ...without.slice(insertIndex)];
          return {
            ...group,
            openTabs,
            activeTabId: documentId,
            previewTabId: group.previewTabId === documentId ? null : group.previewTabId
          };
        }
        return group;
      });

      if (next.length > 1) {
        const emptyIndex = next.findIndex((group) => group.id === fromGroupId && group.openTabs.length === 0);
        if (emptyIndex !== -1) {
          removedGroupIndex = emptyIndex;
          return next.filter((_, index) => index !== emptyIndex);
        }
      }
      return next;
    });

    setActiveGroupId(toGroupId);

    if (removedGroupIndex !== -1) {
      setGroupSizes((sizes) => {
        if (sizes.length <= 1) return sizes;
        const removed = sizes[removedGroupIndex] ?? 0;
        const remaining = sizes.filter((_, index) => index !== removedGroupIndex);
        if (remaining.length === 0) return sizes;
        const share = removed / remaining.length;
        return remaining.map((size) => size + share);
      });
    }
  }

  function handleResizeGroups(index: number, clientX: number, containerRect: DOMRect) {
    if (containerRect.width <= 0) return;
    setGroupSizes((sizes) => {
      if (index < 0 || index >= sizes.length - 1) return sizes;
      const relative = ((clientX - containerRect.left) / containerRect.width) * 100;
      const leftEdge = sizes.slice(0, index).reduce((sum, value) => sum + value, 0);
      const pair = sizes[index] + sizes[index + 1];
      let leftShare = relative - leftEdge;
      leftShare = Math.max(MIN_GROUP_PCT, Math.min(pair - MIN_GROUP_PCT, leftShare));
      const next = sizes.slice();
      next[index] = leftShare;
      next[index + 1] = pair - leftShare;
      return next;
    });
  }

  function handleCursorChange(snapshot: { line: number; column: number; scrollTop: number }) {
    if (!activeDocument) {
      return;
    }

    const documentId = activeDocument.id;
    setCursorState((previous) => {
      const current = previous[documentId];
      if (
        current &&
        current.line === snapshot.line &&
        current.column === snapshot.column &&
        current.scrollTop === snapshot.scrollTop
      ) {
        return previous;
      }
      return { ...previous, [documentId]: snapshot };
    });
  }

  async function readWorkspaceDocumentBody(
    document: Pick<WorkspaceFileRecord, "id" | "path" | "absolutePath" | "name" | "workspaceId">,
    reason = "workspace-read"
  ) {
    if (workspace.id === sampleRoot.id) {
      const body = readSampleWorkspaceText(document.path);
      logFileActivity("Read file from workspace.", document, {
        reason,
        source: "sample",
        contentLength: body.length
      });
      return body;
    }

    const body = await providerRegistry.local.readText(document);
    logFileActivity("Read file from workspace.", document, {
      reason,
      source: window.electronAPI ? "disk" : "browser-handle",
      contentLength: body.length
    });
    return body;
  }

  async function readWorkspaceDocumentBlob(
    document: Pick<WorkspaceFileRecord, "id" | "path" | "absolutePath" | "name" | "workspaceId">,
    mimeType = "application/octet-stream",
    reason = "workspace-read-blob"
  ): Promise<Blob> {
    const blob = await providerRegistry.local.readBlob(document, mimeType);
    logFileActivity("Read binary file from workspace.", document, {
      reason,
      mimeType,
      blobSize: blob.size,
      source: window.electronAPI ? "disk" : "browser-handle"
    });
    return blob;
  }

  async function getWorkspaceDocumentSnapshot(document: Pick<WorkspaceFileRecord, "path" | "absolutePath">) {
    return providerRegistry.local.getSnapshot(document);
  }

  async function queueDiskConflict(
    file: WorkspaceFileRecord,
    snapshot?: WorkspaceFileSnapshot | null,
    localBodyOverride?: string
  ) {
    const latestSnapshot = snapshot ?? (await getWorkspaceDocumentSnapshot(file));
    let remoteBody = "";

    if (latestSnapshot) {
      try {
        remoteBody = await readWorkspaceDocumentBody({
          id: file.id,
          name: file.name,
          path: file.path,
          absolutePath: latestSnapshot.absolutePath ?? file.absolutePath,
          workspaceId: file.workspaceId
        }, "disk-conflict-read");
      } catch {
        remoteBody = "";
      }
    }

    setFileMap((previous) => ({
      ...previous,
      [file.id]: {
        ...previous[file.id],
        conflictState: "disk-changed",
        unavailable: !latestSnapshot
      }
    }));
    setDiskConflict({
      documentId: file.id,
      remoteBody,
      deleted: !latestSnapshot,
      snapshot: latestSnapshot ?? null
    });
    if (typeof localBodyOverride === "string" && !bufferMapRef.current[file.id]) {
      setBufferMap((previous) =>
        applyBufferPolicy({
          ...previous,
          [file.id]: createBufferFromBody(file, localBodyOverride, {
            dirty: true,
            persistedLocal: true
          })
        }, [], "disk-conflict-buffer")
      );
    }
  }

  async function writeWorkspaceDocument(document: WorkspaceFileRecord, content: string) {
    return providerRegistry.local.writeText(document, content);
  }

  function getDocumentIdForPath(path: string) {
    return window.electronAPI ? `local:${path}` : `${workspace.id}:${path}`;
  }

  function getAbsolutePathForRelativePath(path: string) {
    return workspace.rootPath ? `${workspace.rootPath}/${path}`.replaceAll("\\", "/") : undefined;
  }

  function getEntryOperation(node: FileTreeNode): WorkspaceEntryOperation {
    return {
      kind: node.kind,
      path: node.path,
      absolutePath: node.absolutePath ?? getAbsolutePathForRelativePath(node.path)
    };
  }

  function getEntryOperationForPath(path: string, kind: "file" | "directory"): WorkspaceEntryOperation {
    return {
      kind,
      path,
      absolutePath: getAbsolutePathForRelativePath(path)
    };
  }

  function getExistingEntryPaths() {
    const paths = new Set(Object.values(fileMapRef.current).map((file) => file.path));
    for (const directoryPath of collectDirectoryPaths(tree)) {
      paths.add(directoryPath);
    }
    return paths;
  }

  function getUniquePath(parentPath: string | null, desiredName: string) {
    const existingPaths = getExistingEntryPaths();
    let candidateName = desiredName;
    let candidatePath = joinWorkspacePath(parentPath, candidateName);
    let index = 2;

    while (existingPaths.has(candidatePath)) {
      candidateName = index === 2 ? getCopiedName(desiredName) : getCopyNumberedName(desiredName, index);
      candidatePath = joinWorkspacePath(parentPath, candidateName);
      index += 1;
    }

    return candidatePath;
  }

  function createFileRecordFromPath(path: string, writeResult: { modifiedAt: string; size: number }): WorkspaceFileRecord {
    const metadata = getLanguageMetadata(path);
    const pdf = path.toLowerCase().endsWith(".pdf");
    return normalizeFile({
      id: getDocumentIdForPath(path),
      workspaceId: workspace.id,
      path,
      name: getPathName(path),
      provider: workspace.provider,
      language: pdf ? "PDF" : metadata.label,
      size: writeResult.size,
      modifiedAt: writeResult.modifiedAt,
      lastSyncedModifiedAt: writeResult.modifiedAt,
      lastSyncedSize: writeResult.size,
      foreignDrafts: [],
      pendingForeignDraftCount: 0,
      absolutePath: getAbsolutePathForRelativePath(path),
      isMarkdown: !pdf && Boolean(metadata.markdown ?? isMarkdownPath(path)),
      isPdf: pdf,
      unavailable: false
    });
  }

  function rebuildTreeFromFileMap(nextFileMap: Record<string, WorkspaceFileRecord>, preservedDirectories: string[] = []) {
    let nextTree = buildTreeFromFiles(workspace, Object.values(nextFileMap));
    for (const directoryPath of preservedDirectories) {
      nextTree = upsertDirectoryNode(nextTree, workspace, directoryPath);
    }
    return nextTree;
  }

  function updateGroupsForDocumentIdMap(idMap: Map<string, string>) {
    if (idMap.size === 0) {
      return;
    }

    const mapDocumentId = (documentId: string) => idMap.get(documentId) ?? documentId;
      setSelectedTreeEntryId((entryId) => (entryId ? mapDocumentId(entryId) : null));
    setEditorGroups((groups) =>
      groups.map((group) => {
        const openTabs = group.openTabs.map(mapDocumentId);
        return {
          ...group,
          openTabs,
          activeTabId: group.activeTabId ? mapDocumentId(group.activeTabId) : null,
          previewTabId: group.previewTabId ? mapDocumentId(group.previewTabId) : null
        };
      })
    );
    setCursorState((previous) => {
      const next: typeof previous = {};
      for (const [documentId, snapshot] of Object.entries(previous)) {
        next[mapDocumentId(documentId)] = snapshot;
      }
      return next;
    });
    setPdfBlobEntries((previous) => {
      const next: typeof previous = {};
      for (const [documentId, entry] of Object.entries(previous)) {
        next[mapDocumentId(documentId)] = entry;
      }
      return next;
    });
  }

  function remapBuffersForDocumentIdMap(
    sourceBufferMap: Record<string, DocumentBuffer>,
    idMap: Map<string, string>
  ) {
    if (idMap.size === 0) {
      return sourceBufferMap;
    }

    const nextBufferMap: Record<string, DocumentBuffer> = {};
    for (const [documentId, buffer] of Object.entries(sourceBufferMap)) {
      const nextDocumentId = idMap.get(documentId) ?? documentId;
      nextBufferMap[nextDocumentId] = {
        ...buffer,
        documentId: nextDocumentId
      };
    }
    return nextBufferMap;
  }

  function createConflictCopyDocument(original: WorkspaceFileRecord, suffix: string, body: string) {
    const copyNameParts = original.name.split(".");
    const extension = copyNameParts.length > 1 ? `.${copyNameParts.pop()}` : "";
    const baseName = extension ? original.name.slice(0, -extension.length) : original.name;
    const copyPath = `${baseName}.${suffix}${extension}`;
    const now = new Date().toISOString();
    const copyFile: WorkspaceFileRecord = normalizeFile({
      ...original,
      id: `copy:${crypto.randomUUID()}`,
      workspaceId: workspace.id,
      path: copyPath,
      name: copyPath.split("/").at(-1) ?? copyPath,
      size: body.length,
      modifiedAt: now,
      lastSyncedModifiedAt: now,
      lastSyncedSize: body.length,
      conflictState: undefined,
      foreignDrafts: [],
      pendingForeignDraftCount: 0,
      unavailable: false
    });

    return {
      file: copyFile,
      buffer: createBufferFromBody(copyFile, body, {
        dirty: true,
        persistedLocal: true
      })
    };
  }

  /**
   * Writes a resolution record that clears active dirty drafts for a saved document.
   *
   * @param file - The document file that was successfully saved.
   * @param body - The saved document body.
   * @param latestManifest - The latest manifest containing active draft refs.
   * @param target - The bundle location where the resolution record should be written.
   * @returns The created resolution record, or undefined when there were no drafts to clear.
   */
  async function clearAllDeviceDraftsForSavedDocument(
    file: WorkspaceFileRecord,
    body: string,
    latestManifest: WorkspaceManifest | undefined,
    target: WorkspaceBundleLink | null
  ) {
    if (!latestManifest || !target) {
      return undefined;
    }

    const draftRefsToClear = latestManifest.draftRefs.filter((draft) => draft.path === file.path && !draft.deleted);
    if (draftRefsToClear.length === 0) {
      return undefined;
    }

    const resolutionRecord = createDraftResolutionRecord({
      documentPath: file.path,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
      clearedDraftRevisionIds: draftRefsToClear.map((draft) => draft.revisionId),
      finalBody: body
    });

    await writeBundleJson(
      resolutionRecord.blobPath,
      createDraftResolutionPayload(resolutionRecord, body),
      target
    );

    return resolutionRecord;
  }

  /**
   * Saves a document by id while enforcing remote-draft merge requirements.
   *
   * @param documentId - The document id to save.
   * @param options - Save behavior for merge checks and draft cleanup.
   * @returns "saved" when the write completed, otherwise "blocked".
   */
  async function saveDocumentById(
    documentId: string,
    options: { requireMergedDrafts?: boolean; clearAllDeviceDrafts?: boolean } = {}
  ): Promise<SaveDocumentResult> {
    const file = fileMapRef.current[documentId];
    if (!file || file.isPdf) {
      if (file?.isPdf) {
        setStatusMessage("PDF files are preview-only and cannot be saved.");
      }
      return "blocked";
    }

    if (draftMergeState?.documentId === documentId) {
      setStatusMessage("Finish or skip the remote draft review before saving this file.");
      return "blocked";
    }

    const loadedBuffer = bufferMapRef.current[documentId] ?? (await ensureBuffer(documentId, "save-document"));
    if (!loadedBuffer) {
      setStatusMessage(`Unable to load ${file.name}.`);
      return "blocked";
    }

    if (workspace.id === sampleRoot.id) {
      const nextFileMap = {
        ...fileMapRef.current,
        [file.id]: {
          ...fileMapRef.current[file.id],
          lastSyncedModifiedAt: fileMapRef.current[file.id].modifiedAt,
          lastSyncedSize: fileMapRef.current[file.id].size
        }
      };
      const nextBufferMap = {
        ...bufferMapRef.current,
        [file.id]: {
          ...loadedBuffer,
          dirty: false,
          persistedLocal: false
        }
      };

      fileMapRef.current = nextFileMap;
      bufferMapRef.current = nextBufferMap;
      setStatusMessage("The sample workspace is editable, but not written to disk.");
      setFileMap(nextFileMap);
      setBufferMap(applyBufferPolicy(nextBufferMap, [], "sample-save"));
      return "saved";
    }

    try {
      let targetFile = file;
      let targetBuffer = loadedBuffer;
      let latestManifest: WorkspaceManifest | undefined;
      const targetBundle = bundleLink;

      if (bundleRuntimeReady) {
        latestManifest = await readManifestFromBundle(targetBundle);
        if (latestManifest) {
          setManifest(latestManifest);
          const syncedState = await syncDocumentBundleState(latestManifest, targetBundle, fileMapRef.current, {
            ...bufferMapRef.current,
            [documentId]: loadedBuffer
          });
          targetFile = syncedState.fileMap[documentId] ?? targetFile;
          targetBuffer = syncedState.bufferMap[documentId] ?? targetBuffer;
        }
      }

      if (options.requireMergedDrafts && targetFile.pendingForeignDraftCount > 0) {
        setStatusMessage(`Merge remote drafts for ${targetFile.name} before saving.`);
        if (bundleRuntimeReady) {
          await startDraftMergeForFile(targetFile);
        }
        return "blocked";
      }

      const latestSnapshot = await getWorkspaceDocumentSnapshot(targetFile);

      if (
        !latestSnapshot ||
        latestSnapshot.modifiedAt !== targetFile.lastSyncedModifiedAt ||
        latestSnapshot.size !== targetFile.lastSyncedSize
      ) {
        await queueDiskConflict(targetFile, latestSnapshot, targetBuffer.cachedBody);
        return "blocked";
      }

      const writeResult = await writeWorkspaceDocument(targetFile, targetBuffer.cachedBody);

      if (!writeResult) {
        throw new Error("This workspace is not writable in the current runtime.");
      }

      const resolutionRecord =
        options.clearAllDeviceDrafts && bundleRuntimeReady
          ? await clearAllDeviceDraftsForSavedDocument(targetFile, targetBuffer.cachedBody, latestManifest, targetBundle)
          : undefined;
      const nextFileMap = {
        ...fileMapRef.current,
        [targetFile.id]: {
          ...fileMapRef.current[targetFile.id],
          modifiedAt: writeResult.modifiedAt,
          lastSyncedModifiedAt: writeResult.modifiedAt,
          size: writeResult.size,
          lastSyncedSize: writeResult.size,
          conflictState: undefined,
          foreignDrafts: [],
          pendingForeignDraftCount: 0,
          unavailable: false,
          lastAppliedResolutionRevisionId:
            resolutionRecord?.revisionId ?? fileMapRef.current[targetFile.id].lastAppliedResolutionRevisionId
        }
      };
      const nextBufferMap = {
        ...bufferMapRef.current,
        [targetFile.id]: {
          ...(bufferMapRef.current[targetFile.id] ?? targetBuffer),
          cachedBody: targetBuffer.cachedBody,
          dirty: false,
          lastAccessedAt: Date.now(),
          persistedLocal: false
        }
      };

      fileMapRef.current = nextFileMap;
      bufferMapRef.current = nextBufferMap;
      setFileMap(nextFileMap);
      setBufferMap(applyBufferPolicy(nextBufferMap, [], "save-write"));

      if (bundleRuntimeReady) {
        await saveWorkspaceSession(`Saved ${targetFile.name}`, {
          fileMapOverride: nextFileMap,
          bufferMapOverride: nextBufferMap
        });
      } else {
        setStatusMessage(`Saved ${targetFile.name}`);
      }

      return "saved";
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save the current file.");
      return "blocked";
    }
  }

  /**
   * Saves the active editor document.
   *
   * @returns A promise that settles after the active save attempt completes.
   */
  async function handleSaveActiveDocument() {
    if (!activeFile) {
      return;
    }

    await saveDocumentById(activeFile.id, {
      requireMergedDrafts: true,
      clearAllDeviceDrafts: true
    });
  }

  async function pollWorkspaceChanges(trigger = "auto") {
    if (workspace.id === sampleRoot.id || workspacePollInFlightRef.current) {
      return false;
    }

    if (!window.electronAPI && !browserWorkspaceDirectoryHandleRef.current) {
      return false;
    }

    workspacePollInFlightRef.current = true;
    const startedAt = performance.now();
    let didChange = false;
    let snapshotCount = 0;
    let retriedAccessRestore = false;
    logAppActivity("scan", "Workspace poll started.", {
      runtime: getRuntimeLabel(),
      workspaceId: workspace.id,
      displayName: workspace.displayName,
      trigger
    });

    try {
      const skippedFolders = workspace.skippedFolders ?? [];
      let snapshots = await providerRegistry.local.scanWorkspace(workspace.rootPath, skippedFolders);
      const workspaceFiles = Object.values(fileMapRef.current).filter((file) => !file.id.startsWith("copy:"));

      if (
        window.electronAPI &&
        workspace.rootPath &&
        snapshots.length === 0 &&
        workspaceFiles.length > 0 &&
        (await window.electronAPI.restoreWorkspaceAccess(workspace.rootPath))
      ) {
        retriedAccessRestore = true;
        snapshots = await providerRegistry.local.scanWorkspace(workspace.rootPath, skippedFolders);
      }
      snapshotCount = snapshots.length;

      const fileSnapshots = snapshots.filter((snapshot) => snapshot.kind !== "directory");
      const nextTree = buildTreeFromSnapshots(workspace, snapshots);
      const directoryChanged = !areSetsEqual(collectDirectoryPaths(tree), collectDirectoryPaths(nextTree));
      const snapshotByPath = new Map(fileSnapshots.map((snapshot) => [snapshot.path, snapshot]));
      const visibleFileIds = new Set(editorGroupsRef.current.map((group) => group.activeTabId).filter((value): value is string => Boolean(value)));
      const currentByPath = new Map(workspaceFiles.map((file) => [file.path, file]));
      const nextFileMap: Record<string, WorkspaceFileRecord> = { ...fileMapRef.current };
      const nextBufferMap: Record<string, DocumentBuffer> = { ...bufferMapRef.current };
      const addedPaths: string[] = [];
      const updatedPaths: string[] = [];
      const removedPaths: string[] = [];
      const conflictPaths: string[] = [];
      for (const file of workspaceFiles) {
        const snapshot = snapshotByPath.get(file.path);
        const buffer = nextBufferMap[file.id];

        if (!snapshot) {
          removedPaths.push(file.path);
          if (buffer?.dirty) {
            nextFileMap[file.id] = {
              ...file,
              conflictState: "disk-changed",
              unavailable: true
            };
            conflictPaths.push(file.path);
            if (!diskConflict || diskConflict.documentId !== file.id) {
              await queueDiskConflict(file, null, buffer.cachedBody);
            }
          } else {
            delete nextFileMap[file.id];
            delete nextBufferMap[file.id];
            if (buffer) {
              logBufferActivity("Removed buffer from memory cache.", file, { reason: "workspace-file-removed" });
            }
          }

          didChange = true;
          continue;
        }

        if (
          snapshot.modifiedAt === file.lastSyncedModifiedAt &&
          snapshot.size === file.lastSyncedSize &&
          !file.unavailable
        ) {
          continue;
        }

        if (buffer?.dirty) {
          nextFileMap[file.id] = {
            ...file,
            conflictState: "disk-changed",
            unavailable: false
          };
          conflictPaths.push(file.path);
          if (!diskConflict || diskConflict.documentId !== file.id) {
            await queueDiskConflict(file, snapshot, buffer.cachedBody);
          }
          didChange = true;
          continue;
        }

        nextFileMap[file.id] = {
          ...file,
          size: snapshot.size,
          modifiedAt: snapshot.modifiedAt,
          lastSyncedModifiedAt: snapshot.modifiedAt,
          lastSyncedSize: snapshot.size,
          absolutePath: snapshot.absolutePath ?? file.absolutePath,
          conflictState: undefined,
          unavailable: false
        };
        updatedPaths.push(file.path);

        if (visibleFileIds.has(file.id) && !file.isPdf) {
          try {
            const body = await readWorkspaceDocumentBody(nextFileMap[file.id], "workspace-poll-refresh");
            nextBufferMap[file.id] = createBufferFromBody(nextFileMap[file.id], body);
          } catch {
            // Keep metadata fresh even if the body cannot be reloaded yet.
          }
        } else if (buffer && !buffer.dirty) {
          delete nextBufferMap[file.id];
          logBufferActivity("Removed buffer from memory cache.", file, { reason: "workspace-poll-refresh" });
        }

        didChange = true;
      }

      for (const snapshot of fileSnapshots) {
        if (currentByPath.has(snapshot.path)) {
          continue;
        }

        const metadata = getLanguageMetadata(snapshot.path);
        const pdf = snapshot.path.toLowerCase().endsWith(".pdf");
        const nextId = window.electronAPI ? `local:${snapshot.path}` : `${workspace.id}:${snapshot.path}`;
        nextFileMap[nextId] = normalizeFile({
          id: nextId,
          workspaceId: workspace.id,
          path: snapshot.path,
          name: snapshot.path.split("/").at(-1) ?? snapshot.path,
          provider: workspace.provider,
          language: pdf ? "PDF" : metadata.label,
          size: snapshot.size,
          modifiedAt: snapshot.modifiedAt,
          lastSyncedModifiedAt: snapshot.modifiedAt,
          lastSyncedSize: snapshot.size,
          foreignDrafts: [],
          pendingForeignDraftCount: 0,
          absolutePath: snapshot.absolutePath,
          isMarkdown: !pdf && Boolean(metadata.markdown ?? isMarkdownPath(snapshot.path)),
          isPdf: pdf,
          unavailable: false
        });
        addedPaths.push(snapshot.path);
        didChange = true;
      }

      if (directoryChanged) {
        didChange = true;
      }

      if (!didChange) {
        return false;
      }

      logAppActivity("scan", "Workspace change summary.", {
        runtime: window.electronAPI ? "desktop" : "web",
        workspaceId: workspace.id,
        displayName: workspace.displayName,
        skippedFolders,
        addedCount: addedPaths.length,
        updatedCount: updatedPaths.length,
        removedCount: removedPaths.length,
        conflictCount: conflictPaths.length,
        addedPaths: addedPaths.slice(0, 5),
        updatedPaths: updatedPaths.slice(0, 5),
        removedPaths: removedPaths.slice(0, 5),
        conflictPaths: conflictPaths.slice(0, 5)
      });

      setFileMap(nextFileMap);
      setBufferMap(applyBufferPolicy(nextBufferMap));
      setTree(nextTree);
      filterGroupsByDocumentPredicate((documentId) => Boolean(nextFileMap[documentId]));
      setStatusMessage(`Detected workspace changes in ${workspace.displayName}.`);
      return true;
    } finally {
      workspacePollInFlightRef.current = false;
      logAppActivity("scan", "Workspace poll finished.", {
        runtime: getRuntimeLabel(),
        workspaceId: workspace.id,
        displayName: workspace.displayName,
        trigger,
        changed: didChange,
        snapshotCount,
        retriedAccessRestore,
        durationMs: Math.round(performance.now() - startedAt)
      });
    }
  }

  async function reopenBrowserBundleAccess(target: WorkspaceBundleLink) {
    const selection = await openBrowserBundleDirectory();

    if (!selection) {
      return null;
    }

    browserBundleDirectoryHandleRef.current = selection.directoryHandle;
    browserBundleFileHandlesRef.current = selection.fileHandles;
    const nextBundleLink: WorkspaceBundleLink = {
      ...target,
      name: selection.name
    };
    setBundleLink(nextBundleLink);
    return nextBundleLink;
  }

  async function chooseBundleLocation(existingReference?: WorkspaceReference) {
    if (workspace.id === sampleRoot.id) {
      setStatusMessage("The sample workspace cannot be saved as a workspace bundle.");
      return null;
    }

    if (window.electronAPI) {
      const selection = await window.electronAPI.createBundleDirectory(createBundleDirectoryName(workspace.displayName));

      if (!selection) {
        return null;
      }

      clearBundleAccess();
      const workspaceRef = await buildWorkspaceReferenceForRoot(
        workspace,
        selection.path,
        existingReference ?? bundleLink?.workspaceRef
      );
      const nextBundleLink: WorkspaceBundleLink = {
        name: selection.name,
        bundlePath: selection.path,
        workspaceRef
      };

      setBundleLink(nextBundleLink);
      return nextBundleLink;
    }

    const selection = await createBrowserBundleDirectory(workspace.displayName);

    if (!selection) {
      return null;
    }

    browserBundleDirectoryHandleRef.current = selection.directoryHandle;
    browserBundleFileHandlesRef.current = selection.fileHandles;
    const workspaceRef = await buildWorkspaceReferenceForRoot(
      workspace,
      undefined,
      existingReference ?? bundleLink?.workspaceRef
    );
    const nextBundleLink: WorkspaceBundleLink = {
      name: selection.name,
      workspaceRef
    };

    setBundleLink(nextBundleLink);
    return nextBundleLink;
  }

  async function ensureBundleTarget(createBundleIfNeeded: boolean) {
    if (bundleLink) {
      if (window.electronAPI || browserBundleDirectoryHandleRef.current) {
        return bundleLink;
      }

      if (!window.electronAPI && createBundleIfNeeded) {
        return reopenBrowserBundleAccess(bundleLink);
      }
    }

    if (!createBundleIfNeeded) {
      return null;
    }

    return chooseBundleLocation();
  }

  function createRuntimeManifestFromScan(
    scanResult: BundleScanResult,
    workspaceRefOverride?: WorkspaceReference
  ) {
    if (!scanResult.bootstrap) {
      return undefined;
    }

    const bootstrap: BundleBootstrap = workspaceRefOverride
      ? {
          ...scanResult.bootstrap,
          workspaceRef: workspaceRefOverride
        }
      : scanResult.bootstrap;

    return createRuntimeManifest({
      bootstrap,
      sessions: scanResult.sessions,
      drafts: scanResult.drafts,
      resolutions: scanResult.resolutions
    });
  }

  async function readBundleState(target: WorkspaceBundleLink | null = bundleLink) {
    if (!target) {
      return undefined;
    }

    try {
      if (window.electronAPI && target.bundlePath) {
        return await window.electronAPI.scanBundle(target.bundlePath);
      }

      if (browserBundleDirectoryHandleRef.current) {
        return await scanBrowserBundle({
          name: target.name,
          directoryHandle: browserBundleDirectoryHandleRef.current,
          fileHandles: browserBundleFileHandlesRef.current
        });
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  async function readManifestFromBundle(target: WorkspaceBundleLink | null = bundleLink) {
    const bundleState = await readBundleState(target);
    if (!bundleState) {
      return undefined;
    }

    return createRuntimeManifestFromScan(bundleState, target?.workspaceRef);
  }

  async function writeBundleJson(relativePath: string, payload: unknown, target: WorkspaceBundleLink) {
    if (window.electronAPI && target.bundlePath) {
      await window.electronAPI.writeJson(getBundleFsPath(target.bundlePath, relativePath), payload);
      return;
    }

    if (browserBundleDirectoryHandleRef.current) {
      await writeBrowserJson(
        browserBundleDirectoryHandleRef.current,
        browserBundleFileHandlesRef.current,
        relativePath,
        payload
      );
      return;
    }

    throw new Error("This workspace bundle is not writable in the current runtime.");
  }

  async function readDraftBlob(relativePath: string, target: WorkspaceBundleLink | null = bundleLink) {
    if (!target) {
      throw new Error("This workspace bundle is not readable in the current runtime.");
    }

    if (window.electronAPI && target.bundlePath) {
      const payload = await window.electronAPI.readJson<{ body: string }>(
        getBundleFsPath(target.bundlePath, relativePath)
      );
      return payload.body;
    }

    if (browserBundleDirectoryHandleRef.current) {
      const payload = await readBrowserJson<{ body: string }>(browserBundleDirectoryHandleRef.current, relativePath);
      return payload.body;
    }

    throw new Error("This workspace bundle is not readable in the current runtime.");
  }

  async function readResolutionBlob(relativePath: string, target: WorkspaceBundleLink | null = bundleLink) {
    if (!target) {
      throw new Error("This workspace bundle is not readable in the current runtime.");
    }

    if (window.electronAPI && target.bundlePath) {
      const payload = await window.electronAPI.readJson<{ body: string }>(
        getBundleFsPath(target.bundlePath, relativePath)
      );
      return payload.body;
    }

    if (browserBundleDirectoryHandleRef.current) {
      const payload = await readBrowserJson<{ body: string }>(browserBundleDirectoryHandleRef.current, relativePath);
      return payload.body;
    }

    throw new Error("This workspace bundle is not readable in the current runtime.");
  }

  async function syncDocumentBundleState(
    nextManifest: WorkspaceManifest,
    target: WorkspaceBundleLink | null = bundleLink,
    sourceFileMap: Record<string, WorkspaceFileRecord> = fileMapRef.current,
    sourceBufferMap: Record<string, DocumentBuffer> = bufferMapRef.current
  ) {
    const nextFileMap: Record<string, WorkspaceFileRecord> = { ...sourceFileMap };
    const nextBufferMap: Record<string, DocumentBuffer> = { ...sourceBufferMap };
    const clearedDraftRevisionIds = getClearedDraftRevisionIds(nextManifest.resolutionRefs);
    const latestResolutionByPath = getLatestResolutionByPath(nextManifest.resolutionRefs);
    const foreignDraftsByPath = new Map<string, WorkspaceFileRecord["foreignDrafts"]>();

    for (const draftRef of nextManifest.draftRefs) {
      if (draftRef.deviceId === currentDeviceId || draftRef.deleted || clearedDraftRevisionIds.has(draftRef.revisionId)) {
        continue;
      }

      const nextDraft = {
        revisionId: draftRef.revisionId,
        deviceId: draftRef.deviceId,
        deviceName: draftRef.deviceName,
        savedAt: draftRef.updatedAt,
        contentHash: draftRef.contentHash,
        blobPath: draftRef.blobPath
      };
      const previous = foreignDraftsByPath.get(draftRef.path) ?? [];
      foreignDraftsByPath.set(draftRef.path, [...previous, nextDraft].sort(sortForeignDrafts));
    }

    let didChange = false;

    for (const file of Object.values(sourceFileMap)) {
      if (file.id.startsWith("copy:")) {
        continue;
      }

      let nextFile = nextFileMap[file.id];
      const nextForeignDrafts = foreignDraftsByPath.get(file.path) ?? [];
      const latestResolution = latestResolutionByPath.get(file.path);

      if (
        !areDraftListsEqual(file.foreignDrafts, nextForeignDrafts) ||
        file.pendingForeignDraftCount !== nextForeignDrafts.length
      ) {
        nextFile = {
          ...nextFile,
          foreignDrafts: nextForeignDrafts,
          pendingForeignDraftCount: nextForeignDrafts.length,
          conflictState:
            nextFile.conflictState === "disk-changed"
              ? nextFile.conflictState
              : nextForeignDrafts.length > 0
                ? "foreign-draft-available"
                : undefined
        };
        didChange = true;
      }

      if (latestResolution && file.lastAppliedResolutionRevisionId !== latestResolution.revisionId) {
        let resolvedBody: string;

        try {
          resolvedBody = await readResolutionBlob(latestResolution.blobPath, target);
        } catch {
          nextFileMap[file.id] = nextFile;
          continue;
        }

        let writeResult: { modifiedAt: string; size: number } | null = null;

        try {
          const currentDiskBody = await readWorkspaceDocumentBody(nextFile);
          if (currentDiskBody !== resolvedBody) {
            writeResult = await writeWorkspaceDocument(nextFile, resolvedBody);
          } else {
            const snapshot = await getWorkspaceDocumentSnapshot(nextFile);
            if (snapshot) {
              writeResult = {
                modifiedAt: snapshot.modifiedAt,
                size: snapshot.size
              };
            }
          }
        } catch {
          writeResult = null;
        }

        nextFile = {
          ...nextFile,
          size: writeResult?.size ?? resolvedBody.length,
          modifiedAt: writeResult?.modifiedAt ?? latestResolution.resolvedAt,
          lastSyncedModifiedAt: writeResult?.modifiedAt ?? latestResolution.resolvedAt,
          lastSyncedSize: writeResult?.size ?? resolvedBody.length,
          conflictState: undefined,
          foreignDrafts: [],
          pendingForeignDraftCount: 0,
          unavailable: false,
          lastAppliedResolutionRevisionId: latestResolution.revisionId
        };
        nextBufferMap[file.id] = createBufferFromBody(nextFile, resolvedBody, {
          dirty: false,
          persistedLocal: false
        });
        didChange = true;
      }

      nextFileMap[file.id] = normalizeFile(nextFile);
    }

    if (didChange) {
      setFileMap(nextFileMap);
      setBufferMap(applyBufferPolicy(nextBufferMap));
      if (draftMergeState && nextFileMap[draftMergeState.documentId]?.lastAppliedResolutionRevisionId) {
        setDraftMergeState(null);
      }
    }

    return {
      fileMap: nextFileMap,
      bufferMap: nextBufferMap
    };
  }

  async function saveWorkspaceSession(successMessage = "Saved workspace bundle.", options: BundleSaveOptions = {}) {
    if (workspace.id === sampleRoot.id) {
      if (options.createBundleIfNeeded || options.bundleOverride) {
        setStatusMessage("The sample workspace cannot be saved as a workspace bundle.");
      }
      return;
    }

    try {
      const target = options.bundleOverride ?? (await ensureBundleTarget(Boolean(options.createBundleIfNeeded)));

      if (!target) {
        return;
      }

      if (window.electronAPI ? !target.bundlePath : !browserBundleDirectoryHandleRef.current) {
        throw new Error("Select a workspace bundle folder to continue.");
      }

      const workspaceRef = await buildWorkspaceReferenceForRoot(workspace, target.bundlePath, target.workspaceRef);
      const bootstrap = createBundleBootstrap({
        workspaceId: workspace.id,
        displayName: workspace.displayName,
        workspaceRef
      });
      const nextBundleLink: WorkspaceBundleLink = {
        ...target,
        workspaceRef
      };
      const sourceFileMap = options.fileMapOverride ?? fileMapRef.current;
      const sourceBufferMap = options.bufferMapOverride ?? bufferMapRef.current;
      const latestManifest = await readManifestFromBundle(nextBundleLink);
      const syncedState = latestManifest
        ? await syncDocumentBundleState(latestManifest, nextBundleLink, sourceFileMap, sourceBufferMap)
        : {
            fileMap: sourceFileMap,
            bufferMap: sourceBufferMap
          };
      const syncedDocuments = Object.values(syncedState.bufferMap)
        .map((buffer) => composeTextDocument(syncedState.fileMap[buffer.documentId], buffer))
        .filter((document): document is TextDocument => Boolean(document))
        .sort((left, right) => left.path.localeCompare(right.path));
      const session = createSessionSnapshot({
        deviceId: currentDeviceId,
        deviceName: currentDeviceName,
        workspacePath: workspace.rootPath,
        openTabs: mapFileIdsToPaths(openTabs, syncedState.fileMap),
        activeTab: mapFileIdToPath(activeTabId, syncedState.fileMap),
        editorGroups: mapEditorGroupsToPaths(editorGroups, syncedState.fileMap),
        activeGroupId,
        groupSizes,
        layout,
        sidebarState,
        searchState: {
          ...searchState,
          lastQuery: searchState.query
        },
        cursorState: mapCursorStateToPaths(cursorState, syncedState.fileMap),
        themeMode
      });
      const currentDeviceDrafts = latestManifest?.draftRefs.filter((draft) => draft.deviceId === currentDeviceId) ?? [];
      const draftRefs = buildDraftRefs(currentDeviceId, currentDeviceName, syncedDocuments);
      const dirtyPaths = new Set(syncedDocuments.filter((document) => document.dirty).map((document) => document.path));
      const clearDraftRefs = buildDraftClearRefs(currentDeviceId, currentDeviceName, currentDeviceDrafts, dirtyPaths);

      const shouldWriteBootstrap =
        !latestManifest ||
        latestManifest.workspaceId !== bootstrap.workspaceId ||
        latestManifest.displayName !== bootstrap.displayName ||
        JSON.stringify(latestManifest.workspaceRef) !== JSON.stringify(bootstrap.workspaceRef);

      if (shouldWriteBootstrap) {
        await writeBundleJson(getManifestPath(), bootstrap, nextBundleLink);
      }

      await writeBundleJson(getSessionFilePath(currentDeviceId, session.revisionId), session, nextBundleLink);
      lastSavedWorkspaceFileSessionSignatureRef.current = getWorkspaceSessionSignature(session);

      for (const draftRef of draftRefs) {
        const document = syncedDocuments.find((entry) => entry.path === draftRef.path);
        if (document) {
          await writeBundleJson(draftRef.blobPath, createDraftPayload(draftRef, document.cachedBody), nextBundleLink);
        }
      }

      for (const clearDraftRef of clearDraftRefs) {
        await writeBundleJson(clearDraftRef.blobPath, createDraftPayload(clearDraftRef, ""), nextBundleLink);
      }

      const nextManifest = await readManifestFromBundle(nextBundleLink);
      setBundleLink(nextBundleLink);
      if (nextManifest) {
        setManifest(nextManifest);
        await syncDocumentBundleState(nextManifest, nextBundleLink, syncedState.fileMap, syncedState.bufferMap);
      }
      setStatusMessage(successMessage);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save the workspace bundle.");
    }
  }

  async function pollRemoteManifest() {
    const latestManifest = await readManifestFromBundle();

    if (!latestManifest) {
      return false;
    }

    if (latestManifest.headRevision !== manifest?.headRevision || latestManifest.updatedAt !== manifest?.updatedAt) {
      setManifest(latestManifest);
      await syncDocumentBundleState(latestManifest);
      return true;
    }

    return false;
  }

  function createCurrentSessionSnapshot() {
    return createSessionSnapshot({
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
      workspacePath: workspace.rootPath,
      openTabs: mapFileIdsToPaths(openTabs, fileMap),
      activeTab: mapFileIdToPath(activeTabId, fileMap),
      editorGroups: mapEditorGroupsToPaths(editorGroups, fileMap),
      activeGroupId,
      groupSizes,
      layout,
      sidebarState,
      searchState,
      cursorState: mapCursorStateToPaths(cursorState, fileMap),
      themeMode
    });
  }

  function acknowledgeRemoteSession(revisionId: string) {
    setAcknowledgedRemoteSessionIds((previous) => {
      const next = new Set(previous);
      next.add(revisionId);
      return next;
    });
  }

  async function applySelectedRemoteSession(items?: SessionCompareItem[]) {
    if (!selectedRemoteSession) {
      return;
    }

    const selection = items ? applySessionSelections(items) : undefined;
    const documentByPath = getFileMapByPath(fileMap);
    const nextOpenTabIds = (selection?.openTabs ?? selectedRemoteSession.openTabs)
      .map((path) => documentByPath.get(path)?.id)
      .filter((documentId): documentId is string => Boolean(documentId));
    const nextActiveTabId = (() => {
      const requestedPath = selection?.activeTab ?? selectedRemoteSession.activeTab;
      if (requestedPath) {
        const targetId = documentByPath.get(requestedPath)?.id;
        if (targetId) {
          return targetId;
        }
      }

      return nextOpenTabIds[0] ?? null;
    })();

    replaceAllGroupsWithSingle(nextOpenTabIds, nextActiveTabId);
    setLayout(mergeLayout(selection?.layout ?? selectedRemoteSession.layout, defaultLayout, searchAvailable));
    setSidebarState(selection?.sidebarState ?? selectedRemoteSession.sidebarState);
    setSearchState(selection?.searchState ?? selectedRemoteSession.searchState);
    setCursorState(
      Object.fromEntries(
        Object.entries(selection?.cursorState ?? selectedRemoteSession.cursorState)
          .map(([path, snapshot]) => {
            const documentId = documentByPath.get(path)?.id;
            return documentId ? [documentId, snapshot] : null;
          })
          .filter((entry): entry is [string, { line: number; column: number; scrollTop: number }] => Boolean(entry))
      )
    );
    setThemeMode(selection?.themeMode ?? selectedRemoteSession.themeMode);
    acknowledgeRemoteSession(selectedRemoteSession.revisionId);
    setSessionCompareItems(null);
    setSelectedRemoteSessionRevisionId(null);
    setSessionPickerOpen(
      pendingRemoteSessions.some((session) => session.revisionId !== selectedRemoteSession.revisionId)
    );
    setStatusMessage(`Applied session from ${selectedRemoteSession.deviceName}.`);
  }

  function handleOpenSessionPicker() {
    if (pendingRemoteSessions.length === 0) {
      setStatusMessage("No pending remote sessions.");
      return;
    }

    setSelectedRemoteSessionRevisionId((previous) => previous ?? pendingRemoteSessions[0].revisionId);
    setSessionPickerOpen(true);
  }

  async function handleResumeRemote() {
    await applySelectedRemoteSession();
  }

  function handleCompareSessions() {
    if (!selectedRemoteSession) {
      return;
    }

    setSessionCompareItems(
      buildSessionCompareItems(
        createCurrentSessionSnapshot(),
        selectedRemoteSession,
        themeMode,
        selectedRemoteSession.themeMode
      )
    );
  }

  function handleDismissRemoteSession() {
    if (!selectedRemoteSession) {
      return;
    }

    acknowledgeRemoteSession(selectedRemoteSession.revisionId);
    setSelectedRemoteSessionRevisionId(null);
    setSessionPickerOpen(
      pendingRemoteSessions.some((session) => session.revisionId !== selectedRemoteSession.revisionId)
    );
    setStatusMessage(`Dismissed session from ${selectedRemoteSession.deviceName}.`);
  }

  async function handleApplyCompareSelections() {
    if (!sessionCompareItems) {
      return;
    }

    await applySelectedRemoteSession(sessionCompareItems);
  }

  function handleUseDraftAsBase() {
    if (!activeDraftMerge || !activeDraftMergeEntry) {
      return;
    }

    const file = fileMap[activeDraftMerge.documentId];
    if (!file) {
      return;
    }

    const updatedAt = new Date().toISOString();
    setBufferMap((previous) =>
      applyBufferPolicy({
        ...previous,
        [activeDraftMerge.documentId]: createBufferFromBody(file, activeDraftMergeEntry.body, {
          dirty: true,
          persistedLocal: true
        })
      })
    );
    setFileMap((previous) => ({
      ...previous,
      [activeDraftMerge.documentId]: {
        ...previous[activeDraftMerge.documentId],
        size: activeDraftMergeEntry.body.length,
        modifiedAt: updatedAt
      }
    }));
    setStatusMessage(`Using ${activeDraftMergeEntry.deviceName}'s draft as the working base.`);
  }

  function handleSaveDraftCopy() {
    if (!activeDraftMerge || !activeDraftMergeEntry) {
      return;
    }

    const original = fileMap[activeDraftMerge.documentId];
    if (!original) {
      return;
    }

    const copyDocument = createConflictCopyDocument(original, "remote-draft", activeDraftMergeEntry.body);
    setFileMap((previous) => ({
      ...previous,
      [copyDocument.file.id]: copyDocument.file
    }));
    setBufferMap((previous) =>
      applyBufferPolicy({
        ...previous,
        [copyDocument.file.id]: copyDocument.buffer
      })
    );
    addTabToActiveGroup(copyDocument.file.id);
    setStatusMessage(`Opened a copy of ${activeDraftMergeEntry.deviceName}'s draft for ${original.name}.`);
  }

  async function finalizeDraftMerge(mergeState: DraftMergeState) {
    const originalFile = fileMap[mergeState.documentId];
    let originalBuffer: DocumentBuffer | null = bufferMap[mergeState.documentId] ?? null;

    if (!originalFile) {
      setDraftMergeState(null);
      return;
    }

    if (!originalBuffer) {
      originalBuffer = await ensureBuffer(mergeState.documentId);
    }

    if (!originalBuffer) {
      setDraftMergeState(null);
      return;
    }

    const ensuredOriginalBuffer: DocumentBuffer = originalBuffer;

    if (!bundleRuntimeReady || !bundleLink) {
      throw new Error("Reconnect the workspace bundle before resolving drafts.");
    }

    const latestManifest = await readManifestFromBundle();
    let currentFile = originalFile;
    let currentBuffer: DocumentBuffer = ensuredOriginalBuffer;

    if (latestManifest) {
      setManifest(latestManifest);
      const syncedState = await syncDocumentBundleState(latestManifest);
      currentFile = syncedState.fileMap[mergeState.documentId] ?? currentFile;
      currentBuffer = syncedState.bufferMap[mergeState.documentId] ?? currentBuffer;
      if (currentFile.lastAppliedResolutionRevisionId) {
        setDraftMergeState(null);
        setStatusMessage(`Adopted the latest resolved result for ${currentFile.name}.`);
        return;
      }
    }

    const finalBody = currentBuffer.cachedBody;
    const writeResult = await writeWorkspaceDocument(currentFile, finalBody);
    const resolutionRecord = createDraftResolutionRecord({
      documentPath: currentFile.path,
      deviceId: currentDeviceId,
      deviceName: currentDeviceName,
      clearedDraftRevisionIds: mergeState.entries.map((entry) => entry.revisionId),
      finalBody
    });

    await writeBundleJson(
      resolutionRecord.blobPath,
      createDraftResolutionPayload(resolutionRecord, finalBody),
      bundleLink
    );

    const resolvedFileMap = {
      ...fileMapRef.current,
      [currentFile.id]: {
        ...currentFile,
        size: writeResult.size,
        modifiedAt: writeResult.modifiedAt,
        lastSyncedModifiedAt: writeResult.modifiedAt,
        lastSyncedSize: writeResult.size,
        conflictState: undefined,
        foreignDrafts: [],
        pendingForeignDraftCount: 0,
        unavailable: false,
        lastAppliedResolutionRevisionId: resolutionRecord.revisionId
      }
    };
    const resolvedBufferMap = {
      ...bufferMapRef.current,
      [currentFile.id]: createBufferFromBody(resolvedFileMap[currentFile.id], finalBody, {
        dirty: false,
        persistedLocal: false
      })
    };

    setFileMap(resolvedFileMap);
    setBufferMap(applyBufferPolicy(resolvedBufferMap));
    setDraftMergeState(null);
    await saveWorkspaceSession(
      `Resolved ${mergeState.entries.length} remote draft${mergeState.entries.length === 1 ? "" : "s"} for ${currentFile.name}.`,
      {
        fileMapOverride: resolvedFileMap,
        bufferMapOverride: resolvedBufferMap
      }
    );
  }

  async function handleNextDraft() {
    if (!draftMergeState || !activeDraftMergeEntry) {
      return;
    }

    if (draftMergeState.currentIndex < draftMergeState.entries.length - 1) {
      const nextIndex = draftMergeState.currentIndex + 1;
      setDraftMergeState((previous) =>
        previous && previous.documentId === draftMergeState.documentId
          ? {
              ...previous,
              currentIndex: nextIndex
            }
          : previous
      );
      setStatusMessage(
        `Reviewing remote draft ${nextIndex + 1} of ${draftMergeState.entries.length} for ${
          fileMap[draftMergeState.documentId]?.name ?? "the file"
        }.`
      );
      return;
    }

    try {
      await finalizeDraftMerge(draftMergeState);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to resolve remote drafts.");
    }
  }

  function handleSkipDraftFile() {
    if (!draftMergeState) {
      return;
    }

    const documentName = fileMap[draftMergeState.documentId]?.name ?? "the file";
    setDraftMergeState(null);
    setStatusMessage(`Skipped remote draft review for ${documentName}.`);
  }

  async function handleResolveDiskConflict(mode: "keep-local" | "use-disk" | "save-copy") {
    if (!diskConflict) {
      return;
    }

    const file = fileMap[diskConflict.documentId];
    if (!file) {
      setDiskConflict(null);
      return;
    }

    const localBuffer = bufferMap[diskConflict.documentId] ?? (await ensureBuffer(diskConflict.documentId));
    if (!localBuffer) {
      setDiskConflict(null);
      return;
    }

    if (mode === "save-copy") {
      const copyDocument = createConflictCopyDocument(file, "local-conflict", localBuffer.cachedBody);
      setFileMap((previous) => ({
        ...previous,
        [copyDocument.file.id]: copyDocument.file
      }));
      setBufferMap((previous) =>
        applyBufferPolicy({
          ...previous,
          [copyDocument.file.id]: copyDocument.buffer
        })
      );
      addTabToActiveGroup(copyDocument.file.id, true);
    }

    if (mode === "keep-local") {
      try {
        const writeResult = await writeWorkspaceDocument(file, localBuffer.cachedBody);
        setFileMap((previous) => ({
          ...previous,
          [file.id]: {
            ...previous[file.id],
            modifiedAt: writeResult.modifiedAt,
            lastSyncedModifiedAt: writeResult.modifiedAt,
            size: writeResult.size,
            lastSyncedSize: writeResult.size,
            conflictState: undefined,
            unavailable: false
          }
        }));
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [file.id]: {
              ...localBuffer,
              dirty: false,
              persistedLocal: false,
              lastAccessedAt: Date.now()
            }
          })
        );
      } finally {
        setDiskConflict(null);
      }
      return;
    }

    if (diskConflict.deleted) {
      setFileMap((previous) => {
        const next = { ...previous };
        delete next[file.id];
        return next;
      });
      setBufferMap((previous) => {
        const next = { ...previous };
        delete next[file.id];
        return next;
      });
      filterGroupsByDocumentPredicate((documentId) => documentId !== file.id);
      setDiskConflict(null);
      return;
    }

    const remoteFile = {
      ...file,
      size: diskConflict.snapshot?.size ?? diskConflict.remoteBody.length,
      modifiedAt: diskConflict.snapshot?.modifiedAt ?? file.modifiedAt,
      lastSyncedModifiedAt: diskConflict.snapshot?.modifiedAt ?? file.lastSyncedModifiedAt,
      lastSyncedSize: diskConflict.snapshot?.size ?? file.lastSyncedSize,
      conflictState: undefined,
      unavailable: false
    };
    setFileMap((previous) => ({
      ...previous,
      [file.id]: remoteFile
    }));
    setBufferMap((previous) =>
      applyBufferPolicy({
        ...previous,
        [file.id]: createBufferFromBody(remoteFile, diskConflict.remoteBody, {
          dirty: false,
          persistedLocal: false
        })
      })
    );
    setDiskConflict(null);
  }

  function handleToggleExpand(path: string) {
    setSidebarState((previous) => ({
      ...previous,
      expandedPaths: previous.expandedPaths.includes(path)
        ? previous.expandedPaths.filter((entry) => entry !== path)
        : [...previous.expandedPaths, path]
    }));
  }

  function handleSelectActivity(activity: ActivityId) {
    if (!searchAvailable && activity === "search") {
      activity = "files";
    }

    setLayout((previous) => {
      const shouldCollapse = previous.sidebarOpen && previous.activeActivity === activity;
      return {
        ...previous,
        activeActivity: activity,
        sidebarOpen: !shouldCollapse
      };
    });
  }

  function handleToggleSidebar() {
    setLayout((previous) => ({ ...previous, sidebarOpen: !previous.sidebarOpen }));
  }

  function handleTogglePreview() {
    setLayout((previous) => ({ ...previous, previewOpen: !previous.previewOpen }));
  }

  function handleCycleTheme() {
    setThemeMode((mode) => {
      if (mode === "light") return "dark";
      if (mode === "dark") return "system";
      return "light";
    });
  }

  async function handleCheckRemote() {
    if (!(await pollRemoteManifest())) {
      setStatusMessage("Checked for a remote workspace session.");
    }
  }

  async function handleSaveSessionRequest() {
    await saveWorkspaceSession(bundleLink ? "Saved workspace bundle." : "Saved new workspace bundle.", {
      createBundleIfNeeded: true
    });
  }

  async function handleChangeSaveLocation() {
    const nextBundleLink = await chooseBundleLocation(bundleLink?.workspaceRef);

    if (!nextBundleLink) {
      return;
    }

    await saveWorkspaceSession(`Saved workspace bundle to ${nextBundleLink.name}.`, {
      bundleOverride: nextBundleLink
    });
  }

  const bundleStatusLabel = !bundleLink
    ? "No workspace bundle linked."
    : bundleRuntimeReady
      ? `Linked workspace bundle: ${bundleLink.name}`
      : `Bundle remembered: ${bundleLink.name}. Reopen it in this browser session to sync again.`;
  const bundleLocationLabel = bundleLink?.bundlePath ?? bundleLink?.name ?? null;
  const workspaceStatusLabel = window.electronAPI
    ? workspace.rootPath
      ? `Workspace path: ${workspace.rootPath}`
      : "Workspace path is unavailable."
    : browserWorkspaceDirectoryHandleRef.current
      ? "Workspace folder access is active in this browser session."
      : "Reopen the workspace folder in this browser session to save files.";
  const availableActivities: ActivityId[] | undefined = searchAvailable
    ? undefined
    : ["files", "sessions", "providers", "settings"];
  const dirtyTabCloseFile = dirtyTabClosePrompt ? fileMap[dirtyTabClosePrompt.documentId] ?? null : null;

  // Stable handler identities for hot children (EditorGroup / TabStrip / TreeRow).
  // Each wraps the latest implementation via a ref so that the function reference
  // stays stable across renders, letting React.memo short-circuit re-renders.
  const stableGetDocument = useStableCallback((id: string): EditorGroupTabInfo | undefined => {
    const file = fileMapRef.current[id];
    if (!file) return undefined;
    const buffer = bufferMapRef.current[id];
    return {
      id: file.id,
      name: file.name,
      dirty: Boolean(buffer?.dirty),
      pendingDraftCount: file.pendingForeignDraftCount
    };
  });
  const stableActivateTab = useStableCallback((documentId: string, groupId: string) =>
    handleActivateFile(documentId, { preview: false, groupId })
  );
  const stablePromoteTab = useStableCallback((documentId: string, groupId: string) =>
    handlePromoteTab(documentId, groupId)
  );
  const stableCloseTab = useStableCallback((documentId: string, groupId: string) =>
    handleCloseTab(documentId, groupId)
  );
  const stableTabDragStart = useStableCallback(handleTabDragStart);
  const stableTabDragOver = useStableCallback(handleTabDragOver);
  const stableTabDrop = useStableCallback(handleTabDrop);
  const stableTabDragEnd = useStableCallback(handleTabDragEnd);
  const stableSplitRight = useStableCallback(handleSplitRight);
  const stableCloseOtherTabs = useStableCallback(handleCloseOtherTabs);
  const stableCloseTabsToRight = useStableCallback(handleCloseTabsToRight);
  const stableCloseSavedTabs = useStableCallback(handleCloseSavedTabs);
  const stableCloseAllTabs = useStableCallback(handleCloseAllTabs);
  const stableCopyFilePath = useStableCallback(handleCopyFilePath);
  const stableCopyRelativePath = useStableCallback(handleCopyRelativePath);
  const stableFocusGroup = useStableCallback(handleFocusGroup);
  const stableUpdateDocument = useStableCallback(handleUpdateDocument);
  const stableCursorChange = useStableCallback(handleCursorChange);
  const stableStartResize = useStableCallback((groupIndex: number) => setResizingGroupIndex(groupIndex));

  function renderSidebarPanel() {
    switch (layout.activeActivity) {
      case "files":
        return (
          <FilesPanel
            workspaceName={workspace.displayName}
            tree={tree}
            activeEntryId={activeTreeEntryId}
            expandedPaths={sidebarState.expandedPaths}
            dirtyDocumentIds={dirtyDocumentIds}
            canPaste={Boolean(fileTreeClipboard)}
            creatingEntry={pendingCreateTreeEntry}
            renamingNodeId={renamingTreeNodeId}
            onClearSelection={handleClearTreeSelection}
            onSelectEntry={handleSelectTreeEntry}
            onToggleExpand={handleToggleExpand}
            onOpenFile={(id) => handleActivateFile(id, { preview: true })}
            onOpenFilePermanent={handlePromoteTab}
            onCreateFile={(parentPath) => handleStartCreateTreeEntry("file", parentPath)}
            onCreateFolder={(parentPath) => handleStartCreateTreeEntry("directory", parentPath)}
            onCommitCreateEntry={(kind, parentPath, name) => void confirmCreateTreeEntry(kind, parentPath, name)}
            onCancelCreateEntry={() => setPendingCreateTreeEntry(null)}
            onCopyEntry={handleCopyTreeEntry}
            onPasteEntry={(targetDirectoryPath) => void handlePasteTreeEntry(targetDirectoryPath)}
            onDuplicateEntry={(node) => void handleDuplicateTreeEntry(node)}
            onRenameEntry={(node) => void handleRenameTreeEntry(node)}
            onCommitRenameEntry={(node, name) => void confirmRenameTreeEntry(node, name)}
            onCancelRenameEntry={() => setRenamingTreeNodeId(null)}
            onDeleteEntry={(node) => void handleDeleteTreeEntry(node)}
            onCopyPath={handleCopyTreePath}
            onCopyRelativePath={handleCopyTreeRelativePath}
            onRevealEntry={(node) => void handleRevealTreeEntry(node)}
            onOpenLocalWorkspace={handleOpenLocalWorkspace}
          />
        );
      case "search":
        if (!searchAvailable) {
          return null;
        }
        return (
          <SearchPanel
            query={searchState.query}
            results={searchResults}
            onQueryChange={(query) =>
              setSearchState((previous) => ({
                ...previous,
                query
              }))
            }
            onSelectResult={(documentId) => handleActivateFile(documentId)}
          />
        );
      case "sessions":
        return (
          <SessionsPanel
            workspaceName={workspace.displayName}
            manifestHeadRevision={manifest?.headRevision}
            manifestUpdatedAt={manifest?.updatedAt}
            manifestLastWriter={manifest?.lastWriterDeviceId}
            bundleStatus={bundleStatusLabel}
            bundleLocation={bundleLocationLabel}
            workspaceStatus={workspaceStatusLabel}
            pendingRemoteSessionCount={pendingRemoteSessions.length}
            canCheckRemote={bundleRuntimeReady}
            canChangeLocation={workspace.id !== sampleRoot.id}
            onSaveSession={() => void handleSaveSessionRequest()}
            onCheckRemote={() => void handleCheckRemote()}
            onReviewSessions={handleOpenSessionPicker}
            onChangeSaveLocation={() => void handleChangeSaveLocation()}
            onOpenWorkspaceBundle={() => void handleOpenWorkspaceBundle()}
          />
        );
      case "providers":
        return <ProvidersPanel providerStatuses={providerStatuses} />;
      case "settings":
        return (
          <SettingsPanel
            themeMode={themeMode}
            previewOpen={layout.previewOpen}
            onThemeModeChange={setThemeMode}
            onTogglePreview={handleTogglePreview}
          />
        );
      default:
        return null;
    }
  }

  if (!cacheBootstrapSettled) {
    return (
      <div className="app-shell">
        <div className="app-boot">
          <div className="app-boot__panel">
            <div className="app-boot__brand">
              <span className="app-boot__mark">T</span>
              <span className="app-boot__name">vsText</span>
            </div>
            <p className="app-boot__title">Opening workspace...</p>
            <p className="app-boot__hint">Restoring your last session.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <TitleBar
        workspaceName={workspace.displayName}
        sidebarOpen={layout.sidebarOpen}
        previewOpen={layout.previewOpen}
        canToggleSidebar={true}
        canTogglePreview={Boolean(activeDocument?.isMarkdown)}
        bundleLinked={Boolean(bundleLink)}
        onOpenLocalWorkspace={() => void handleOpenLocalWorkspace()}
        onOpenWorkspaceBundle={() => void handleOpenWorkspaceBundle()}
        onChangeSaveLocation={() => void handleChangeSaveLocation()}
        onSaveFile={() => void handleSaveActiveDocument()}
        onSaveSession={() => void handleSaveSessionRequest()}
        onToggleSidebar={handleToggleSidebar}
        onTogglePreview={handleTogglePreview}
      />

      <div className={`workbench ${!layout.sidebarOpen ? "workbench--sidebar-collapsed" : ""}`}>
        <ActivityBar
          activeActivity={layout.activeActivity}
          sidebarOpen={layout.sidebarOpen}
          onSelectActivity={handleSelectActivity}
          providerBadge={configuredCloudProviders || undefined}
          remoteSessionBadge={pendingRemoteSessions.length || undefined}
          availableActivities={availableActivities}
        />

        <aside
          className={`sidebar ${!layout.sidebarOpen ? "sidebar--collapsed" : ""}`}
          style={layout.sidebarOpen ? { width: sidebarWidth } : undefined}
          aria-hidden={!layout.sidebarOpen}
        >
          {renderSidebarPanel()}
          {layout.sidebarOpen ? (
            <div
              className={`sidebar__resize-handle ${isResizingSidebar ? "sidebar__resize-handle--active" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                setIsResizingSidebar(true);
              }}
              role="separator"
              aria-orientation="vertical"
            />
          ) : null}
        </aside>

        <section
          ref={editorRegionRef}
          className={`editor-region ${editorGroups.length > 1 ? "editor-region--split" : ""} ${
            resizingGroupIndex !== null ? "editor-region--resizing" : ""
          }`}
        >
          {editorGroups.map((group, index) => {
            const groupFile = group.activeTabId ? fileMap[group.activeTabId] ?? null : null;
            const groupBuffer = group.activeTabId ? bufferMap[group.activeTabId] ?? null : null;
            const groupDocument = composeTextDocument(groupFile, groupBuffer);
            const isActiveGroup = group.id === activeGroupId;
            const showMergeReview = Boolean(
              isActiveGroup && groupFile && activeDraftMergeEntry && groupFile.id === draftMergeState?.documentId
            );
            const basis = groupSizes[index] ?? 100 / Math.max(editorGroups.length, 1);
            const isDropTargetGroup = tabDrag?.overGroupId === group.id;
            const needsEditor = groupFile !== null || showMergeReview;
            const showLoadingEditor = Boolean(groupFile && !groupFile.isPdf && !groupBuffer);
            const pdfEntry = groupDocument?.isPdf ? pdfBlobEntries[groupDocument.id] : undefined;
            const mergeReviewData =
              showMergeReview && groupFile && activeDraftMergeEntry
                ? {
                    documentName: groupFile.name,
                    currentIndex: activeDraftMerge?.currentIndex ?? 0,
                    totalCount: activeDraftMerge?.entries.length ?? 0,
                    remoteDeviceName: activeDraftMergeEntry.deviceName,
                    remoteUpdatedAt: activeDraftMergeEntry.savedAt,
                    remoteBody: activeDraftMergeEntry.body,
                    onNextDraft: () => void handleNextDraft(),
                    onUseDraftAsBase: handleUseDraftAsBase,
                    onSaveDraftCopy: handleSaveDraftCopy,
                    onSkipFile: handleSkipDraftFile
                  }
                : null;
            return (
              <EditorGroup
                key={group.id}
                group={group}
                groupIndex={index}
                isActiveGroup={isActiveGroup}
                isDropTargetGroup={isDropTargetGroup}
                basis={basis}
                groupDocument={groupDocument}
                needsEditor={needsEditor}
                showLoadingEditor={showLoadingEditor}
                isLoadingActiveFile={Boolean(groupFile && loadingBufferIds.has(groupFile.id))}
                showMergeReview={showMergeReview}
                resolvedTheme={resolvedTheme}
                previewOpen={layout.previewOpen}
                focusRequest={
                  editorFocusRequest?.groupId === group.id
                    ? {
                        documentId: editorFocusRequest.documentId,
                        token: editorFocusRequest.token
                      }
                    : null
                }
                pdfUrl={pdfEntry?.url ?? null}
                pdfError={pdfEntry?.error ?? null}
                tabDrag={tabDrag}
                mergeReviewData={mergeReviewData}
                showResizeHandle={index < editorGroups.length - 1}
                resizingActive={resizingGroupIndex === index}
                canSplitRight={group.openTabs.length > 0}
                getDocument={stableGetDocument}
                onActivateTab={stableActivateTab}
                onPromoteTab={stablePromoteTab}
                onCloseTab={stableCloseTab}
                onTabDragStart={stableTabDragStart}
                onTabDragOver={stableTabDragOver}
                onTabDrop={stableTabDrop}
                onTabDragEnd={stableTabDragEnd}
                onSplitRight={stableSplitRight}
                onCloseOtherTabs={stableCloseOtherTabs}
                onCloseTabsToRight={stableCloseTabsToRight}
                onCloseSavedTabs={stableCloseSavedTabs}
                onCloseAllTabs={stableCloseAllTabs}
                onCopyFilePath={stableCopyFilePath}
                onCopyRelativePath={stableCopyRelativePath}
                onFocusGroup={stableFocusGroup}
                onUpdateDocument={stableUpdateDocument}
                onCursorChange={stableCursorChange}
                onStartResize={stableStartResize}
              />
            );
          })}
        </section>
      </div>

      <StatusBar
        activePath={activeDocument?.path ?? null}
        language={activeDocument?.language ?? null}
        dirty={Boolean(activeDocument?.dirty)}
        pendingDraftCount={activeDocument?.pendingForeignDraftCount ?? 0}
        cursorLine={activeCursor?.line ?? null}
        cursorColumn={activeCursor?.column ?? null}
        themeMode={themeMode}
        statusMessage={statusMessage}
        onCycleTheme={handleCycleTheme}
      />

      {sessionPickerOpen && !sessionCompareItems ? (
        <SessionPickerDialog
          sessions={pendingRemoteSessions.map((session) => ({
            revisionId: session.revisionId,
            deviceName: session.deviceName,
            updatedAt: session.updatedAt,
            openTabCount: session.openTabs.length,
            activeTab: session.activeTab
          }))}
          selectedRevisionId={selectedRemoteSession?.revisionId ?? null}
          onSelect={setSelectedRemoteSessionRevisionId}
          onResumeRemote={() => void handleResumeRemote()}
          onCompare={handleCompareSessions}
          onDismiss={handleDismissRemoteSession}
          onClose={() => setSessionPickerOpen(false)}
        />
      ) : null}

      {sessionCompareItems ? (
        <SessionCompareDialog
          items={sessionCompareItems}
          onChangeSelection={(id, nextSelection) =>
            setSessionCompareItems((previous) =>
              previous?.map((item) => (item.id === id ? { ...item, selection: nextSelection } : item)) ?? null
            )
          }
          onUseAll={(selection) =>
            setSessionCompareItems((previous) => (previous ? overwriteSelections(previous, selection) : previous))
          }
          onApply={() => void handleApplyCompareSelections()}
          onCancel={() => setSessionCompareItems(null)}
        />
      ) : null}

      {pendingDeleteEntry ? (
        <ConfirmationDialog
          message={pendingDeleteEntry.message}
          confirmLabel="Delete"
          destructive={true}
          onCancel={() => setPendingDeleteEntry(null)}
          onConfirm={() => {
            const entry = pendingDeleteEntry;
            setPendingDeleteEntry(null);
            void confirmDeleteTreeEntry(entry.node);
          }}
        />
      ) : null}

      {operationErrorMessage ? (
        <MessageDialog message={operationErrorMessage} onClose={() => setOperationErrorMessage(null)} />
      ) : null}

      {dirtyTabClosePrompt && dirtyTabCloseFile ? (
        <SavePromptDialog
          message={`Save changes to ${dirtyTabCloseFile.name} before closing?`}
          saving={dirtyTabCloseSavePending}
          onSave={() => void handleSaveDirtyTabBeforeClose()}
          onDontSave={() => void handleDontSaveDirtyTabBeforeClose()}
          onCancel={handleCancelDirtyTabClose}
        />
      ) : null}

      {closeWorkspacePromptOpen ? (
        <SavePromptDialog
          message={`Save workspace changes for ${workspace.displayName} before closing?`}
          saveLabel="Save Workspace"
          saving={closeWorkspaceSavePending}
          onSave={() => void handleSaveWorkspaceBeforeClose()}
          onDontSave={() => void handleCloseWithoutSavingWorkspaceFile()}
          onCancel={handleCancelDesktopClose}
        />
      ) : null}

      {diskConflict ? (
        <WorkspaceFileConflictDialog
          documentName={fileMap[diskConflict.documentId]?.name ?? "Untitled"}
          deleted={Boolean(diskConflict.deleted)}
          localBody={bufferMap[diskConflict.documentId]?.cachedBody ?? ""}
          remoteBody={diskConflict.remoteBody}
          onKeepLocal={() => void handleResolveDiskConflict("keep-local")}
          onUseDisk={() => void handleResolveDiskConflict("use-disk")}
          onSaveCopy={() => void handleResolveDiskConflict("save-copy")}
        />
      ) : null}

      {workspaceError ? (
        <WorkspaceErrorBanner message={workspaceError} onDismiss={() => setWorkspaceError(null)} />
      ) : null}

      {scanProgress ? (
        <WorkspaceScanOverlay
          progress={scanProgress}
          onCancel={() => scanCancelRef.current?.()}
          onSkipFolder={(folderPath) => scanSkipFolderRef.current?.(folderPath)}
        />
      ) : null}
    </div>
  );
}
