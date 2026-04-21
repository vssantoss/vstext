export declare const MANIFEST_FILE_NAME: "vstext.json";
export declare const MANIFEST_DIR_NAME: "vstext";
export declare const SUPPORTED_TEXT_EXTENSIONS: readonly string[];
export declare const SUPPORTED_BINARY_EXTENSIONS: readonly string[];

export interface NormalizedBundleBootstrap {
  version: number;
  bundleFormat: "multi-device-v1";
  workspaceId: string;
  displayName: string;
  workspaceRef: unknown;
}

export interface NormalizedDeviceSession {
  revisionId: string;
  deviceId: string;
  deviceName: string;
  workspacePath?: string;
  updatedAt: string;
  openTabs: string[];
  activeTab: string | null;
  layout: unknown;
  sidebarState: unknown;
  searchState: unknown;
  cursorState: unknown;
  themeMode: unknown;
}

export interface NormalizedDraftRef {
  revisionId: string;
  fileId?: string;
  path: string;
  deviceId: string;
  deviceName: string;
  baseRemoteRevision?: string;
  updatedAt: string;
  blobPath: string;
  contentHash: string;
  deleted?: boolean;
}

export interface NormalizedDraftResolution {
  revisionId: string;
  path: string;
  resolvedAt: string;
  resolvedByDeviceId: string;
  resolvedByDeviceName: string;
  clearedDraftRevisionIds: string[];
  finalContentHash: string;
  blobPath: string;
}

export declare function getExtensionToken(input: string): string;
export declare function isSupportedTextExtension(input: string): boolean;
export declare function isSupportedBinaryExtension(input: string): boolean;
export declare function compareByUpdatedAtDesc(
  left: { updatedAt: string; revisionId: string },
  right: { updatedAt: string; revisionId: string }
): number;
export declare function compareByResolvedAtDesc(
  left: { resolvedAt: string; revisionId: string },
  right: { resolvedAt: string; revisionId: string }
): number;
export declare function normalizeBootstrapPayload(payload: unknown, fallbackDisplayName?: string): NormalizedBundleBootstrap | undefined;
export declare function normalizeSessionPayload(payload: unknown, relativePath: string): NormalizedDeviceSession | null;
export declare function normalizeDraftPayload(payload: unknown, relativePath: string): NormalizedDraftRef | null;
export declare function normalizeResolutionPayload(payload: unknown, relativePath: string): NormalizedDraftResolution | null;

declare const _default: {
  MANIFEST_FILE_NAME: typeof MANIFEST_FILE_NAME;
  MANIFEST_DIR_NAME: typeof MANIFEST_DIR_NAME;
  SUPPORTED_TEXT_EXTENSIONS: typeof SUPPORTED_TEXT_EXTENSIONS;
  SUPPORTED_BINARY_EXTENSIONS: typeof SUPPORTED_BINARY_EXTENSIONS;
  compareByUpdatedAtDesc: typeof compareByUpdatedAtDesc;
  compareByResolvedAtDesc: typeof compareByResolvedAtDesc;
  getExtensionToken: typeof getExtensionToken;
  isSupportedBinaryExtension: typeof isSupportedBinaryExtension;
  isSupportedTextExtension: typeof isSupportedTextExtension;
  normalizeBootstrapPayload: typeof normalizeBootstrapPayload;
  normalizeDraftPayload: typeof normalizeDraftPayload;
  normalizeResolutionPayload: typeof normalizeResolutionPayload;
  normalizeSessionPayload: typeof normalizeSessionPayload;
};

export default _default;
