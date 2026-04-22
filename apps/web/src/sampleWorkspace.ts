import { APP_NAME } from "./constants";
import { detectLineEnding } from "./lib/encoding";
import { getLanguageMetadata, isMarkdownPath } from "./lib/language";
import type { DocumentBuffer, FileTreeNode, WorkspaceFileRecord, WorkspaceRoot } from "./types";

export const sampleRoot: WorkspaceRoot = {
  id: "sample-workspace",
  provider: "local",
  rootId: "sample",
  rootPath: "sample",
  displayName: "Sample Notes",
  kind: "local-root"
};

const sampleBodies: Record<string, string> = {
  "README.md": `# ${APP_NAME}\n\nThis starter workspace shows markdown rendering, code highlighting, search, and shared workspace bundles.\n\n- Open a local folder to edit real files.\n- Save a workspace bundle anywhere you want to resume on another machine.\n`,
  "notes/today.txt": `Theme: system\nPreview: markdown on desktop, toggle on mobile\nSearch: workspace-wide\n`,
  "notes/layout.json": `{\n  "sidebarOpen": true,\n  "previewOpen": true,\n  "mobilePanel": "tree"\n}\n`
};

const now = new Date().toISOString();

export const sampleTree: FileTreeNode[] = [
  {
    id: "sample:README.md",
    provider: "local",
    kind: "file",
    name: "README.md",
    path: "README.md",
    modifiedAt: now,
    size: sampleBodies["README.md"].length
  },
  {
    id: "sample:notes",
    provider: "local",
    kind: "directory",
    name: "notes",
    path: "notes",
    children: [
      {
        id: "sample:notes/today.txt",
        provider: "local",
        kind: "file",
        name: "today.txt",
        path: "notes/today.txt",
        modifiedAt: now,
        size: sampleBodies["notes/today.txt"].length
      },
      {
        id: "sample:notes/layout.json",
        provider: "local",
        kind: "file",
        name: "layout.json",
        path: "notes/layout.json",
        modifiedAt: now,
        size: sampleBodies["notes/layout.json"].length
      }
    ]
  }
];

function createSampleFile(path: string): WorkspaceFileRecord {
  const name = path.split("/").at(-1) ?? path;
  const body = sampleBodies[path] ?? "";
  const metadata = getLanguageMetadata(path);

  return {
    id: `sample:${path}`,
    workspaceId: sampleRoot.id,
    path,
    name,
    provider: "local",
    language: metadata.label,
    size: body.length,
    modifiedAt: now,
    lastSyncedModifiedAt: now,
    lastSyncedSize: body.length,
    foreignDrafts: [],
    pendingForeignDraftCount: 0,
    isMarkdown: Boolean(metadata.markdown ?? isMarkdownPath(path)),
    isPdf: false,
    unavailable: false
  };
}

function createSampleBuffer(path: string): DocumentBuffer {
  const body = sampleBodies[path] ?? "";

  return {
    documentId: `sample:${path}`,
    workspaceId: sampleRoot.id,
    encoding: "utf-8",
    lineEnding: detectLineEnding(body),
    cachedBody: body,
    dirty: false,
    lastAccessedAt: Date.now(),
    persistedLocal: false
  };
}

export const sampleFiles: WorkspaceFileRecord[] = Object.keys(sampleBodies).map(createSampleFile);

export const sampleBuffers: DocumentBuffer[] = Object.keys(sampleBodies).map(createSampleBuffer);

export function readSampleWorkspaceText(path: string): string {
  const body = sampleBodies[path];
  if (typeof body !== "string") {
    throw new Error(`Unknown sample workspace file: ${path}`);
  }

  return body;
}

export function mergeSampleWorkspaceBuffers(buffers: DocumentBuffer[]): DocumentBuffer[] {
  const merged = new Map(sampleBuffers.map((buffer) => [buffer.documentId, buffer] as const));

  for (const buffer of buffers) {
    merged.set(buffer.documentId, buffer);
  }

  return [...merged.values()];
}
