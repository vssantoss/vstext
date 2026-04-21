import { BUNDLE_DIRECTORY_SUFFIX, MANIFEST_DIR_NAME, MANIFEST_FILE_NAME } from "../constants";
import type { LocalWorkspaceReference, WorkspaceReference } from "../types";

const INVALID_BUNDLE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_DEVICE_HINTS = 8;

export function getBundleManifestPath() {
  return MANIFEST_FILE_NAME;
}

export function getBundleDraftFolderPath() {
  return `${MANIFEST_DIR_NAME}/drafts`;
}

export function getBundleResolutionFolderPath(documentKey?: string) {
  return documentKey ? `${MANIFEST_DIR_NAME}/resolutions/${documentKey}` : `${MANIFEST_DIR_NAME}/resolutions`;
}

export function getBundleSessionFolderPath(deviceId?: string) {
  return deviceId ? `${MANIFEST_DIR_NAME}/sessions/${deviceId}` : `${MANIFEST_DIR_NAME}/sessions`;
}

export function createBundleDirectoryName(displayName: string) {
  const normalized = displayName
    .replace(INVALID_BUNDLE_NAME, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[-. ]+$/g, "");

  const safeName = normalized || "workspace";
  return safeName.endsWith(BUNDLE_DIRECTORY_SUFFIX) ? safeName : `${safeName}${BUNDLE_DIRECTORY_SUFFIX}`;
}

export function createBrowserLocalWorkspaceReference(displayName: string): LocalWorkspaceReference {
  return {
    kind: "local",
    provider: "local",
    displayName,
    deviceHints: []
  };
}

export function isLocalWorkspaceReference(reference: WorkspaceReference): reference is LocalWorkspaceReference {
  return reference.kind === "local";
}

export function getDeviceWorkspaceHint(reference: LocalWorkspaceReference, deviceId: string) {
  return reference.deviceHints.find((hint) => hint.deviceId === deviceId);
}

export function mergeDeviceWorkspaceHint(
  reference: LocalWorkspaceReference,
  deviceId: string,
  absolutePath: string
): LocalWorkspaceReference {
  const nextHints = [
    {
      deviceId,
      absolutePath,
      updatedAt: new Date().toISOString()
    },
    ...reference.deviceHints.filter((hint) => hint.deviceId !== deviceId && hint.absolutePath !== absolutePath)
  ].slice(0, MAX_DEVICE_HINTS);

  return {
    ...reference,
    deviceHints: nextHints
  };
}
