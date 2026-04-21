export const MANIFEST_FILE_NAME = "vstext.json";
export const MANIFEST_DIR_NAME = "vstext";
export const SUPPORTED_TEXT_EXTENSIONS = Object.freeze([
  "txt",
  "md",
  "markdown",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "py",
  "sh",
  "ini",
  "toml",
  "csv"
]);
export const SUPPORTED_BINARY_EXTENSIONS = Object.freeze(["pdf"]);

const textExtensionSet = new Set(SUPPORTED_TEXT_EXTENSIONS);
const binaryExtensionSet = new Set(SUPPORTED_BINARY_EXTENSIONS);

export function getExtensionToken(input) {
  if (typeof input !== "string") {
    return "";
  }

  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  if (!normalized.includes("/") && !normalized.includes("\\") && !normalized.includes(".")) {
    return normalized;
  }

  const lastSeparator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  const lastDot = normalized.lastIndexOf(".");
  const ext = lastDot > lastSeparator ? normalized.slice(lastDot) : "";
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

export function isSupportedTextExtension(input) {
  return textExtensionSet.has(getExtensionToken(input));
}

export function isSupportedBinaryExtension(input) {
  return binaryExtensionSet.has(getExtensionToken(input));
}

export function compareByUpdatedAtDesc(left, right) {
  return right.updatedAt.localeCompare(left.updatedAt) || right.revisionId.localeCompare(left.revisionId);
}

export function compareByResolvedAtDesc(left, right) {
  return right.resolvedAt.localeCompare(left.resolvedAt) || right.revisionId.localeCompare(left.revisionId);
}

function sanitizeWorkspaceReference(reference) {
  if (!reference || typeof reference !== "object" || reference.kind !== "local") {
    return reference;
  }

  return {
    ...reference,
    deviceHints: []
  };
}

function getRevisionIdFromPath(relativePath, suffixPattern) {
  const basename = relativePath.split("/").at(-1) ?? relativePath;
  return basename.replace(suffixPattern, "");
}

export function normalizeBootstrapPayload(payload, fallbackDisplayName = "") {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const value = payload;
  if (typeof value.workspaceId !== "string" || !value.workspaceRef) {
    return undefined;
  }

  return {
    version: typeof value.version === "number" ? value.version : 3,
    bundleFormat: value.bundleFormat === "multi-device-v1" ? value.bundleFormat : "multi-device-v1",
    workspaceId: value.workspaceId,
    displayName: typeof value.displayName === "string" ? value.displayName : fallbackDisplayName,
    workspaceRef: sanitizeWorkspaceReference(value.workspaceRef)
  };
}

export function normalizeSessionPayload(payload, relativePath) {
  if (!payload || typeof payload !== "object" || typeof payload.deviceId !== "string") {
    return null;
  }

  const value = payload;

  return {
    revisionId:
      typeof value.revisionId === "string"
        ? value.revisionId
        : getRevisionIdFromPath(relativePath, /\.session\.json$/i),
    deviceId: value.deviceId,
    deviceName: typeof value.deviceName === "string" ? value.deviceName : value.deviceId,
    workspacePath: typeof value.workspacePath === "string" ? value.workspacePath : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    openTabs: Array.isArray(value.openTabs) ? value.openTabs.filter((entry) => typeof entry === "string") : [],
    activeTab: typeof value.activeTab === "string" ? value.activeTab : null,
    layout: value.layout ?? {},
    sidebarState: value.sidebarState ?? {},
    searchState: value.searchState ?? {},
    cursorState: value.cursorState ?? {},
    themeMode: value.themeMode ?? "system"
  };
}

export function normalizeDraftPayload(payload, relativePath) {
  if (!payload || typeof payload !== "object" || typeof payload.deviceId !== "string" || typeof payload.path !== "string") {
    return null;
  }

  const value = payload;

  return {
    revisionId:
      typeof value.revisionId === "string"
        ? value.revisionId
        : getRevisionIdFromPath(relativePath, /\.draft\.json$/i),
    fileId: typeof value.fileId === "string" ? value.fileId : undefined,
    path: value.path,
    deviceId: value.deviceId,
    deviceName: typeof value.deviceName === "string" ? value.deviceName : value.deviceId,
    baseRemoteRevision: typeof value.baseRemoteRevision === "string" ? value.baseRemoteRevision : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    blobPath: relativePath,
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    deleted: Boolean(value.deleted)
  };
}

export function normalizeResolutionPayload(payload, relativePath) {
  if (!payload || typeof payload !== "object" || typeof payload.path !== "string") {
    return null;
  }

  const value = payload;

  return {
    revisionId:
      typeof value.revisionId === "string"
        ? value.revisionId
        : getRevisionIdFromPath(relativePath, /\.resolution\.json$/i),
    path: value.path,
    resolvedAt: typeof value.resolvedAt === "string" ? value.resolvedAt : new Date().toISOString(),
    resolvedByDeviceId: typeof value.resolvedByDeviceId === "string" ? value.resolvedByDeviceId : "",
    resolvedByDeviceName:
      typeof value.resolvedByDeviceName === "string"
        ? value.resolvedByDeviceName
        : typeof value.resolvedByDeviceId === "string"
          ? value.resolvedByDeviceId
          : "",
    clearedDraftRevisionIds: Array.isArray(value.clearedDraftRevisionIds)
      ? value.clearedDraftRevisionIds.filter((entry) => typeof entry === "string")
      : [],
    finalContentHash: typeof value.finalContentHash === "string" ? value.finalContentHash : "",
    blobPath: relativePath
  };
}

const core = {
  MANIFEST_FILE_NAME,
  MANIFEST_DIR_NAME,
  SUPPORTED_TEXT_EXTENSIONS,
  SUPPORTED_BINARY_EXTENSIONS,
  compareByUpdatedAtDesc,
  compareByResolvedAtDesc,
  getExtensionToken,
  isSupportedBinaryExtension,
  isSupportedTextExtension,
  normalizeBootstrapPayload,
  normalizeDraftPayload,
  normalizeResolutionPayload,
  normalizeSessionPayload
};

export default core;
