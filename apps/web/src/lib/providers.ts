import { CLOUD_PROVIDER_LABELS } from "../constants";
import {
  getBrowserFileSnapshot,
  readBrowserBinaryFile,
  readBrowserText,
  scanBrowserWorkspace,
  writeBrowserTextFile
} from "./localWorkspace";
import type {
  AppDesktopApi,
  FileWriteResult,
  ProviderCapabilities,
  ProviderId,
  ProviderStatus,
  WorkspaceFileRecord,
  WorkspaceFileSnapshot
} from "../types";

type CurrentRef<T> = {
  current: T;
};

type FileLocator = Pick<WorkspaceFileRecord, "path" | "absolutePath">;

const localCapabilities: ProviderCapabilities = {
  auth: false,
  workspaceDiscovery: true,
  openWorkspace: true,
  readFile: true,
  writeFile: true,
  pollWorkspace: true,
  bundleSync: true
};

const plannedCloudCapabilities: ProviderCapabilities = {
  auth: true,
  workspaceDiscovery: true,
  openWorkspace: true,
  readFile: true,
  writeFile: true,
  pollWorkspace: true,
  bundleSync: true
};

function createLocalProviderStatus(): ProviderStatus {
  return {
    provider: "local",
    label: "Local Filesystem",
    configured: true,
    connected: true,
    readiness: "ready",
    description: "Uses Electron filesystem APIs or browser File System Access handles.",
    statusLabel: "Ready now",
    capabilities: localCapabilities
  };
}

function createCloudProviderStatus(provider: Exclude<ProviderId, "local">, configured: boolean): ProviderStatus {
  return {
    provider,
    label: CLOUD_PROVIDER_LABELS[provider],
    configured,
    connected: false,
    readiness: configured ? "scaffolded" : "needs-config",
    description: configured
      ? "Provider contract and UI are wired. OAuth, root discovery, and file transport are the next implementation step."
      : "Add the matching VITE_*_CLIENT_ID env var to begin wiring OAuth and cloud-root flows.",
    statusLabel: configured ? "Scaffolded: integration work pending" : "Needs client id",
    capabilities: plannedCloudCapabilities
  };
}

export interface LocalWorkspaceIoProvider {
  status: ProviderStatus;
  readText: (document: FileLocator) => Promise<string>;
  readBlob: (document: FileLocator, mimeType?: string) => Promise<Blob>;
  writeText: (document: FileLocator, content: string) => Promise<FileWriteResult>;
  getSnapshot: (document: FileLocator) => Promise<WorkspaceFileSnapshot | null>;
  scanWorkspace: (rootPath?: string, skippedFolders?: string[]) => Promise<WorkspaceFileSnapshot[]>;
}

export interface ProviderRegistry {
  local: LocalWorkspaceIoProvider;
  statuses: ProviderStatus[];
  getStatus: (provider: ProviderId) => ProviderStatus | undefined;
}

export interface ProviderRuntimeContext {
  electronAPI?: AppDesktopApi;
  browserWorkspaceDirectoryHandleRef: CurrentRef<FileSystemDirectoryHandle | null>;
  browserWorkspaceFileHandlesRef: CurrentRef<Map<string, FileSystemFileHandle>>;
}

export function createProviderStatuses() {
  return [
    createLocalProviderStatus(),
    createCloudProviderStatus("onedrive", Boolean(import.meta.env.VITE_ONEDRIVE_CLIENT_ID)),
    createCloudProviderStatus("gdrive", Boolean(import.meta.env.VITE_GDRIVE_CLIENT_ID)),
    createCloudProviderStatus("dropbox", Boolean(import.meta.env.VITE_DROPBOX_CLIENT_ID))
  ];
}

export function getConfiguredCloudProviderCount(statuses: ProviderStatus[]) {
  return statuses.filter((status) => status.provider !== "local" && status.configured).length;
}

export function createProviderRegistry(context: ProviderRuntimeContext): ProviderRegistry {
  const statuses = createProviderStatuses();
  const local = statuses.find((status) => status.provider === "local") ?? createLocalProviderStatus();

  return {
    local: {
      status: local,
      async readText(document) {
        if (context.electronAPI && document.absolutePath) {
          return context.electronAPI.readFile(document.absolutePath);
        }

        if (context.browserWorkspaceDirectoryHandleRef.current) {
          return readBrowserText(context.browserWorkspaceDirectoryHandleRef.current, document.path);
        }

        throw new Error("This workspace is not readable in the current runtime.");
      },
      async readBlob(document, mimeType = "application/octet-stream") {
        if (context.electronAPI && document.absolutePath) {
          const bytes = await context.electronAPI.readFileBytes(document.absolutePath);
          return new Blob([bytes], { type: mimeType });
        }

        if (context.browserWorkspaceDirectoryHandleRef.current) {
          const file = await readBrowserBinaryFile(
            context.browserWorkspaceDirectoryHandleRef.current,
            context.browserWorkspaceFileHandlesRef.current,
            document.path
          );
          return file.type ? file : new Blob([file], { type: mimeType });
        }

        throw new Error("This workspace is not readable in the current runtime.");
      },
      async writeText(document, content) {
        if (context.electronAPI && document.absolutePath) {
          return context.electronAPI.writeFile(document.absolutePath, content);
        }

        if (context.browserWorkspaceDirectoryHandleRef.current) {
          return writeBrowserTextFile(
            context.browserWorkspaceDirectoryHandleRef.current,
            context.browserWorkspaceFileHandlesRef.current,
            document.path,
            content
          );
        }

        throw new Error("This workspace is not writable in the current runtime.");
      },
      async getSnapshot(document) {
        if (context.electronAPI && document.absolutePath) {
          return context.electronAPI.getFileSnapshot(document.absolutePath);
        }

        if (context.browserWorkspaceDirectoryHandleRef.current) {
          return getBrowserFileSnapshot(
            context.browserWorkspaceDirectoryHandleRef.current,
            context.browserWorkspaceFileHandlesRef.current,
            document.path
          );
        }

        return null;
      },
      async scanWorkspace(rootPath, skippedFolders = []) {
        if (context.electronAPI && rootPath) {
          return context.electronAPI.scanWorkspace(rootPath, skippedFolders);
        }

        if (context.browserWorkspaceDirectoryHandleRef.current) {
          return scanBrowserWorkspace(
            context.browserWorkspaceDirectoryHandleRef.current,
            context.browserWorkspaceFileHandlesRef.current,
            skippedFolders
          );
        }

        return [];
      }
    },
    statuses,
    getStatus(provider) {
      return statuses.find((status) => status.provider === provider);
    }
  };
}
