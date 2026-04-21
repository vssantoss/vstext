export type ProviderId = "local" | "onedrive" | "gdrive" | "dropbox";
export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ActivityId = "files" | "search" | "sessions" | "providers" | "settings";
export type WorkspaceKind = "local-root" | "cloud-root";
export type TreeNodeKind = "file" | "directory";
export type ProviderReadiness = "ready" | "scaffolded" | "needs-config";
export type Encoding =
  | "utf-8"
  | "utf-8-bom"
  | "utf-16le"
  | "utf-16be"
  | "windows-1252"
  | "iso-8859-1";
export type LineEnding = "lf" | "crlf";
export type SessionSelection = "local" | "remote";

export interface CursorSnapshot {
  line: number;
  column: number;
  scrollTop: number;
}

export interface SidebarState {
  expandedPaths: string[];
  searchOpen: boolean;
}

export interface SearchState {
  query: string;
  lastQuery: string;
  selectedPath: string | null;
}

export interface LayoutState {
  previewOpen: boolean;
  sidebarOpen: boolean;
  activeActivity: ActivityId;
  mobilePanel: "tree" | "search" | "preview";
}

export interface FileTreeNode {
  id: string;
  provider: ProviderId;
  kind: TreeNodeKind;
  name: string;
  path: string;
  absolutePath?: string;
  parentPath?: string;
  size?: number;
  modifiedAt?: string;
  children?: FileTreeNode[];
  unavailable?: boolean;
}

export interface WorkspaceRoot {
  id: string;
  provider: ProviderId;
  rootId: string;
  rootPath?: string;
  displayName: string;
  kind: WorkspaceKind;
  modifiedAt?: string;
}

export interface DeviceWorkspaceHint {
  deviceId: string;
  absolutePath: string;
  updatedAt: string;
}

export interface LocalWorkspaceReference {
  kind: "local";
  provider: "local";
  displayName: string;
  bundleRelativePath?: string;
  oneDriveRelativePath?: string;
  deviceHints: DeviceWorkspaceHint[];
}

export interface CloudWorkspaceReference {
  kind: "cloud";
  provider: Exclude<ProviderId, "local">;
  displayName: string;
  referenceTokens: Record<string, string>;
}

export type WorkspaceReference = LocalWorkspaceReference | CloudWorkspaceReference;

export interface WorkspaceBundleLink {
  name: string;
  bundlePath?: string;
  workspaceRef: WorkspaceReference;
}

export interface ForeignDraftMetadata {
  revisionId: string;
  deviceId: string;
  deviceName: string;
  savedAt: string;
  contentHash: string;
  blobPath: string;
}

export interface DraftResolutionRecord {
  revisionId: string;
  path: string;
  resolvedAt: string;
  resolvedByDeviceId: string;
  resolvedByDeviceName: string;
  clearedDraftRevisionIds: string[];
  finalContentHash: string;
  blobPath: string;
}

export interface DraftRef {
  fileId?: string;
  revisionId: string;
  path: string;
  deviceId: string;
  deviceName: string;
  baseRemoteRevision?: string;
  updatedAt: string;
  blobPath: string;
  contentHash: string;
  deleted?: boolean;
}

export interface WorkspaceFileRecord {
  id: string;
  workspaceId: string;
  path: string;
  name: string;
  provider: ProviderId;
  language: string;
  size: number;
  remoteRevision?: string;
  modifiedAt: string;
  lastSyncedModifiedAt: string;
  lastSyncedSize: number;
  conflictState?: "disk-changed" | "foreign-draft-available";
  foreignDrafts: ForeignDraftMetadata[];
  pendingForeignDraftCount: number;
  lastAppliedResolutionRevisionId?: string;
  absolutePath?: string;
  isMarkdown?: boolean;
  isPdf?: boolean;
  unavailable?: boolean;
}

export interface DocumentBuffer {
  documentId: string;
  workspaceId: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  dirty: boolean;
  cachedBody: string;
  lastAccessedAt: number;
  persistedLocal: boolean;
}

export interface TextDocument extends WorkspaceFileRecord, DocumentBuffer {}

export interface DeviceSession {
  deviceId: string;
  deviceName: string;
  updatedAt: string;
  revisionId: string;
  workspacePath?: string;
  openTabs: string[];
  activeTab: string | null;
  layout: LayoutState;
  sidebarState: SidebarState;
  searchState: SearchState;
  cursorState: Record<string, CursorSnapshot>;
  themeMode: ThemeMode;
}

export interface BundleBootstrap {
  version: number;
  bundleFormat: "multi-device-v1";
  workspaceId: string;
  displayName: string;
  workspaceRef: WorkspaceReference;
}

export interface WorkspaceManifest {
  version: number;
  workspaceId: string;
  displayName: string;
  workspaceRef: WorkspaceReference;
  themeMode: ThemeMode;
  headRevision: number;
  updatedAt: string;
  lastWriterDeviceId: string;
  deviceSessions: DeviceSession[];
  draftRefs: DraftRef[];
  resolutionRefs: DraftResolutionRecord[];
}

export interface SessionCompareItem {
  id: string;
  type:
    | "tabs"
    | "activeTab"
    | "layout"
    | "sidebar"
    | "search"
    | "cursor"
    | "theme"
    | "draft";
  label: string;
  localValue: unknown;
  remoteValue: unknown;
  selection: SessionSelection;
}

export interface SearchEntry {
  documentId: string;
  path: string;
  title: string;
  snippet: string;
  score: number;
  indexedAt: string;
}

export interface WorkspaceFileSnapshot {
  path: string;
  absolutePath?: string;
  modifiedAt: string;
  size: number;
  exists: boolean;
}

export interface BundleScanResult {
  bootstrap?: BundleBootstrap;
  sessions: DeviceSession[];
  drafts: DraftRef[];
  resolutions: DraftResolutionRecord[];
}

export interface CachedWorkspace {
  id: string;
  root: WorkspaceRoot;
  tree: FileTreeNode[];
  manifest?: WorkspaceManifest;
  bundle?: WorkspaceBundleLink;
  updatedAt: string;
}

export interface StoredSetting {
  key: string;
  value: string;
}

export interface FileWriteResult {
  modifiedAt: string;
  size: number;
}

export interface OpenDirectoryResult extends WorkspaceRoot {
  tree: FileTreeNode[];
  loadWarnings?: string[];
  skippedEntryCount?: number;
  cancelled?: boolean;
  entriesProcessed?: number;
  filesLoaded?: number;
}

export interface BundleDirectorySelection {
  path: string;
  name: string;
}

export interface CreateLocalWorkspaceRefInput {
  workspacePath: string;
  bundlePath: string;
  deviceId: string;
  displayName: string;
}

export interface ResolveLocalWorkspaceCandidatesInput {
  bundlePath: string;
  workspaceRef: LocalWorkspaceReference;
  deviceId: string;
}

export interface WorkspaceScanFolder {
  path: string;
  name: string;
  enteredAtMs: number;
}

export interface OpenDirectoryProgressEvent {
  scanId: string;
  phase: "scanning";
  entriesProcessed: number;
  filesLoaded: number;
  currentPath: string;
  folderStack: WorkspaceScanFolder[];
}

export interface WorkspaceScanProgress {
  source: "local";
  entriesProcessed: number;
  filesLoaded: number;
  currentPath: string;
  folderStack: WorkspaceScanFolder[];
  skipFolderPath: string | null;
  skipFolderName: string | null;
  cancelRequested: boolean;
}

export interface AppDesktopApi {
  setWindowTheme: (theme: ResolvedTheme) => Promise<boolean>;
  openDirectory: (scanId: string) => Promise<OpenDirectoryResult | null>;
  openDirectoryByPath: (absolutePath: string, scanId: string) => Promise<OpenDirectoryResult | null>;
  cancelOpenDirectoryScan: (scanId: string) => Promise<boolean>;
  skipOpenDirectoryFolder: (scanId: string, folderPath: string) => Promise<boolean>;
  scanWorkspace: (rootPath: string) => Promise<WorkspaceFileSnapshot[]>;
  getFileSnapshot: (absolutePath: string) => Promise<WorkspaceFileSnapshot | null>;
  searchWorkspace: (rootPath: string, query: string, requestId: string, limit?: number) => Promise<SearchEntry[]>;
  cancelWorkspaceSearch: (requestId: string) => Promise<boolean>;
  createBundleDirectory: (suggestedName: string) => Promise<BundleDirectorySelection | null>;
  openBundleDirectory: () => Promise<BundleDirectorySelection | null>;
  scanBundle: (bundlePath: string) => Promise<BundleScanResult>;
  readFile: (absolutePath: string) => Promise<string>;
  readFileBytes: (absolutePath: string) => Promise<ArrayBuffer>;
  writeFile: (absolutePath: string, content: string) => Promise<FileWriteResult>;
  writeJson: (absolutePath: string, payload: unknown) => Promise<boolean>;
  readJson: <T>(absolutePath: string) => Promise<T>;
  createLocalWorkspaceRef: (input: CreateLocalWorkspaceRefInput) => Promise<LocalWorkspaceReference>;
  resolveLocalWorkspaceCandidates: (input: ResolveLocalWorkspaceCandidatesInput) => Promise<string[]>;
  onOpenDirectoryProgress: (listener: (event: OpenDirectoryProgressEvent) => void) => () => void;
}

export interface ProviderCapabilities {
  auth: boolean;
  workspaceDiscovery: boolean;
  openWorkspace: boolean;
  readFile: boolean;
  writeFile: boolean;
  pollWorkspace: boolean;
  bundleSync: boolean;
}

export interface ProviderStatus {
  provider: ProviderId;
  label: string;
  configured: boolean;
  connected: boolean;
  readiness: ProviderReadiness;
  description: string;
  statusLabel: string;
  capabilities: ProviderCapabilities;
  lastError?: string;
}
