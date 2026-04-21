const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  MANIFEST_DIR_NAME,
  MANIFEST_FILE_NAME,
  SUPPORTED_BINARY_EXTENSIONS,
  SUPPORTED_TEXT_EXTENSIONS,
  compareByResolvedAtDesc,
  compareByUpdatedAtDesc,
  isSupportedTextExtension,
  normalizeBootstrapPayload,
  normalizeDraftPayload,
  normalizeResolutionPayload,
  normalizeSessionPayload
} = require("../../packages/core/index.cjs");

const isDev = !app.isPackaged;
const rendererUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
const distPath = path.join(__dirname, "..", "..", "dist", "apps", "web", "index.html");
const bundleDirectorySuffix = "-vstext";
const manifestFileName = MANIFEST_FILE_NAME;
const manifestDirectoryName = MANIFEST_DIR_NAME;
const maxLoadWarnings = 6;
const scanProgressChannel = "local:open-directory:progress";
const scanProgressEmitEveryEntries = 32;
const scanProgressEmitEveryMs = 120;
const activeOpenDirectoryScans = new Map();
const activeWorkspaceSearches = new Map();
const registeredWorkspaceRoots = new Set();
const registeredBundleRoots = new Set();
const maxWorkspaceScanDepth = 64;
const titleBarOverlayHeight = 32;
const windowThemeChrome = {
  dark: {
    backgroundColor: "#1e1e1e",
    titleBarColor: "#181818",
    titleBarSymbolColor: "#cccccc"
  },
  light: {
    backgroundColor: "#f8f8f8",
    titleBarColor: "#dddddd",
    titleBarSymbolColor: "#3b3b3b"
  }
};

const textExtensions = new Set(SUPPORTED_TEXT_EXTENSIONS.map((extension) => `.${extension}`));
const binaryExtensions = new Set(SUPPORTED_BINARY_EXTENSIONS.map((extension) => `.${extension}`));

function toPosixPath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function getResolvedWindowTheme(theme) {
  return theme === "light" ? "light" : "dark";
}

function getWindowThemeChrome(theme) {
  return windowThemeChrome[getResolvedWindowTheme(theme)];
}

function applyWindowTheme(mainWindow, theme) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const chrome = getWindowThemeChrome(theme);
  mainWindow.setBackgroundColor(chrome.backgroundColor);

  if (process.platform !== "darwin") {
    mainWindow.setTitleBarOverlay({
      color: chrome.titleBarColor,
      symbolColor: chrome.titleBarSymbolColor,
      height: titleBarOverlayHeight
    });
  }
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }

  return "Unknown error";
}

function normalizePath(filePath) {
  return toPosixPath(path.normalize(filePath));
}

function canonicalizeForRegistry(filePath) {
  const resolved = toPosixPath(path.resolve(filePath));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function registerWorkspaceRoot(absolutePath) {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return;
  }
  registeredWorkspaceRoots.add(canonicalizeForRegistry(absolutePath));
}

function registerBundleRoot(absolutePath) {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return;
  }
  registeredBundleRoots.add(canonicalizeForRegistry(absolutePath));
}

function isUnderAnyRegisteredRoot(absolutePath, roots = null) {
  if (typeof absolutePath !== "string" || !absolutePath) {
    return false;
  }
  const canonical = canonicalizeForRegistry(absolutePath);
  const sources = roots ?? [registeredWorkspaceRoots, registeredBundleRoots];
  for (const source of sources) {
    for (const root of source) {
      if (canonical === root || canonical.startsWith(`${root}/`)) {
        return true;
      }
    }
  }
  return false;
}

function assertInsideRegisteredRoot(absolutePath) {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    throw new Error("Path is required.");
  }
  if (!isUnderAnyRegisteredRoot(absolutePath)) {
    throw new Error(`Refused to access path outside the registered workspace: ${absolutePath}`);
  }
  return absolutePath;
}

function isRegisteredWorkspaceRoot(absolutePath) {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return false;
  }
  return registeredWorkspaceRoots.has(canonicalizeForRegistry(absolutePath));
}

function isRegisteredBundleRoot(absolutePath) {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return false;
  }
  return registeredBundleRoots.has(canonicalizeForRegistry(absolutePath));
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getRendererErrorHtml(message, detail = "") {
  const safeMessage = String(message).replace(/[&<>"]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });
  const safeDetail = String(detail).replace(/[&<>"]/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    return "&quot;";
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>VS Text</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", system-ui, sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #161616;
        color: #f3f3f3;
      }
      main {
        width: min(720px, calc(100vw - 48px));
        padding: 24px 28px;
        border: 1px solid #2c2c2c;
        border-radius: 14px;
        background: #1f1f1f;
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: 20px;
      }
      p {
        margin: 0 0 12px;
        line-height: 1.5;
        color: #d1d1d1;
      }
      code, pre {
        font-family: "JetBrains Mono", ui-monospace, Consolas, monospace;
      }
      pre {
        margin: 16px 0 0;
        white-space: pre-wrap;
        word-break: break-word;
        padding: 12px;
        border-radius: 10px;
        background: #111111;
        color: #f7d794;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Renderer failed to load</h1>
      <p>${safeMessage}</p>
      ${safeDetail ? `<pre>${safeDetail}</pre>` : ""}
    </main>
  </body>
</html>`;
}

async function loadRenderer(mainWindow) {
  if (isDev) {
    try {
      await mainWindow.loadURL(rendererUrl);
      return;
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`Failed to load dev renderer at ${rendererUrl}: ${message}`);
    }
  }

  if (await fileExists(distPath)) {
    try {
      await mainWindow.loadFile(distPath);
      return;
    } catch (error) {
      const message = getErrorMessage(error);
      console.error(`Failed to load built renderer from ${distPath}: ${message}`);
      await mainWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(
          getRendererErrorHtml("VS Text could not load the desktop renderer.", `${distPath}\n${message}`)
        )}`
      );
      return;
    }
  }

  await mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(
      getRendererErrorHtml(
        "VS Text could not find a renderer to load.",
        `Dev URL: ${rendererUrl}\nBuilt file: ${distPath}\nRun pnpm build:web or start pnpm dev:desktop.`
      )
    )}`
  );
}

function sanitizeBundleName(name) {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim().replace(/[-. ]+$/g, "");
  const safeName = cleaned || "workspace";
  return safeName.endsWith(bundleDirectorySuffix) ? safeName : `${safeName}${bundleDirectorySuffix}`;
}

async function ensureDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);

    if (!stat.isDirectory()) {
      throw new Error("The selected workspace bundle path is not a directory.");
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      await fs.mkdir(targetPath, { recursive: true });
      return;
    }

    throw error;
  }
}

function shouldSkipWorkspaceEntry(entry) {
  return (
    entry.name === manifestDirectoryName ||
    entry.name === manifestFileName ||
    entry.isSymbolicLink()
  );
}

function isPathWithinFolder(targetPath, folderPath) {
  return targetPath === folderPath || targetPath.startsWith(`${folderPath}/`);
}

function createOpenDirectoryScanState(scanId) {
  if (typeof scanId !== "string" || !scanId.trim()) {
    return {
      scanId: null,
      skippedFolders: new Set(),
      isCancelled() {
        return false;
      },
      shouldSkipFolder() {
        return false;
      },
      dispose() {}
    };
  }

  const state = {
    scanId,
    cancelled: false,
    skippedFolders: new Set(),
    isCancelled() {
      return state.cancelled;
    },
    shouldSkipFolder(targetPath) {
      if (typeof targetPath !== "string" || !targetPath) {
        return false;
      }

      for (const skippedFolder of state.skippedFolders) {
        if (isPathWithinFolder(targetPath, skippedFolder)) {
          return true;
        }
      }

      return false;
    },
    dispose() {
      activeOpenDirectoryScans.delete(scanId);
    }
  };

  activeOpenDirectoryScans.set(scanId, state);
  return state;
}

async function walkDirectory(rootPath, currentPath, progress, scanState, folderStack = [], depth = 0) {
  const resolvedCurrent = currentPath ?? rootPath;
  const currentRelativePath = toPosixPath(path.relative(rootPath, resolvedCurrent));
  let skipped = false;

  if (depth > maxWorkspaceScanDepth) {
    return {
      tree: [],
      loadWarnings: [`${currentRelativePath} (max depth exceeded)`],
      skippedEntryCount: 1,
      cancelled: false,
      skipped: true
    };
  }

  if (currentRelativePath && scanState?.shouldSkipFolder(currentRelativePath)) {
    return {
      tree: [],
      loadWarnings: [],
      skippedEntryCount: 0,
      cancelled: false,
      skipped: true
    };
  }

  const entries = await fs.readdir(resolvedCurrent, { withFileTypes: true });
  const files = [];
  const warnings = [];
  let skippedEntryCount = 0;
  let cancelled = false;

  for (const entry of entries) {
    if (scanState?.isCancelled()) {
      cancelled = true;
      break;
    }

    if (currentRelativePath && scanState?.shouldSkipFolder(currentRelativePath)) {
      skipped = true;
      break;
    }

    if (shouldSkipWorkspaceEntry(entry)) {
      continue;
    }

    const absolutePath = path.join(resolvedCurrent, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    try {
      if (entry.isDirectory()) {
        const childFolderStack = [
          ...folderStack,
          {
            path: relativePath,
            name: entry.name,
            enteredAtMs: Date.now()
          }
        ];

        if (progress) {
          progress.notify(relativePath, { folderStack: childFolderStack });
        }

        if (scanState?.shouldSkipFolder(relativePath)) {
          continue;
        }

        const childResult = await walkDirectory(rootPath, absolutePath, progress, scanState, childFolderStack, depth + 1);
        if (childResult.skipped && childResult.tree.length === 0) {
          continue;
        }

        if (childResult.tree.length > 0 || !childResult.cancelled) {
          files.push({
            id: `local:${relativePath}`,
            name: entry.name,
            path: relativePath,
            kind: "directory",
            provider: "local",
            children: childResult.tree
          });
        }
        warnings.push(...childResult.loadWarnings);
        skippedEntryCount += childResult.skippedEntryCount;

        if (childResult.cancelled) {
          cancelled = true;
          break;
        }

        continue;
      }

      const fileExtension = path.extname(entry.name).toLowerCase();
      const isTextFile = textExtensions.has(fileExtension);
      const isBinaryFile = binaryExtensions.has(fileExtension);
      if (!isTextFile && !isBinaryFile) {
        if (progress) {
          progress.tick(relativePath, { folderStack });
        }
        continue;
      }

      if (scanState?.isCancelled()) {
        cancelled = true;
        break;
      }

      const stat = await fs.stat(absolutePath);
      if (scanState?.isCancelled()) {
        cancelled = true;
        break;
      }

      files.push({
        id: `local:${relativePath}`,
        name: entry.name,
        path: relativePath,
        kind: "file",
        provider: "local",
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      });
      if (progress) {
        progress.tick(relativePath, { fileLoaded: true, folderStack });
      }

      if (scanState?.isCancelled()) {
        cancelled = true;
        break;
      }
    } catch (error) {
      const warning = `${relativePath} (${getErrorMessage(error)})`;
      console.warn(`Skipped workspace entry: ${absolutePath} (${getErrorMessage(error)})`);
      skippedEntryCount += 1;

      if (warnings.length < maxLoadWarnings) {
        warnings.push(warning);
      }
    }
  }

  const tree = files.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });

  return {
    tree,
    loadWarnings: warnings.slice(0, maxLoadWarnings),
    skippedEntryCount,
    cancelled,
    skipped
  };
}

async function scanDirectoryMetadata(rootPath, currentPath, depth = 0) {
  const resolvedCurrent = currentPath ?? rootPath;
  if (depth > maxWorkspaceScanDepth) {
    return [];
  }
  const entries = await fs.readdir(resolvedCurrent, { withFileTypes: true });
  const snapshots = [];

  for (const entry of entries) {
    if (shouldSkipWorkspaceEntry(entry)) {
      continue;
    }

    const absolutePath = path.join(resolvedCurrent, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    try {
      if (entry.isDirectory()) {
        snapshots.push(...(await scanDirectoryMetadata(rootPath, absolutePath, depth + 1)));
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (!textExtensions.has(extension) && !binaryExtensions.has(extension)) {
        continue;
      }

      const stat = await fs.stat(absolutePath);
      snapshots.push({
        path: relativePath,
        absolutePath: normalizePath(absolutePath),
        modifiedAt: stat.mtime.toISOString(),
        size: stat.size,
        exists: true
      });
    } catch {
      continue;
    }
  }

  return snapshots.sort((left, right) => left.path.localeCompare(right.path));
}

function createWorkspaceSearchState(requestId) {
  if (typeof requestId !== "string" || !requestId.trim()) {
    return {
      requestId: null,
      cancelled: false,
      isCancelled() {
        return false;
      },
      dispose() {}
    };
  }

  const state = {
    requestId,
    cancelled: false,
    isCancelled() {
      return state.cancelled;
    },
    dispose() {
      activeWorkspaceSearches.delete(requestId);
    }
  };

  activeWorkspaceSearches.set(requestId, state);
  return state;
}

function createWorkspaceSearchResult(relativePath, content, query) {
  const title = path.basename(relativePath);
  const haystack = `${title}\n${relativePath}\n${content}`;
  const lowerHaystack = haystack.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerHaystack.indexOf(lowerQuery);

  if (index === -1) {
    return null;
  }

  const contentIndex = content.toLowerCase().indexOf(lowerQuery);
  const snippet =
    contentIndex === -1
      ? ""
      : content
          .slice(Math.max(0, contentIndex - 32), Math.min(content.length, contentIndex + lowerQuery.length + 64))
          .replace(/\s+/g, " ")
          .trim();
  const titleBoost = title.toLowerCase().includes(lowerQuery) ? 40 : 0;
  const pathBoost = relativePath.toLowerCase().includes(lowerQuery) ? 20 : 0;

  return {
    documentId: relativePath,
    path: relativePath,
    title,
    snippet,
    score: 100 - index + titleBoost + pathBoost,
    indexedAt: new Date().toISOString()
  };
}

async function searchDirectory(rootPath, currentPath, query, limit, searchState, results = [], depth = 0) {
  if (searchState?.isCancelled()) {
    return results;
  }

  if (depth > maxWorkspaceScanDepth) {
    return results;
  }

  const resolvedCurrent = currentPath ?? rootPath;
  const entries = await fs.readdir(resolvedCurrent, { withFileTypes: true });

  for (const entry of entries) {
    if (searchState?.isCancelled() || results.length >= limit) {
      break;
    }

    if (shouldSkipWorkspaceEntry(entry)) {
      continue;
    }

    const absolutePath = path.join(resolvedCurrent, entry.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    try {
      if (entry.isDirectory()) {
        await searchDirectory(rootPath, absolutePath, query, limit, searchState, results, depth + 1);
        continue;
      }

      if (!isSupportedTextExtension(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const content = await fs.readFile(absolutePath, "utf8");
      const result = createWorkspaceSearchResult(relativePath, content, query);
      if (result) {
        results.push(result);
      }
    } catch {
      continue;
    }
  }

  return results;
}

async function searchWorkspace(rootPath, query, limit, searchState) {
  const normalizedQuery = typeof query === "string" ? query.trim() : "";
  if (!normalizedQuery) {
    return [];
  }

  const results = await searchDirectory(rootPath, rootPath, normalizedQuery, limit, searchState, []);
  return results.sort((left, right) => right.score - left.score).slice(0, limit);
}

function createProgressReporter(sender, scanId) {
  let entriesProcessed = 0;
  let filesLoaded = 0;
  let entriesSinceEmit = 0;
  let lastEmitTime = 0;
  let latestPath = "";
  let folderStack = [];

  const emit = () => {
    if (!sender || sender.isDestroyed?.()) {
      return;
    }

    try {
      sender.send(scanProgressChannel, {
        scanId,
        phase: "scanning",
        entriesProcessed,
        filesLoaded,
        currentPath: latestPath,
        folderStack
      });
    } catch {
      // Renderer may have closed mid-scan — ignore.
    }
  };

  const maybeEmit = () => {
    const now = Date.now();
    if (
      entriesSinceEmit >= scanProgressEmitEveryEntries ||
      now - lastEmitTime >= scanProgressEmitEveryMs
    ) {
      lastEmitTime = now;
      entriesSinceEmit = 0;
      emit();
    }
  };

  return {
    notify(relativePath, options = {}) {
      latestPath = relativePath;
      folderStack = options.folderStack ?? folderStack;
      entriesProcessed += 1;
      entriesSinceEmit += 1;
      maybeEmit();
    },
    tick(relativePath, options = {}) {
      latestPath = relativePath;
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
        currentPath: latestPath,
        folderStack
      };
    }
  };
}

async function loadDirectoryResult(rootPath, progress, scanState) {
  try {
    const stat = await fs.stat(rootPath);

    if (!stat.isDirectory()) {
      throw new Error("The selected path is not a directory.");
    }

    const loadedWorkspace = await walkDirectory(rootPath, rootPath, progress, scanState);

    if (progress) {
      progress.flush();
    }

    const scanSnapshot = progress?.getSnapshot?.() ?? {
      entriesProcessed: 0,
      filesLoaded: 0
    };

    return {
      id: `local-root:${normalizePath(rootPath)}`,
      provider: "local",
      rootId: normalizePath(rootPath),
      rootPath: normalizePath(rootPath),
      displayName: path.basename(rootPath),
      kind: "local-root",
      modifiedAt: stat.mtime.toISOString(),
      tree: loadedWorkspace.tree,
      loadWarnings: loadedWorkspace.loadWarnings,
      skippedEntryCount: loadedWorkspace.skippedEntryCount,
      cancelled: loadedWorkspace.cancelled,
      entriesProcessed: scanSnapshot.entriesProcessed,
      filesLoaded: scanSnapshot.filesLoaded
    };
  } catch (error) {
    throw new Error(`Unable to open ${path.basename(rootPath)}: ${getErrorMessage(error)}`);
  }
}

async function walkJsonFiles(rootPath, currentPath, depth = 0) {
  try {
    if (depth > maxWorkspaceScanDepth) {
      return [];
    }
    const resolvedCurrent = currentPath ?? rootPath;
    const entries = await fs.readdir(resolvedCurrent, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolutePath = path.join(resolvedCurrent, entry.name);

      if (entry.isDirectory()) {
        files.push(...(await walkJsonFiles(rootPath, absolutePath, depth + 1)));
        continue;
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") {
        continue;
      }

      files.push({
        absolutePath,
        relativePath: toPosixPath(path.relative(rootPath, absolutePath))
      });
    }

    return files;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function scanBundleState(bundlePath) {
  const normalizedBundlePath = normalizePath(bundlePath);
  const manifestPath = path.join(bundlePath, manifestFileName);
  let bootstrap;

  try {
    const manifestContent = await fs.readFile(manifestPath, "utf8");
    const payload = JSON.parse(manifestContent);
    bootstrap = normalizeBootstrapPayload(payload, path.basename(bundlePath));
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ENOENT")) {
      console.warn(`Unable to parse bundle bootstrap ${manifestPath}: ${getErrorMessage(error)}`);
    }
  }

  const sessions = new Map();
  const drafts = new Map();
  const resolutions = new Map();

  const sessionFiles = await walkJsonFiles(path.join(bundlePath, manifestDirectoryName, "sessions"));
  for (const file of sessionFiles) {
    try {
      const payload = JSON.parse(await fs.readFile(file.absolutePath, "utf8"));
      const session = normalizeSessionPayload(payload, file.relativePath);
      if (!session) {
        continue;
      }
      if (session.workspacePath) {
        session.workspacePath = normalizePath(session.workspacePath);
      }

      const current = sessions.get(session.deviceId);
      if (!current || compareByUpdatedAtDesc(current, session) > 0) {
        sessions.set(session.deviceId, session);
      }
    } catch {
      continue;
    }
  }

  const draftFiles = await walkJsonFiles(path.join(bundlePath, manifestDirectoryName, "drafts"));
  for (const file of draftFiles) {
    try {
      const payload = JSON.parse(await fs.readFile(file.absolutePath, "utf8"));
      const draft = normalizeDraftPayload(payload, file.relativePath);
      if (!draft) {
        continue;
      }

      const key = `${draft.deviceId}::${draft.path}`;
      const current = drafts.get(key);
      if (!current || compareByUpdatedAtDesc(current, draft) > 0) {
        drafts.set(key, draft);
      }
    } catch {
      continue;
    }
  }

  const resolutionFiles = await walkJsonFiles(path.join(bundlePath, manifestDirectoryName, "resolutions"));
  for (const file of resolutionFiles) {
    try {
      const payload = JSON.parse(await fs.readFile(file.absolutePath, "utf8"));
      const resolution = normalizeResolutionPayload(payload, file.relativePath);
      if (!resolution) {
        continue;
      }

      const current = resolutions.get(resolution.revisionId);
      if (
        !current ||
        compareByResolvedAtDesc(current, resolution) > 0
      ) {
        resolutions.set(resolution.revisionId, resolution);
      }
    } catch {
      continue;
    }
  }

  return {
    bootstrap,
    sessions: [...sessions.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    drafts: [...drafts.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    resolutions: [...resolutions.values()].sort(
      (left, right) => right.resolvedAt.localeCompare(left.resolvedAt) || right.revisionId.localeCompare(left.revisionId)
    ),
    bundlePath: normalizedBundlePath
  };
}

async function getOneDriveRoots() {
  const roots = new Set();
  const envKeys = ["OneDrive", "OneDriveCommercial", "OneDriveConsumer"];

  for (const key of envKeys) {
    const value = process.env[key];

    if (value) {
      roots.add(normalizePath(value));
    }
  }

  try {
    const homeEntries = await fs.readdir(app.getPath("home"), { withFileTypes: true });

    for (const entry of homeEntries) {
      if (entry.isDirectory() && /^OneDrive/i.test(entry.name)) {
        roots.add(normalizePath(path.join(app.getPath("home"), entry.name)));
      }
    }
  } catch {
    // Ignore missing home directories or permission issues.
  }

  return [...roots];
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  const initialWindowTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const initialChrome = getWindowThemeChrome(initialWindowTheme);
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: initialChrome.backgroundColor,
    titleBarStyle: isMac ? "hiddenInset" : "hidden",
    titleBarOverlay: isMac
      ? undefined
      : {
          color: initialChrome.titleBarColor,
          symbolColor: initialChrome.titleBarSymbolColor,
          height: titleBarOverlayHeight
        },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(
      `Renderer failed to load${isMainFrame ? " (main frame)" : ""}: ${validatedURL} [${errorCode}] ${errorDescription}`
    );
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`Preload error in ${preloadPath}: ${getErrorMessage(error)}`);
  });
  mainWindow.webContents.on("unresponsive", () => {
    console.error("Renderer became unresponsive.");
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`Renderer process exited: ${details.reason}`);
  });

  await loadRenderer(mainWindow);
}

ipcMain.handle("window:set-theme", (event, theme) => {
  if (theme !== "light" && theme !== "dark") {
    return false;
  }

  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (!targetWindow) {
    return false;
  }

  applyWindowTheme(targetWindow, theme);
  return true;
});

async function runOpenDirectoryScan(sender, rootPath, scanId) {
  const progress = createProgressReporter(sender, scanId);
  const scanState = createOpenDirectoryScanState(scanId);

  try {
    return await loadDirectoryResult(rootPath, progress, scanState);
  } finally {
    scanState.dispose();
  }
}

ipcMain.handle("local:open-directory", async (event, scanId) => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  registerWorkspaceRoot(selectedPath);
  return runOpenDirectoryScan(event.sender, selectedPath, scanId);
});

ipcMain.handle("local:open-directory-by-path", async (event, absolutePath, scanId) => {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return null;
  }

  try {
    const result = await runOpenDirectoryScan(event.sender, absolutePath, scanId);
    registerWorkspaceRoot(absolutePath);
    return result;
  } catch {
    return null;
  }
});

ipcMain.handle("local:cancel-open-directory", async (_event, scanId) => {
  if (typeof scanId !== "string" || !scanId.trim()) {
    return false;
  }

  const activeScan = activeOpenDirectoryScans.get(scanId);
  if (!activeScan) {
    return false;
  }

  activeScan.cancelled = true;
  return true;
});

ipcMain.handle("local:skip-open-directory-folder", async (_event, scanId, folderPath) => {
  if (typeof scanId !== "string" || !scanId.trim()) {
    return false;
  }

  if (typeof folderPath !== "string" || !folderPath.trim()) {
    return false;
  }

  const activeScan = activeOpenDirectoryScans.get(scanId);
  if (!activeScan) {
    return false;
  }

  activeScan.skippedFolders.add(toPosixPath(folderPath));
  return true;
});

ipcMain.handle("local:scan-workspace", async (_event, rootPath) => {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    return [];
  }

  if (!isRegisteredWorkspaceRoot(rootPath)) {
    return [];
  }

  try {
    return await scanDirectoryMetadata(rootPath, rootPath);
  } catch {
    return [];
  }
});

ipcMain.handle("local:get-file-snapshot", async (_event, absolutePath) => {
  if (typeof absolutePath !== "string" || !absolutePath.trim()) {
    return null;
  }

  if (!isUnderAnyRegisteredRoot(absolutePath)) {
    return null;
  }

  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return null;
    }

    return {
      path: normalizePath(absolutePath),
      absolutePath: normalizePath(absolutePath),
      modifiedAt: stat.mtime.toISOString(),
      size: stat.size,
      exists: true
    };
  } catch {
    return null;
  }
});

ipcMain.handle("local:search-workspace", async (_event, rootPath, query, requestId, limit = 200) => {
  if (typeof rootPath !== "string" || !rootPath.trim()) {
    return [];
  }

  if (!isRegisteredWorkspaceRoot(rootPath)) {
    return [];
  }

  const cappedLimit =
    typeof limit === "number" && Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.trunc(limit))) : 200;
  const searchState = createWorkspaceSearchState(requestId);

  try {
    return await searchWorkspace(rootPath, query, cappedLimit, searchState);
  } catch {
    return [];
  } finally {
    searchState.dispose();
  }
});

ipcMain.handle("local:cancel-search-workspace", async (_event, requestId) => {
  if (typeof requestId !== "string" || !requestId.trim()) {
    return false;
  }

  const activeSearch = activeWorkspaceSearches.get(requestId);
  if (!activeSearch) {
    return false;
  }

  activeSearch.cancelled = true;
  return true;
});

ipcMain.handle("bundle:create-directory", async (_event, suggestedName) => {
  const bundleName = sanitizeBundleName(typeof suggestedName === "string" ? suggestedName : "workspace");
  const defaultPath = path.join(app.getPath("documents"), bundleName);
  const result = await dialog.showSaveDialog({
    title: "Choose Workspace Bundle Location",
    buttonLabel: "Create Bundle",
    defaultPath
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  const targetPath = result.filePath.endsWith(bundleDirectorySuffix)
    ? result.filePath
    : `${result.filePath}${bundleDirectorySuffix}`;

  await ensureDirectory(targetPath);
  registerBundleRoot(targetPath);

  return {
    path: normalizePath(targetPath),
    name: path.basename(targetPath)
  };
});

ipcMain.handle("bundle:open-directory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Workspace Bundle",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const selectedPath = result.filePaths[0];
  registerBundleRoot(selectedPath);
  return {
    path: normalizePath(selectedPath),
    name: path.basename(selectedPath)
  };
});

ipcMain.handle("bundle:scan", async (_event, bundlePath) => {
  if (typeof bundlePath !== "string" || !bundlePath.trim()) {
    return {
      sessions: [],
      drafts: [],
      resolutions: []
    };
  }

  registerBundleRoot(bundlePath);
  return scanBundleState(bundlePath);
});

ipcMain.handle("bundle:create-local-workspace-ref", async (_event, input) => {
  const workspacePath = normalizePath(input.workspacePath);
  const bundlePath = normalizePath(input.bundlePath);
  const oneDriveRoots = await getOneDriveRoots();
  const now = new Date().toISOString();
  const matchingOneDriveRoot = [...oneDriveRoots]
    .sort((left, right) => right.length - left.length)
    .find((root) => workspacePath === root || workspacePath.startsWith(`${root}/`));

  return {
    kind: "local",
    provider: "local",
    displayName: input.displayName,
    bundleRelativePath: toPosixPath(path.relative(bundlePath, workspacePath)),
    oneDriveRelativePath: matchingOneDriveRoot
      ? toPosixPath(path.relative(matchingOneDriveRoot, workspacePath))
      : undefined,
    deviceHints: [
      {
        deviceId: input.deviceId,
        absolutePath: workspacePath,
        updatedAt: now
      }
    ]
  };
});

ipcMain.handle("bundle:resolve-local-workspace-candidates", async (_event, input) => {
  const candidates = [];
  const seen = new Set();
  const workspaceRef = input.workspaceRef;
  const currentHint = workspaceRef.deviceHints.find((hint) => hint.deviceId === input.deviceId);

  if (currentHint?.absolutePath) {
    candidates.push(currentHint.absolutePath);
  }

  if (workspaceRef.bundleRelativePath) {
    candidates.push(path.resolve(input.bundlePath, workspaceRef.bundleRelativePath));
  }

  if (workspaceRef.oneDriveRelativePath) {
    const oneDriveRoots = await getOneDriveRoots();

    for (const root of oneDriveRoots) {
      candidates.push(path.resolve(root, workspaceRef.oneDriveRelativePath));
    }
  }

  return candidates
    .map((candidate) => normalizePath(candidate))
    .filter((candidate) => {
      if (!candidate || seen.has(candidate)) {
        return false;
      }

      seen.add(candidate);
      return true;
    });
});

ipcMain.handle("local:read-file", async (_event, absolutePath) => {
  assertInsideRegisteredRoot(absolutePath);
  return fs.readFile(absolutePath, "utf8");
});

ipcMain.handle("local:read-file-bytes", async (_event, absolutePath) => {
  assertInsideRegisteredRoot(absolutePath);
  const buffer = await fs.readFile(absolutePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
});

ipcMain.handle("local:write-file", async (_event, absolutePath, content) => {
  assertInsideRegisteredRoot(absolutePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
  const stat = await fs.stat(absolutePath);
  return {
    modifiedAt: stat.mtime.toISOString(),
    size: stat.size
  };
});

ipcMain.handle("local:write-json", async (_event, absolutePath, payload) => {
  assertInsideRegisteredRoot(absolutePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2), "utf8");
  return true;
});

ipcMain.handle("local:read-json", async (_event, absolutePath) => {
  assertInsideRegisteredRoot(absolutePath);
  const content = await fs.readFile(absolutePath, "utf8");
  return JSON.parse(content);
});

app.whenReady().then(() => {
  void createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
