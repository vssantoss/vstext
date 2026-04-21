import { Fragment, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";

const EditorSurface = lazy(() =>
  import("./components/EditorSurface").then((module) => ({ default: module.EditorSurface }))
);

function EditorSurfacePlaceholder({ loading = false }: { loading?: boolean }) {
  return (
    <section className="editor-surface editor-surface--empty">
      <div className="editor-empty">
        <FileText size={32} className="editor-empty__icon" strokeWidth={1.4} />
        <p className="editor-empty__title">{loading ? "Loading editor…" : "No file open"}</p>
        {loading ? null : (
          <p className="editor-empty__hint">Pick a file from the Explorer or search to start editing.</p>
        )}
      </div>
    </section>
  );
}
import {
  ActivityBar,
  FilesPanel,
  ProvidersPanel,
  SearchPanel,
  SessionCompareDialog,
  SessionPickerDialog,
  SessionsPanel,
  SettingsPanel,
  StatusBar,
  TabStrip,
  TitleBar,
  WorkspaceFileConflictDialog,
  WorkspaceErrorBanner,
  WorkspaceScanOverlay
} from "./components/Shell";
import { db, loadSetting, loadWorkspaceSnapshot, persistSetting, persistWorkspaceSnapshot } from "./db";
import {
  buildTreeFromSnapshots,
  createBrowserBundleDirectory,
  inflateElectronWorkspace,
  openBrowserBundleDirectory,
  openBrowserWorkspace,
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
  getFirstFileId,
  getPinnedBufferIds,
  hydrateSessionState,
  mapCursorStateToPaths,
  mapFileIdsToPaths,
  mapFileIdToPath,
  mergeLayout,
  normalizeFile,
  searchLoadedBuffers,
  TabDragState,
  toNormalizedBufferMap,
  toNormalizedFileMap,
  touchBuffer
} from "./lib/editorRuntime";
import { createProviderRegistry, getConfiguredCloudProviderCount } from "./lib/providers";
import { detectLineEnding, hashText } from "./lib/encoding";
import { getLanguageMetadata, isMarkdownPath } from "./lib/language";
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
import { sampleBuffers, sampleFiles, sampleRoot, sampleTree } from "./sampleWorkspace";
import type {
  ActivityId,
  BundleBootstrap,
  BundleScanResult,
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

type BundleSaveOptions = {
  createBundleIfNeeded?: boolean;
  bundleOverride?: WorkspaceBundleLink;
  fileMapOverride?: Record<string, WorkspaceFileRecord>;
  bufferMapOverride?: Record<string, DocumentBuffer>;
};

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
  const [statusMessage, setStatusMessage] = useState("Loaded sample workspace.");
  const [scanProgress, setScanProgress] = useState<WorkspaceScanProgress | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const editorRegionRef = useRef<HTMLElement | null>(null);
  const [resizingGroupIndex, setResizingGroupIndex] = useState<number | null>(null);
  const [tabDrag, setTabDrag] = useState<TabDragState | null>(null);
  const [loadingBufferIds, setLoadingBufferIds] = useState<Set<string>>(() => new Set());
  const [pdfBlobEntries, setPdfBlobEntries] = useState<Record<string, { url: string; error?: string }>>({});
  const loadedPdfIdsRef = useRef<Set<string>>(new Set());
  const fileMapRef = useRef(fileMap);
  fileMapRef.current = fileMap;
  const bufferMapRef = useRef(bufferMap);
  bufferMapRef.current = bufferMap;
  const editorGroupsRef = useRef(editorGroups);
  editorGroupsRef.current = editorGroups;

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
  const activeDocument = composeTextDocument(activeFile, activeBuffer);
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
          buffer.cachedBody.length,
          buffer.lastAccessedAt,
          buffer.persistedLocal
        ])
      }),
    [workspace.id, tree, files, dirtyBuffers]
  );
  const sessionSaveSignature = useMemo(
    () =>
      JSON.stringify({
        themeMode,
        openTabs,
        activeTabId,
        layout,
        sidebarState,
        searchState,
        cursorState,
        bundleName: bundleLink?.name,
        dirtyBuffers: dirtyBuffers.map((buffer) => [
          buffer.documentId,
          fileMap[buffer.documentId]?.modifiedAt ?? "",
          buffer.cachedBody.length
        ])
      }),
    [themeMode, openTabs, activeTabId, layout, sidebarState, searchState, cursorState, bundleLink?.name, dirtyBuffers, fileMap]
  );

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
    nextBundleLink: WorkspaceBundleLink | null = null
  ) {
    const nextFileMap = toNormalizedFileMap(nextFiles);
    const nextBufferMap = toNormalizedBufferMap(nextBuffers.filter((buffer) => nextFileMap[buffer.documentId]));
    setWorkspace(nextWorkspace);
    setTree(nextTree);
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
    if (ownSession) {
      const hydratedSession = hydrateSessionState(ownSession, nextFileMap);
      const filteredTabs = hydratedSession.openTabs;
      const restoredTabs = filteredTabs.length
        ? filteredTabs
        : ([getFirstFileId(nextFiles)].filter(Boolean) as string[]);
      const restoredActive =
        hydratedSession.activeTabId && nextFileMap[hydratedSession.activeTabId]
          ? hydratedSession.activeTabId
          : filteredTabs[0] ?? getFirstFileId(nextFiles);
      replaceAllGroupsWithSingle(restoredTabs, restoredActive);
      setLayout(mergeLayout(ownSession.layout, defaultLayout, searchAvailable));
      setSidebarState(ownSession.sidebarState);
      setSearchState(ownSession.searchState);
      setCursorState(hydratedSession.cursorState);
      setThemeMode(nextManifest?.themeMode ?? ownSession.themeMode);
    } else {
      replaceAllGroupsWithSingle([], null);
      setLayout(mergeLayout(defaultLayout, defaultLayout, searchAvailable));
      setSidebarState(defaultSidebarState);
      setSearchState(defaultSearchState);
      setCursorState({});
    }
  }

  async function bootstrapFromCache() {
    const [storedTheme, lastWorkspaceSetting] = await Promise.all([
      loadSetting("theme-mode"),
      loadSetting("last-workspace-id")
    ]);

    if (storedTheme) {
      setThemeMode(storedTheme.value as ThemeMode);
    }

    if (!lastWorkspaceSetting) {
      return;
    }

    const snapshot = await loadWorkspaceSnapshot(lastWorkspaceSetting.value);

    if (!snapshot.workspace) {
      return;
    }

    hydrateWorkspace(
      snapshot.workspace.root,
      snapshot.workspace.tree,
      snapshot.files,
      snapshot.buffers,
      snapshot.workspace.manifest,
      snapshot.workspace.bundle ?? null
    );
    setStatusMessage(`Restored cached workspace: ${snapshot.workspace.root.displayName}`);
  }

  useEffect(() => {
    void bootstrapFromCache();
  }, []);

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
    void persistSetting("last-workspace-id", workspace.id);
    const timer = window.setTimeout(() => {
      void persistWorkspaceSnapshot(
        {
          id: workspace.id,
          root: workspace,
          tree,
          manifest,
          bundle: bundleLink ?? undefined,
          updatedAt: new Date().toISOString()
        },
        files,
        dirtyBuffers.map((buffer) => ({
          ...buffer,
          persistedLocal: true
        }))
      );
    }, 350);

    return () => window.clearTimeout(timer);
  }, [workspaceSnapshotSignature, workspace, tree, manifest, bundleLink, files, dirtyBuffers]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id || !bundleRuntimeReady) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void saveWorkspaceSession("Auto-saved workspace bundle.");
    }, 1400);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [workspace.id, bundleRuntimeReady, sessionSaveSignature]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id || !bundleRuntimeReady) {
      return;
    }

    const interval = window.setInterval(() => {
      void pollRemoteManifest();
    }, 15000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void saveWorkspaceSession("Workspace bundle persisted.");
        return;
      }

      if (document.visibilityState === "visible") {
        void pollRemoteManifest();
        void pollWorkspaceChanges();
      }
    };

    const handleFocus = () => {
      void pollRemoteManifest();
      void pollWorkspaceChanges();
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, [workspace.id, bundleRuntimeReady, manifest?.updatedAt]);

  useEffect(() => {
    if (workspace.id === sampleRoot.id) {
      return;
    }

    if (!(window.electronAPI ? workspace.rootPath : browserWorkspaceDirectoryHandleRef.current)) {
      return;
    }

    const interval = window.setInterval(() => {
      void pollWorkspaceChanges();
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
      void pollWorkspaceChanges();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pollWorkspaceChanges();
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

  async function handleOpenSampleWorkspace() {
    clearWorkspaceAccess();
    clearBundleAccess();
    hydrateWorkspace(sampleRoot, sampleTree, sampleFiles, sampleBuffers);
    setStatusMessage("Loaded bundled sample workspace.");
  }

  async function trackWorkspaceScan<T>(
    work: (context: {
      onBrowserProgress: (progress: BrowserWorkspaceScanProgress) => void;
      signal: AbortSignal;
      registerElectronScan: () => string;
      shouldSkipFolder: (folderPath: string) => boolean;
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

    scanCancelRef.current = requestCancel;
    scanSkipFolderRef.current = requestSkipFolder;

    try {
      return await work({
        onBrowserProgress,
        signal: abortController.signal,
        registerElectronScan,
        shouldSkipFolder
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
      await trackWorkspaceScan(async ({ onBrowserProgress, signal, registerElectronScan, shouldSkipFolder }) => {
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
        hydrateWorkspace(browserWorkspace.root, browserWorkspace.tree, browserWorkspace.files);
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
      await trackWorkspaceScan(async ({ onBrowserProgress, signal, registerElectronScan, shouldSkipFolder }) => {
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
          browserWorkspace.root,
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
    forceEvictIds: string[] = []
  ) {
    return evictCleanBuffers(
      fileMapRef.current,
      nextBufferMap,
      getPinnedBufferIds(editorGroupsRef.current, nextBufferMap),
      forceEvictIds
    );
  }

  function evictBufferIfClean(documentId: string) {
    setBufferMap((previous) => applyBufferPolicy(previous, [documentId]));
  }

  async function ensureBuffer(documentId: string): Promise<DocumentBuffer | null> {
    const file = fileMapRef.current[documentId];
    if (!file || file.isPdf) {
      return null;
    }

    const existing = bufferMapRef.current[documentId];
    if (existing) {
      const touched = touchBuffer(existing);
      if (touched.lastAccessedAt !== existing.lastAccessedAt) {
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [documentId]: touched
          })
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

        const body = await readWorkspaceDocumentBody(latestFile);
        const nextBuffer = createBufferFromBody(latestFile, body);
        setBufferMap((previous) =>
          applyBufferPolicy({
            ...previous,
            [documentId]: nextBuffer
          })
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

  async function startDraftMerge(documentId: string) {
    const file = fileMap[documentId];
    if (!file || file.pendingForeignDraftCount === 0 || file.foreignDrafts.length === 0) {
      return;
    }

    if (draftMergeState?.documentId === documentId) {
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
      documentId,
      entries,
      currentIndex: 0
    });
    setStatusMessage(`Reviewing ${entries.length} remote draft${entries.length === 1 ? "" : "s"} for ${file.name}.`);
  }

  function handleActivateFile(
    documentId: string,
    options: { preview?: boolean; groupId?: string } = {}
  ) {
    const asPreview = options.preview ?? true;
    const targetGroupId = options.groupId ?? activeGroupId;
    const existingTargetGroup = editorGroupsRef.current.find((group) => group.id === targetGroupId);
    const replacedPreviewId =
      asPreview &&
      existingTargetGroup?.previewTabId &&
      existingTargetGroup.previewTabId !== documentId &&
      existingTargetGroup.openTabs.includes(existingTargetGroup.previewTabId)
        ? existingTargetGroup.previewTabId
        : null;

    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== targetGroupId) return group;
        let nextTabs = group.openTabs;
        let nextPreview = group.previewTabId;
        if (!nextTabs.includes(documentId)) {
          if (asPreview && group.previewTabId && nextTabs.includes(group.previewTabId)) {
            nextTabs = nextTabs.map((id) => (id === group.previewTabId ? documentId : id));
          } else {
            nextTabs = [...nextTabs, documentId];
          }
        }
        if (asPreview) {
          nextPreview = documentId;
        } else if (nextPreview === documentId) {
          nextPreview = null;
        }
        return { ...group, openTabs: nextTabs, previewTabId: nextPreview, activeTabId: documentId };
      })
    );
    setActiveGroupId(targetGroupId);

    if (replacedPreviewId) {
      const openElsewhere = editorGroupsRef.current.some(
        (group) => group.id !== targetGroupId && group.openTabs.includes(replacedPreviewId)
      );
      if (!openElsewhere) {
        evictBufferIfClean(replacedPreviewId);
      }
    }

    const file = fileMap[documentId];
    if (!file) {
      return;
    }

    if (!file.isPdf) {
      void ensureBuffer(documentId);
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
    const targetGroupId = groupId ?? activeGroupId;
    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== targetGroupId) return group;
        const nextTabs = group.openTabs.includes(documentId) ? group.openTabs : [...group.openTabs, documentId];
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: documentId,
          previewTabId: group.previewTabId === documentId ? null : group.previewTabId
        };
      })
    );
    setActiveGroupId(targetGroupId);
    const file = fileMap[documentId];
    if (file && !file.isPdf) {
      void ensureBuffer(documentId);
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

  function handleCloseTab(documentId: string, groupId?: string) {
    const targetGroupId = groupId ?? activeGroupId;
    const openElsewhere = editorGroupsRef.current.some(
      (group) => group.id !== targetGroupId && group.openTabs.includes(documentId)
    );
    let removedGroupIndex = -1;
    setEditorGroups((groups) => {
      const next = groups.map((group) => {
        if (group.id !== targetGroupId) return group;
        const nextTabs = group.openTabs.filter((id) => id !== documentId);
        let nextActive = group.activeTabId;
        if (group.activeTabId === documentId) {
          nextActive = nextTabs.at(-1) ?? null;
        }
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: nextActive,
          previewTabId: group.previewTabId === documentId ? null : group.previewTabId
        };
      });
      if (next.length > 1) {
        const emptyIndex = next.findIndex((group) => group.id === targetGroupId && group.openTabs.length === 0);
        if (emptyIndex !== -1) {
          removedGroupIndex = emptyIndex;
          return next.filter((_, index) => index !== emptyIndex);
        }
      }
      return next;
    });
    if (removedGroupIndex !== -1) {
      setGroupSizes((sizes) => {
        if (sizes.length <= 1) return sizes;
        const removed = sizes[removedGroupIndex] ?? 0;
        const remaining = sizes.filter((_, index) => index !== removedGroupIndex);
        if (remaining.length === 0) return sizes;
        const share = removed / remaining.length;
        return remaining.map((size) => size + share);
      });
      setActiveGroupId((current) => {
        if (current !== targetGroupId) return current;
        // Pick neighbor
        return editorGroups[Math.max(0, removedGroupIndex - 1)]?.id ?? editorGroups[0]?.id ?? current;
      });
    }
    if (!openElsewhere) {
      evictBufferIfClean(documentId);
    }
  }

  function handleUpdateDocument(nextValue: string) {
    if (!activeFile) {
      return;
    }

    const documentId = activeFile.id;
    const groupId = activeGroupId;
    const updatedAt = new Date().toISOString();
    setEditorGroups((groups) =>
      groups.map((group) =>
        group.id === groupId && group.previewTabId === documentId
          ? { ...group, previewTabId: null }
          : group
      )
    );

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
      })
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

  function handleSplitRight(sourceGroupId: string) {
    const source = editorGroups.find((group) => group.id === sourceGroupId);
    const seedDocId = source?.activeTabId ?? null;
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

  function addTabToActiveGroup(documentId: string, makeActive = false) {
    const targetGroupId = activeGroupId;
    setEditorGroups((groups) =>
      groups.map((group) => {
        if (group.id !== targetGroupId) return group;
        const nextTabs = group.openTabs.includes(documentId) ? group.openTabs : [...group.openTabs, documentId];
        return {
          ...group,
          openTabs: nextTabs,
          activeTabId: makeActive ? documentId : group.activeTabId
        };
      })
    );
    const file = fileMap[documentId];
    if (file && !file.isPdf) {
      void ensureBuffer(documentId);
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

  async function readWorkspaceDocumentBody(document: Pick<WorkspaceFileRecord, "path" | "absolutePath">) {
    return providerRegistry.local.readText(document);
  }

  async function readWorkspaceDocumentBlob(
    document: Pick<WorkspaceFileRecord, "path" | "absolutePath">,
    mimeType = "application/octet-stream"
  ): Promise<Blob> {
    return providerRegistry.local.readBlob(document, mimeType);
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
          path: file.path,
          absolutePath: latestSnapshot.absolutePath ?? file.absolutePath
        });
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
        })
      );
    }
  }

  async function writeWorkspaceDocument(document: WorkspaceFileRecord, content: string) {
    return providerRegistry.local.writeText(document, content);
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

  async function handleSaveActiveDocument() {
    if (!activeFile || activeFile.isPdf) {
      if (activeFile?.isPdf) {
        setStatusMessage("PDF files are preview-only and cannot be saved.");
      }
      return;
    }

    if (activeDraftMerge?.documentId === activeFile.id) {
      setStatusMessage("Finish or skip the remote draft review before saving this file.");
      return;
    }

    const loadedBuffer = activeBuffer ?? (await ensureBuffer(activeFile.id));
    if (!loadedBuffer) {
      setStatusMessage(`Unable to load ${activeFile.name}.`);
      return;
    }

    if (workspace.id === sampleRoot.id) {
      setStatusMessage("The sample workspace is editable, but not written to disk.");
      setBufferMap((previous) =>
        applyBufferPolicy({
          ...previous,
          [activeFile.id]: {
            ...loadedBuffer,
            dirty: false
          }
        })
      );
      setFileMap((previous) => ({
        ...previous,
        [activeFile.id]: {
          ...previous[activeFile.id],
          lastSyncedModifiedAt: previous[activeFile.id].modifiedAt,
          lastSyncedSize: previous[activeFile.id].size
        }
      }));
      return;
    }

    try {
      let targetFile = activeFile;
      let targetBuffer = loadedBuffer;
      if (bundleRuntimeReady) {
        const latestManifest = await readManifestFromBundle();
        if (latestManifest) {
          setManifest(latestManifest);
          const syncedState = await syncDocumentBundleState(latestManifest);
          targetFile = syncedState.fileMap[activeFile.id] ?? targetFile;
          targetBuffer = syncedState.bufferMap[activeFile.id] ?? targetBuffer;
        }
      }

      const latestSnapshot = await getWorkspaceDocumentSnapshot(targetFile);

      if (
        !latestSnapshot ||
        latestSnapshot.modifiedAt !== targetFile.lastSyncedModifiedAt ||
        latestSnapshot.size !== targetFile.lastSyncedSize
      ) {
        await queueDiskConflict(targetFile, latestSnapshot, targetBuffer.cachedBody);
        return;
      }

      const writeResult = await writeWorkspaceDocument(targetFile, targetBuffer.cachedBody);

      if (!writeResult) {
        throw new Error("This workspace is not writable in the current runtime.");
      }

      setFileMap((previous) => ({
        ...previous,
        [targetFile.id]: {
          ...previous[targetFile.id],
          modifiedAt: writeResult.modifiedAt,
          lastSyncedModifiedAt: writeResult.modifiedAt,
          size: writeResult.size,
          lastSyncedSize: writeResult.size,
          conflictState: undefined,
          foreignDrafts: [],
          pendingForeignDraftCount: 0,
          unavailable: false
        }
      }));
      setBufferMap((previous) =>
        applyBufferPolicy({
          ...previous,
          [targetFile.id]: {
            ...(previous[targetFile.id] ?? targetBuffer),
            cachedBody: targetBuffer.cachedBody,
            dirty: false,
            lastAccessedAt: Date.now(),
            persistedLocal: false
          }
        })
      );

      setStatusMessage(`Saved ${targetFile.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to save the current file.");
    }
  }

  async function pollWorkspaceChanges() {
    if (workspace.id === sampleRoot.id || workspacePollInFlightRef.current) {
      return false;
    }

    if (!window.electronAPI && !browserWorkspaceDirectoryHandleRef.current) {
      return false;
    }

    workspacePollInFlightRef.current = true;

    try {
      const snapshots = await providerRegistry.local.scanWorkspace(workspace.rootPath);
      const snapshotByPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
      const visibleFileIds = new Set(editorGroupsRef.current.map((group) => group.activeTabId).filter((value): value is string => Boolean(value)));
      const workspaceFiles = Object.values(fileMapRef.current).filter((file) => !file.id.startsWith("copy:"));
      const currentByPath = new Map(workspaceFiles.map((file) => [file.path, file]));
      const nextFileMap: Record<string, WorkspaceFileRecord> = { ...fileMapRef.current };
      const nextBufferMap: Record<string, DocumentBuffer> = { ...bufferMapRef.current };
      let didChange = false;

      for (const file of workspaceFiles) {
        const snapshot = snapshotByPath.get(file.path);
        const buffer = nextBufferMap[file.id];

        if (!snapshot) {
          if (buffer?.dirty) {
            nextFileMap[file.id] = {
              ...file,
              conflictState: "disk-changed",
              unavailable: true
            };
            if (!diskConflict || diskConflict.documentId !== file.id) {
              await queueDiskConflict(file, null, buffer.cachedBody);
            }
          } else {
            delete nextFileMap[file.id];
            delete nextBufferMap[file.id];
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

        if (visibleFileIds.has(file.id) && !file.isPdf) {
          try {
            const body = await readWorkspaceDocumentBody({
              path: file.path,
              absolutePath: snapshot.absolutePath ?? file.absolutePath
            });
            nextBufferMap[file.id] = createBufferFromBody(nextFileMap[file.id], body);
          } catch {
            // Keep metadata fresh even if the body cannot be reloaded yet.
          }
        } else if (buffer && !buffer.dirty) {
          delete nextBufferMap[file.id];
        }

        didChange = true;
      }

      for (const snapshot of snapshots) {
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
        didChange = true;
      }

      if (!didChange) {
        return false;
      }

      setFileMap(nextFileMap);
      setBufferMap(applyBufferPolicy(nextBufferMap));
      setTree(buildTreeFromSnapshots(workspace, snapshots));
      filterGroupsByDocumentPredicate((documentId) => Boolean(nextFileMap[documentId]));
      setStatusMessage(`Detected workspace changes in ${workspace.displayName}.`);
      return true;
    } finally {
      workspacePollInFlightRef.current = false;
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

  function renderSidebarPanel() {
    switch (layout.activeActivity) {
      case "files":
        return (
          <FilesPanel
            workspaceName={workspace.displayName}
            tree={tree}
            activeDocumentId={activeTabId}
            expandedPaths={sidebarState.expandedPaths}
            dirtyDocumentIds={dirtyDocumentIds}
            onToggleExpand={handleToggleExpand}
            onOpenFile={(id) => handleActivateFile(id, { preview: true })}
            onOpenFilePermanent={handlePromoteTab}
            onOpenLocalWorkspace={handleOpenLocalWorkspace}
            onOpenSample={handleOpenSampleWorkspace}
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

  return (
    <div className="app-shell">
      <TitleBar
        workspaceName={workspace.displayName}
        statusMessage={statusMessage}
        sidebarOpen={layout.sidebarOpen}
        previewOpen={layout.previewOpen}
        canToggleSidebar={true}
        canTogglePreview={Boolean(activeDocument?.isMarkdown)}
        bundleLinked={Boolean(bundleLink)}
        onOpenSample={() => void handleOpenSampleWorkspace()}
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
            return (
              <Fragment key={group.id}>
                <div
                  className={`editor-group ${isActiveGroup ? "editor-group--active" : ""} ${
                    isDropTargetGroup ? "editor-group--drop-target" : ""
                  }`}
                  style={{ flexBasis: `${basis}%` }}
                  onMouseDownCapture={() => handleFocusGroup(group.id)}
                >
                  <TabStrip
                    groupId={group.id}
                    openTabs={group.openTabs}
                    activeTabId={group.activeTabId}
                    previewTabId={group.previewTabId}
                    tabDrag={tabDrag}
                    getDocument={(id) => {
                      const file = fileMap[id];
                      const buffer = bufferMap[id];
                      return file
                        ? {
                            id: file.id,
                            name: file.name,
                            dirty: Boolean(buffer?.dirty),
                            pendingDraftCount: file.pendingForeignDraftCount
                          }
                        : undefined;
                    }}
                    onActivate={(id) => handleActivateFile(id, { preview: false, groupId: group.id })}
                    onPromote={(id) => handlePromoteTab(id, group.id)}
                    onClose={(id) => handleCloseTab(id, group.id)}
                    onTabDragStart={(documentId) => handleTabDragStart(group.id, documentId)}
                    onTabDragOver={(overTabId, before) => handleTabDragOver(group.id, overTabId, before)}
                    onTabDrop={(anchorTabId, before) => handleTabDrop(group.id, anchorTabId, before)}
                    onTabDragEnd={handleTabDragEnd}
                    onSplitRight={group.openTabs.length > 0 ? () => handleSplitRight(group.id) : undefined}
                  />
                  <div
                    className="editor-group__surface"
                    onDragOver={(event) => {
                      if (!tabDrag) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      handleTabDragOver(group.id, null, false);
                    }}
                    onDrop={(event) => {
                      if (!tabDrag) return;
                      event.preventDefault();
                      handleTabDrop(group.id, null, false);
                    }}
                  >
                    {needsEditor ? (
                      showLoadingEditor ? (
                        <EditorSurfacePlaceholder loading={loadingBufferIds.has(groupFile!.id)} />
                      ) : (
                        <Suspense fallback={<EditorSurfacePlaceholder loading />}>
                          <EditorSurface
                            document={groupDocument}
                            resolvedTheme={resolvedTheme}
                            previewOpen={layout.previewOpen}
                            onChange={handleUpdateDocument}
                            onCursorChange={handleCursorChange}
                            pdf={
                              groupDocument?.isPdf
                                ? {
                                    url: pdfBlobEntries[groupDocument.id]?.url ?? null,
                                    error: pdfBlobEntries[groupDocument.id]?.error ?? null
                                  }
                                : undefined
                            }
                            mergeReview={
                              showMergeReview
                                ? {
                                    documentName: groupFile!.name,
                                    currentIndex: activeDraftMerge?.currentIndex ?? 0,
                                    totalCount: activeDraftMerge?.entries.length ?? 0,
                                    remoteDeviceName: activeDraftMergeEntry!.deviceName,
                                    remoteUpdatedAt: activeDraftMergeEntry!.savedAt,
                                    remoteBody: activeDraftMergeEntry!.body,
                                    onNextDraft: () => void handleNextDraft(),
                                    onUseDraftAsBase: handleUseDraftAsBase,
                                    onSaveDraftCopy: handleSaveDraftCopy,
                                    onSkipFile: handleSkipDraftFile
                                  }
                                : null
                            }
                          />
                        </Suspense>
                      )
                    ) : (
                      <EditorSurfacePlaceholder />
                    )}
                  </div>
                </div>
                {index < editorGroups.length - 1 ? (
                  <div
                    className={`editor-group__resize-handle ${
                      resizingGroupIndex === index ? "editor-group__resize-handle--active" : ""
                    }`}
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      setResizingGroupIndex(index);
                    }}
                  />
                ) : null}
              </Fragment>
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
