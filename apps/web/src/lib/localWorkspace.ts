import {
  MANIFEST_DIR_NAME,
  MANIFEST_FILE_NAME,
  SUPPORTED_BINARY_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS
} from "../constants";
import { isSupportedBinaryExtension, isSupportedTextExtension } from "../../../../packages/core/index.js";
import { createBundleDirectoryName } from "./bundle";
import { isProbablyBinary } from "./encoding";
import { getLanguageMetadata, isMarkdownPath, isPdfPath } from "./language";
import type {
  FileTreeNode,
  OpenDirectoryResult,
  WorkspaceFileSnapshot,
  WorkspaceFileRecord,
  WorkspaceRoot,
  WorkspaceScanFolder
} from "../types";

export interface BrowserWorkspaceLoadResult {
  root: WorkspaceRoot;
  tree: FileTreeNode[];
  files: WorkspaceFileRecord[];
  directoryHandle: FileSystemDirectoryHandle;
  fileHandles: Map<string, FileSystemFileHandle>;
  cancelled: boolean;
  entriesProcessed: number;
  filesLoaded: number;
}

export interface BrowserWorkspaceScanProgress {
  entriesProcessed: number;
  filesLoaded: number;
  currentPath: string;
  folderStack: WorkspaceScanFolder[];
}

interface BrowserProgressReporter {
  notify(currentPath: string, options?: { folderStack?: WorkspaceScanFolder[] }): void;
  tick(currentPath: string, options?: { fileLoaded?: boolean; folderStack?: WorkspaceScanFolder[] }): void;
  flush(): void;
  getSnapshot(): BrowserWorkspaceScanProgress;
}

const BROWSER_PROGRESS_ENTRY_STEP = 32;
const BROWSER_PROGRESS_TIME_STEP_MS = 120;

function createBrowserProgressReporter(
  onProgress: (progress: BrowserWorkspaceScanProgress) => void
): BrowserProgressReporter {
  let entriesProcessed = 0;
  let filesLoaded = 0;
  let entriesSinceEmit = 0;
  let lastEmit = 0;
  let currentPath = "";
  let folderStack: WorkspaceScanFolder[] = [];

  const emit = () => {
    try {
      onProgress({ entriesProcessed, filesLoaded, currentPath, folderStack });
    } catch {
      // Listener failures must not abort the scan.
    }
  };

  const maybeEmit = () => {
    const now = Date.now();
    if (
      entriesSinceEmit >= BROWSER_PROGRESS_ENTRY_STEP ||
      now - lastEmit >= BROWSER_PROGRESS_TIME_STEP_MS
    ) {
      lastEmit = now;
      entriesSinceEmit = 0;
      emit();
    }
  };

  return {
    notify(path, options = {}) {
      currentPath = path;
      folderStack = options.folderStack ?? folderStack;
      entriesProcessed += 1;
      entriesSinceEmit += 1;
      maybeEmit();
    },
    tick(path, options = {}) {
      currentPath = path;
      folderStack = options.folderStack ?? folderStack;
      entriesProcessed += 1;
      entriesSinceEmit += 1;
      if (options?.fileLoaded) {
        filesLoaded += 1;
      }
      maybeEmit();
    },
    flush() {
      emit();
    },
    getSnapshot() {
      return {
        entriesProcessed,
        filesLoaded,
        currentPath,
        folderStack
      };
    }
  };
}

function isWorkspaceScanCancelled(signal?: AbortSignal) {
  return signal?.aborted ?? false;
}

export interface BrowserBundleDirectoryResult {
  name: string;
  directoryHandle: FileSystemDirectoryHandle;
  fileHandles: Map<string, FileSystemFileHandle>;
}

export function supportsBrowserDirectoryPicker() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

function joinPath(parts: string[]) {
  return parts.filter(Boolean).join("/");
}

function isPathWithinFolder(targetPath: string, folderPath: string) {
  return targetPath === folderPath || targetPath.startsWith(`${folderPath}/`);
}

function isPathWithinSkippedFolders(targetPath: string, skippedFolders: string[]) {
  return skippedFolders.some((folderPath) => isPathWithinFolder(targetPath, folderPath));
}

function getWorkspaceRoot(directoryHandle: FileSystemDirectoryHandle): WorkspaceRoot {
  return {
    id: `local-root:${directoryHandle.name}`,
    provider: "local",
    rootId: directoryHandle.name,
    rootPath: directoryHandle.name,
    displayName: directoryHandle.name,
    kind: "local-root"
  };
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .map((node) =>
      node.kind === "directory"
        ? {
            ...node,
            children: sortTree(node.children ?? [])
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

function shouldUseElectronLocalIdsFromSnapshots(root: WorkspaceRoot, snapshots: WorkspaceFileSnapshot[]) {
  return root.provider === "local" && snapshots.some((snapshot) => typeof snapshot.absolutePath === "string");
}

function shouldUseElectronLocalIdsFromFiles(root: WorkspaceRoot, files: WorkspaceFileRecord[]) {
  return root.provider === "local" && files.some((file) => file.id === `local:${file.path}`);
}

function getTreeNodeId(root: WorkspaceRoot, relativePath: string, useElectronLocalIds: boolean) {
  return useElectronLocalIds ? `local:${relativePath}` : `${root.id}:${relativePath}`;
}

export function buildTreeFromSnapshots(root: WorkspaceRoot, snapshots: WorkspaceFileSnapshot[]): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = [];
  const directoryMap = new Map<string, FileTreeNode>();
  const useElectronLocalIds = shouldUseElectronLocalIdsFromSnapshots(root, snapshots);

  const ensureDirectory = (relativePath: string) => {
    const existing = directoryMap.get(relativePath);
    if (existing) {
      return existing;
    }

    const name = relativePath.split("/").at(-1) ?? relativePath;
    const node: FileTreeNode = {
      id: getTreeNodeId(root, relativePath, useElectronLocalIds),
      provider: root.provider,
      kind: "directory",
      name,
      path: relativePath,
      absolutePath: root.rootPath ? `${root.rootPath}/${relativePath}`.replaceAll("\\", "/") : undefined,
      children: []
    };
    directoryMap.set(relativePath, node);

    const parentPath = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
    if (!parentPath) {
      rootNodes.push(node);
      return node;
    }

    const parent = ensureDirectory(parentPath);
    parent.children = [...(parent.children ?? []), node];
    return node;
  };

  for (const snapshot of snapshots) {
    const parentPath = snapshot.path.includes("/") ? snapshot.path.slice(0, snapshot.path.lastIndexOf("/")) : "";
    const fileNode: FileTreeNode = {
      id: getTreeNodeId(root, snapshot.path, useElectronLocalIds),
      provider: root.provider,
      kind: "file",
      name: snapshot.path.split("/").at(-1) ?? snapshot.path,
      path: snapshot.path,
      absolutePath: snapshot.absolutePath,
      modifiedAt: snapshot.modifiedAt,
      size: snapshot.size
    };

    if (!parentPath) {
      rootNodes.push(fileNode);
      continue;
    }

    const parent = ensureDirectory(parentPath);
    parent.children = [...(parent.children ?? []), fileNode];
  }

  return sortTree(rootNodes);
}

export function buildTreeFromFiles(root: WorkspaceRoot, files: WorkspaceFileRecord[]): FileTreeNode[] {
  const rootNodes: FileTreeNode[] = [];
  const directoryMap = new Map<string, FileTreeNode>();
  const useElectronLocalIds = shouldUseElectronLocalIdsFromFiles(root, files);

  const ensureDirectory = (relativePath: string) => {
    const existing = directoryMap.get(relativePath);
    if (existing) {
      return existing;
    }

    const name = relativePath.split("/").at(-1) ?? relativePath;
    const node: FileTreeNode = {
      id: getTreeNodeId(root, relativePath, useElectronLocalIds),
      provider: root.provider,
      kind: "directory",
      name,
      path: relativePath,
      absolutePath: root.rootPath ? `${root.rootPath}/${relativePath}`.replaceAll("\\", "/") : undefined,
      children: []
    };
    directoryMap.set(relativePath, node);

    const parentPath = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
    if (!parentPath) {
      rootNodes.push(node);
      return node;
    }

    const parent = ensureDirectory(parentPath);
    parent.children = [...(parent.children ?? []), node];
    return node;
  };

  for (const file of files) {
    const parentPath = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const fileNode: FileTreeNode = {
      id: file.id,
      provider: root.provider,
      kind: "file",
      name: file.name,
      path: file.path,
      absolutePath: file.absolutePath,
      modifiedAt: file.modifiedAt,
      size: file.size,
      unavailable: file.unavailable
    };

    if (!parentPath) {
      rootNodes.push(fileNode);
      continue;
    }

    const parent = ensureDirectory(parentPath);
    parent.children = [...(parent.children ?? []), fileNode];
  }

  return sortTree(rootNodes);
}

export function flattenTreeToWorkspaceFiles(root: WorkspaceRoot, tree: FileTreeNode[]): WorkspaceFileRecord[] {
  const files: WorkspaceFileRecord[] = [];

  const visit = (node: FileTreeNode) => {
    if (node.kind === "directory") {
      node.children?.forEach(visit);
      return;
    }

    const metadata = getLanguageMetadata(node.path);
    const pdf = isPdfPath(node.path);
    const modifiedAt = node.modifiedAt ?? new Date().toISOString();
    const size = node.size ?? 0;

    files.push({
      id: node.id,
      workspaceId: root.id,
      path: node.path,
      name: node.name,
      provider: root.provider,
      language: pdf ? "PDF" : metadata.label,
      size,
      modifiedAt,
      lastSyncedModifiedAt: modifiedAt,
      lastSyncedSize: size,
      foreignDrafts: [],
      pendingForeignDraftCount: 0,
      absolutePath: node.absolutePath,
      isMarkdown: !pdf && Boolean(metadata.markdown ?? isMarkdownPath(node.path)),
      isPdf: pdf
    });
  };

  tree.forEach(visit);
  return files;
}

const MAX_BROWSER_SCAN_DEPTH = 64;

async function walkBrowserDirectoryMetadata(
  root: WorkspaceRoot,
  directoryHandle: FileSystemDirectoryHandle,
  pathParts: string[],
  folderStack: WorkspaceScanFolder[],
  fileHandles: Map<string, FileSystemFileHandle>,
  progress: BrowserProgressReporter,
  signal?: AbortSignal,
  shouldSkipFolder?: (relativePath: string) => boolean,
  skippedFolders?: Set<string>,
  depth = 0
): Promise<{ nodes: FileTreeNode[]; cancelled: boolean; skipped: boolean }> {
  const nodes: FileTreeNode[] = [];
  const values = directoryHandle.values?.bind(directoryHandle);
  const currentRelativePath = joinPath(pathParts);
  let skipped = false;

  if (!values) {
    throw new Error("Directory iteration is not available in this browser.");
  }

  if (depth > MAX_BROWSER_SCAN_DEPTH) {
    return {
      nodes: [],
      cancelled: false,
      skipped: true
    };
  }

  if (currentRelativePath && shouldSkipFolder?.(currentRelativePath)) {
    skippedFolders?.add(currentRelativePath);
    return {
      nodes: [],
      cancelled: false,
      skipped: true
    };
  }

  let cancelled = false;

  for await (const entry of values()) {
    if (isWorkspaceScanCancelled(signal)) {
      cancelled = true;
      break;
    }

    if (currentRelativePath && shouldSkipFolder?.(currentRelativePath)) {
      skippedFolders?.add(currentRelativePath);
      skipped = true;
      break;
    }

    const relativePath = joinPath([...pathParts, entry.name]);

    if (entry.name === MANIFEST_DIR_NAME || entry.name === MANIFEST_FILE_NAME) {
      continue;
    }

    if (entry.kind === "directory") {
      const childFolderStack = [
        ...folderStack,
        {
          path: relativePath,
          name: entry.name,
          enteredAtMs: Date.now()
        }
      ];
      progress.notify(relativePath, { folderStack: childFolderStack });

      if (shouldSkipFolder?.(relativePath)) {
        skippedFolders?.add(relativePath);
        continue;
      }

      const childResult = await walkBrowserDirectoryMetadata(
        root,
        entry as FileSystemDirectoryHandle,
        [...pathParts, entry.name],
        childFolderStack,
        fileHandles,
        progress,
        signal,
        shouldSkipFolder,
        skippedFolders,
        depth + 1
      );

      if (childResult.skipped && childResult.nodes.length === 0) {
        continue;
      }

      if (childResult.nodes.length > 0 || !childResult.cancelled) {
        nodes.push({
          id: `${root.id}:${relativePath}`,
          provider: root.provider,
          kind: "directory",
          name: entry.name,
          path: relativePath,
          children: childResult.nodes
        });
      }

      if (childResult.cancelled) {
        cancelled = true;
        break;
      }

      continue;
    }

    const extension = relativePath.split(".").at(-1)?.toLowerCase() ?? "";
    const isText = isSupportedTextExtension(extension);
    const isBinary = isSupportedBinaryExtension(extension);
    if (!isText && !isBinary) {
      progress.tick(relativePath, { folderStack });
      continue;
    }

    if (isWorkspaceScanCancelled(signal)) {
      cancelled = true;
      break;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    if (isWorkspaceScanCancelled(signal)) {
      cancelled = true;
      break;
    }

    fileHandles.set(relativePath, fileHandle);

    nodes.push({
      id: `${root.id}:${relativePath}`,
      provider: root.provider,
      kind: "file",
      name: entry.name,
      path: relativePath,
      size: file.size,
      modifiedAt: new Date(file.lastModified).toISOString()
    });
    progress.tick(relativePath, {
      fileLoaded: true,
      folderStack
    });

    if (isWorkspaceScanCancelled(signal)) {
      cancelled = true;
      break;
    }
  }

  if (skipped) {
    return {
      nodes: [],
      cancelled,
      skipped: true
    };
  }

  return {
    nodes: sortTree(nodes),
    cancelled,
    skipped
  };
}

async function walkBrowserDirectoryForSnapshots(
  directoryHandle: FileSystemDirectoryHandle,
  pathParts: string[],
  fileHandles: Map<string, FileSystemFileHandle>,
  skippedFolders: string[] = [],
  depth = 0
): Promise<WorkspaceFileSnapshot[]> {
  const snapshots: WorkspaceFileSnapshot[] = [];
  const values = directoryHandle.values?.bind(directoryHandle);
  const currentRelativePath = joinPath(pathParts);

  if (!values) {
    throw new Error("Directory iteration is not available in this browser.");
  }

  if (depth > MAX_BROWSER_SCAN_DEPTH) {
    return snapshots;
  }

  if (
    currentRelativePath &&
    skippedFolders.some((folderPath) => isPathWithinFolder(currentRelativePath, folderPath))
  ) {
    return snapshots;
  }

  for await (const entry of values()) {
    const relativePath = joinPath([...pathParts, entry.name]);

    if (entry.name === MANIFEST_DIR_NAME || entry.name === MANIFEST_FILE_NAME) {
      continue;
    }

    if (entry.kind === "directory") {
      if (skippedFolders.some((folderPath) => isPathWithinFolder(relativePath, folderPath))) {
        continue;
      }

      snapshots.push(...(await walkBrowserDirectoryForSnapshots(
        entry as FileSystemDirectoryHandle,
        [...pathParts, entry.name],
        fileHandles,
        skippedFolders,
        depth + 1
      )));
      continue;
    }

    const extension = relativePath.split(".").at(-1)?.toLowerCase() ?? "";
    if (!isSupportedTextExtension(extension) && !isSupportedBinaryExtension(extension)) {
      continue;
    }

    const fileHandle = entry as FileSystemFileHandle;
    const file = await fileHandle.getFile();
    fileHandles.set(relativePath, fileHandle);
    snapshots.push({
      path: relativePath,
      modifiedAt: new Date(file.lastModified).toISOString(),
      size: file.size,
      exists: true
    });
  }

  return snapshots.sort((left, right) => left.path.localeCompare(right.path));
}

export async function loadBrowserWorkspaceFromHandle(
  directoryHandle: FileSystemDirectoryHandle,
  options: {
    onProgress?: (progress: BrowserWorkspaceScanProgress) => void;
    signal?: AbortSignal;
    shouldSkipFolder?: (relativePath: string) => boolean;
  } = {}
): Promise<BrowserWorkspaceLoadResult> {
  const root = getWorkspaceRoot(directoryHandle);
  const fileHandles = new Map<string, FileSystemFileHandle>();
  const progress = createBrowserProgressReporter(options.onProgress ?? (() => {}));
  const skippedFolders = new Set<string>();
  const walkResult = await walkBrowserDirectoryMetadata(
    root,
    directoryHandle,
    [],
    [],
    fileHandles,
    progress,
    options.signal,
    options.shouldSkipFolder,
    skippedFolders
  );
  progress.flush();
  const snapshot = progress.getSnapshot();
  const tree = walkResult.nodes;
  const files = flattenTreeToWorkspaceFiles(root, tree);
  const nextRoot: WorkspaceRoot = {
    ...root,
    skippedFolders: [...skippedFolders].sort()
  };

  return {
    root: nextRoot,
    tree,
    files,
    directoryHandle,
    fileHandles,
    cancelled: walkResult.cancelled || isWorkspaceScanCancelled(options.signal),
    entriesProcessed: snapshot.entriesProcessed,
    filesLoaded: snapshot.filesLoaded
  };
}

export async function openBrowserWorkspace(
  options: {
    onProgress?: (progress: BrowserWorkspaceScanProgress) => void;
    signal?: AbortSignal;
    shouldSkipFolder?: (relativePath: string) => boolean;
  } = {}
): Promise<BrowserWorkspaceLoadResult | null> {
  if (!supportsBrowserDirectoryPicker()) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const picker = window.showDirectoryPicker;
  if (!picker) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const directoryHandle = await picker();
  return loadBrowserWorkspaceFromHandle(directoryHandle, options);
}

export async function scanBrowserWorkspace(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  skippedFolders: string[] = []
): Promise<WorkspaceFileSnapshot[]> {
  return walkBrowserDirectoryForSnapshots(directoryHandle, [], fileHandles, skippedFolders);
}

export function pruneWorkspaceTreeForSkippedFolders(nodes: FileTreeNode[], skippedFolders: string[]): FileTreeNode[] {
  if (skippedFolders.length === 0) {
    return nodes;
  }

  return nodes.flatMap((node) => {
    if (isPathWithinSkippedFolders(node.path, skippedFolders)) {
      return [];
    }

    if (node.kind === "directory") {
      const children = pruneWorkspaceTreeForSkippedFolders(node.children ?? [], skippedFolders);
      if (children.length === 0) {
        return [];
      }

      return [{ ...node, children }];
    }

    return [node];
  });
}

export function inflateElectronWorkspace(result: OpenDirectoryResult) {
  const tree = annotateAbsolutePaths(result.tree, result.rootPath ?? "");
  return {
    root: result,
    tree,
    files: flattenTreeToWorkspaceFiles(result, tree)
  };
}

export async function createBrowserBundleDirectory(displayName: string): Promise<BrowserBundleDirectoryResult | null> {
  if (!supportsBrowserDirectoryPicker()) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const picker = window.showDirectoryPicker;
  if (!picker) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const parentHandle = await picker();
  const directoryHandle = await parentHandle.getDirectoryHandle(createBundleDirectoryName(displayName), { create: true });

  return {
    name: directoryHandle.name,
    directoryHandle,
    fileHandles: new Map()
  };
}

export async function openBrowserBundleDirectory(): Promise<BrowserBundleDirectoryResult | null> {
  if (!supportsBrowserDirectoryPicker()) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const picker = window.showDirectoryPicker;
  if (!picker) {
    throw new Error("The File System Access API is not available in this browser.");
  }

  const directoryHandle = await picker();
  return {
    name: directoryHandle.name,
    directoryHandle,
    fileHandles: new Map()
  };
}

function annotateAbsolutePaths(tree: FileTreeNode[], rootPath: string): FileTreeNode[] {
  return tree.map((node) => {
    if (node.kind === "directory") {
      return {
        ...node,
        absolutePath: `${rootPath}/${node.path}`.replaceAll("\\", "/"),
        children: annotateAbsolutePaths(node.children ?? [], rootPath)
      };
    }

    return {
      ...node,
      absolutePath: `${rootPath}/${node.path}`.replaceAll("\\", "/")
    };
  });
}

async function resolveBrowserFileHandle(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  relativePath: string,
  options: { create?: boolean } = {}
) {
  const cached = fileHandles.get(relativePath);
  if (cached) {
    return cached;
  }

  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();

  if (!fileName) {
    throw new Error("Invalid relative path.");
  }

  let currentDirectory = directoryHandle;
  for (const segment of segments) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment, { create: Boolean(options.create) });
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName, { create: Boolean(options.create) });
  fileHandles.set(relativePath, fileHandle);
  return fileHandle;
}

export async function getBrowserFileSnapshot(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  relativePath: string
): Promise<WorkspaceFileSnapshot | null> {
  try {
    const fileHandle = await resolveBrowserFileHandle(directoryHandle, fileHandles, relativePath);
    const file = await fileHandle.getFile();
    return {
      path: relativePath,
      modifiedAt: new Date(file.lastModified).toISOString(),
      size: file.size,
      exists: true
    };
  } catch {
    return null;
  }
}

export async function writeBrowserTextFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  relativePath: string,
  content: string
) {
  const fileHandle = await resolveBrowserFileHandle(directoryHandle, fileHandles, relativePath, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();

  const file = await fileHandle.getFile();
  return {
    modifiedAt: new Date(file.lastModified).toISOString(),
    size: file.size
  };
}

export async function writeBrowserJson(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  relativePath: string,
  payload: unknown
) {
  return writeBrowserTextFile(directoryHandle, fileHandles, relativePath, JSON.stringify(payload, null, 2));
}

export async function readBrowserJson<T>(directoryHandle: FileSystemDirectoryHandle, relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();

  if (!fileName) {
    throw new Error("Invalid relative path.");
  }

  let currentDirectory = directoryHandle;
  for (const segment of segments) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment);
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return JSON.parse(await file.text()) as T;
}

export async function readBrowserBinaryFile(
  directoryHandle: FileSystemDirectoryHandle,
  fileHandles: Map<string, FileSystemFileHandle>,
  relativePath: string
): Promise<Blob> {
  const fileHandle = await resolveBrowserFileHandle(directoryHandle, fileHandles, relativePath);
  return fileHandle.getFile();
}

export async function readBrowserText(directoryHandle: FileSystemDirectoryHandle, relativePath: string) {
  const segments = relativePath.split("/").filter(Boolean);
  const fileName = segments.pop();

  if (!fileName) {
    throw new Error("Invalid relative path.");
  }

  let currentDirectory = directoryHandle;
  for (const segment of segments) {
    currentDirectory = await currentDirectory.getDirectoryHandle(segment);
  }

  const fileHandle = await currentDirectory.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const sampleBytes =
    typeof file.slice === "function"
      ? await file.slice(0, 4096).arrayBuffer()
      : await file.arrayBuffer();
  if (isProbablyBinary(new Uint8Array(sampleBytes))) {
    throw new Error(`"${relativePath}" appears to be binary and cannot be opened as text.`);
  }
  return file.text();
}
