const { contextBridge, ipcRenderer } = require("electron");

const scanProgressChannel = "local:open-directory:progress";

contextBridge.exposeInMainWorld("electronAPI", {
  setWindowTheme: (theme) => ipcRenderer.invoke("window:set-theme", theme),
  openDirectory: (scanId) => ipcRenderer.invoke("local:open-directory", scanId),
  openDirectoryByPath: (absolutePath, scanId) =>
    ipcRenderer.invoke("local:open-directory-by-path", absolutePath, scanId),
  restoreWorkspaceAccess: (rootPath) => ipcRenderer.invoke("local:restore-workspace-access", rootPath),
  cancelOpenDirectoryScan: (scanId) => ipcRenderer.invoke("local:cancel-open-directory", scanId),
  skipOpenDirectoryFolder: (scanId, folderPath) =>
    ipcRenderer.invoke("local:skip-open-directory-folder", scanId, folderPath),
  scanWorkspace: (rootPath, skippedFolders) => ipcRenderer.invoke("local:scan-workspace", rootPath, skippedFolders),
  getFileSnapshot: (absolutePath) => ipcRenderer.invoke("local:get-file-snapshot", absolutePath),
  searchWorkspace: (rootPath, query, requestId, limit) =>
    ipcRenderer.invoke("local:search-workspace", rootPath, query, requestId, limit),
  cancelWorkspaceSearch: (requestId) => ipcRenderer.invoke("local:cancel-search-workspace", requestId),
  createBundleDirectory: (suggestedName) => ipcRenderer.invoke("bundle:create-directory", suggestedName),
  openBundleDirectory: () => ipcRenderer.invoke("bundle:open-directory"),
  scanBundle: (bundlePath) => ipcRenderer.invoke("bundle:scan", bundlePath),
  readFile: (absolutePath) => ipcRenderer.invoke("local:read-file", absolutePath),
  readFileBytes: (absolutePath) => ipcRenderer.invoke("local:read-file-bytes", absolutePath),
  writeFile: (absolutePath, content) =>
    ipcRenderer.invoke("local:write-file", absolutePath, content),
  createFile: (absolutePath, content) =>
    ipcRenderer.invoke("local:create-file", absolutePath, content),
  createDirectory: (absolutePath) => ipcRenderer.invoke("local:create-directory", absolutePath),
  deleteEntry: (absolutePath) => ipcRenderer.invoke("local:delete-entry", absolutePath),
  moveEntry: (sourceAbsolutePath, targetAbsolutePath) =>
    ipcRenderer.invoke("local:move-entry", sourceAbsolutePath, targetAbsolutePath),
  copyEntry: (sourceAbsolutePath, targetAbsolutePath) =>
    ipcRenderer.invoke("local:copy-entry", sourceAbsolutePath, targetAbsolutePath),
  revealEntry: (absolutePath) => ipcRenderer.invoke("local:reveal-entry", absolutePath),
  writeJson: (absolutePath, payload) =>
    ipcRenderer.invoke("local:write-json", absolutePath, payload),
  readJson: (absolutePath) => ipcRenderer.invoke("local:read-json", absolutePath),
  createLocalWorkspaceRef: (input) => ipcRenderer.invoke("bundle:create-local-workspace-ref", input),
  resolveLocalWorkspaceCandidates: (input) =>
    ipcRenderer.invoke("bundle:resolve-local-workspace-candidates", input),
  onOpenDirectoryProgress: (listener) => {
    if (typeof listener !== "function") {
      return () => {};
    }

    const forward = (_event, payload) => {
      try {
        listener(payload);
      } catch {
        // Swallow listener errors so main-process IPC stays healthy.
      }
    };

    ipcRenderer.on(scanProgressChannel, forward);
    return () => ipcRenderer.removeListener(scanProgressChannel, forward);
  }
});
