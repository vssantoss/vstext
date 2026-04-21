/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

import type { AppDesktopApi } from "./types";

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    electronAPI?: AppDesktopApi;
  }

  interface FileSystemDirectoryHandle {
    values?: () => AsyncIterable<FileSystemHandle>;
  }
}

export {};
