import type { BrowserBundleDirectoryResult } from "./localWorkspace";
import {
  MANIFEST_DIR_NAME,
  MANIFEST_FILE_NAME,
  compareByResolvedAtDesc,
  compareByUpdatedAtDesc,
  normalizeBootstrapPayload,
  normalizeDraftPayload,
  normalizeResolutionPayload,
  normalizeSessionPayload
} from "../../../../packages/core/index.js";
import type { BundleBootstrap, BundleScanResult, DeviceSession, DraftRef, DraftResolutionRecord } from "../types";

async function walkJsonFiles(
  directoryHandle: FileSystemDirectoryHandle,
  pathParts: string[] = []
): Promise<Array<{ relativePath: string; payload: unknown }>> {
  const values = directoryHandle.values?.bind(directoryHandle);

  if (!values) {
    throw new Error("Directory iteration is not available in this browser.");
  }

  const files: Array<{ relativePath: string; payload: unknown }> = [];

  for await (const entry of values()) {
    const relativePath = [...pathParts, entry.name].filter(Boolean).join("/");

    if (entry.kind === "directory") {
      files.push(...(await walkJsonFiles(entry as FileSystemDirectoryHandle, [...pathParts, entry.name])));
      continue;
    }

    if (!entry.name.toLowerCase().endsWith(".json")) {
      continue;
    }

    try {
      const file = await (entry as FileSystemFileHandle).getFile();
      files.push({
        relativePath,
        payload: JSON.parse(await file.text())
      });
    } catch {
      continue;
    }
  }

  return files;
}

async function getOptionalDirectory(
  directoryHandle: FileSystemDirectoryHandle,
  ...segments: string[]
): Promise<FileSystemDirectoryHandle | null> {
  try {
    let current = directoryHandle;
    for (const segment of segments) {
      current = await current.getDirectoryHandle(segment);
    }
    return current;
  } catch {
    return null;
  }
}

export async function scanBrowserBundle(bundle: BrowserBundleDirectoryResult): Promise<BundleScanResult> {
  let bootstrap: BundleBootstrap | undefined;

  try {
    const bootstrapHandle = await bundle.directoryHandle.getFileHandle(MANIFEST_FILE_NAME);
    const file = await bootstrapHandle.getFile();
    bootstrap = normalizeBootstrapPayload(JSON.parse(await file.text()), bundle.name) as BundleBootstrap | undefined;
  } catch {
    bootstrap = undefined;
  }

  const latestSessions = new Map<string, DeviceSession>();
  const latestDrafts = new Map<string, DraftRef>();
  const resolutions = new Map<string, DraftResolutionRecord>();

  const sessionDirectory = await getOptionalDirectory(bundle.directoryHandle, MANIFEST_DIR_NAME, "sessions");
  if (sessionDirectory) {
    for (const entry of await walkJsonFiles(sessionDirectory, [MANIFEST_DIR_NAME, "sessions"])) {
      const session = normalizeSessionPayload(entry.payload, entry.relativePath) as DeviceSession | null;
      if (!session) {
        continue;
      }

      const current = latestSessions.get(session.deviceId);
      if (!current || compareByUpdatedAtDesc(current, session) > 0) {
        latestSessions.set(session.deviceId, session);
      }
    }
  }

  const draftDirectory = await getOptionalDirectory(bundle.directoryHandle, MANIFEST_DIR_NAME, "drafts");
  if (draftDirectory) {
    for (const entry of await walkJsonFiles(draftDirectory, [MANIFEST_DIR_NAME, "drafts"])) {
      const draft = normalizeDraftPayload(entry.payload, entry.relativePath) as DraftRef | null;
      if (!draft) {
        continue;
      }

      const key = `${draft.deviceId}::${draft.path}`;
      const current = latestDrafts.get(key);
      if (!current || compareByUpdatedAtDesc(current, draft) > 0) {
        latestDrafts.set(key, draft);
      }
    }
  }

  const resolutionDirectory = await getOptionalDirectory(bundle.directoryHandle, MANIFEST_DIR_NAME, "resolutions");
  if (resolutionDirectory) {
    for (const entry of await walkJsonFiles(resolutionDirectory, [MANIFEST_DIR_NAME, "resolutions"])) {
      const resolution = normalizeResolutionPayload(entry.payload, entry.relativePath) as DraftResolutionRecord | null;
      if (!resolution) {
        continue;
      }

      const current = resolutions.get(resolution.revisionId);
      if (!current || compareByResolvedAtDesc(current, resolution) > 0) {
        resolutions.set(resolution.revisionId, resolution);
      }
    }
  }

  return {
    bootstrap,
    sessions: [...latestSessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    drafts: [...latestDrafts.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    resolutions: [...resolutions.values()].sort(
      (left, right) => right.resolvedAt.localeCompare(left.resolvedAt) || right.revisionId.localeCompare(left.revisionId)
    )
  };
}
