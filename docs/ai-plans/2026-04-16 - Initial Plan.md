# PWA + Electron Text Editor Plan

## Summary
- Build a greenfield text editor with one shared `React + TypeScript + Vite` codebase, shipped as both a PWA and an Electron desktop app.
- V1 remains a tabbed, single-root workspace editor with mobile/desktop responsive UI, local and cloud file access, Markdown preview, syntax highlighting for common file types, and workspace content search.
- Add a full light/dark theme system plus a cloud-synced workspace session file so a user can move between computers, reopen the same workspace, and resume or compare session state.

## Key Implementation Changes
- Runtime and editor stack:
  - Use `CodeMirror 6` for editing, syntax highlighting, search, folding, and better mobile performance.
  - Use `IndexedDB + Dexie` for cached files, offline sync queue, recent files, drafts, and workspace search index.
  - Use `Electron` with a strict preload bridge for native file access; keep the renderer browser-safe.
  - Use `vite-plugin-pwa` for installability, offline shell caching, and update prompts.
- Workspace model:
  - Support one open root at a time: local folder, OneDrive folder, Google Drive folder, or Dropbox folder.
  - Keep the current plan for local-first mirrored cloud workspaces, offline edit queue, manual remote file conflict handling, Markdown split/toggle preview, and workspace-wide content search against the mirrored local index.
- Cloud workspace session sync:
  - For cloud-root workspaces, create a manifest file named `vstext.json` in the workspace root and a companion folder `vstext/` for larger draft payloads and snapshot blobs.
  - The manifest is the portable entrypoint a user can open on another computer; it contains no auth tokens, only provider/root identifiers, shared settings, revision metadata, device snapshots, and draft references.
  - On another machine, opening `vstext.json` prompts provider auth, resolves the referenced root folder, rebuilds the mirrored workspace, and restores the saved session.
  - Sync the local device snapshot on debounce, app backgrounding, explicit save-session, and shutdown; queue writes offline and flush when reconnected.
  - Watch for remote manifest changes through the provider delta/change APIs while the app is open. If another device publishes a newer session, show a prompt instead of silently replacing the current state.
- Resume and compare behavior:
  - If a newer remote session exists, show options: `Resume remote session`, `Compare sessions`, `Keep current session`.
  - `Compare sessions` is a dedicated merge screen where the user can select items from either side, with bulk actions `Use all local` and `Use all remote`.
  - Session-level compare items are explicit and selectable: open tabs, active file, pane layout, sidebar state, search panel state, cursor/scroll positions, and theme override.
  - If both devices have different unsaved drafts for the same cloud file, do not auto-merge text. Open a per-file diff flow with actions `Keep local`, `Keep remote`, and `Save copy`.
  - Only cloud-backed file drafts sync across devices. Local-only files remain device-local; if referenced by a synced session on another machine, show them as unavailable placeholders and skip draft restore.
- Theme system:
  - Add `themeMode = system | light | dark`.
  - Default to `system`; when set to `light` or `dark`, sync that override in `vstext.json` so other devices use the same explicit choice.
  - When `themeMode = system`, sync the mode itself, not the resolved color; each device follows its own OS theme.
  - Implement semantic CSS variables for both themes so the app chrome, editor, Markdown preview, dialogs, tree, search UI, and diff UI switch together.
  - Use matched editor syntax themes for light and dark so token colors stay readable and intentional in both modes.
- File and editor behavior:
  - Keep support for common text formats with syntax highlighting: `txt`, `md`, `json`, `yaml`, `xml`, `html`, `css`, `js`, `ts`, `tsx`, `py`, `sh`, `ini`, `toml`, `csv`; unknown text files open as plain text.
  - Preserve line endings on save; default to UTF-8, detect BOM-based UTF encodings, and allow manual reopen/save with a limited encoding set.
  - Detect binary files and block editing with an unsupported-file message.
  - Keep the performance policy: full features up to `2 MB`, reduced highlighting between `2 MB` and `10 MB`, and plain-text performance mode above `10 MB`.

## Public Interfaces / Types
- `ThemeMode`
  - `system | light | dark`
- `WorkspaceManifest`
  - `version`, `workspaceId`, `provider`, `rootFolderId`, `displayName`, `themeMode`, `headRevision`, `updatedAt`, `deviceSessions`, `draftRefs`
- `DeviceSession`
  - `deviceId`, `deviceName`, `updatedAt`, `lastSeenHeadRevision`, `openTabs`, `activeTab`, `layout`, `sidebarState`, `searchState`, `cursorState`
- `DraftRef`
  - `fileId`, `deviceId`, `baseRemoteRevision`, `updatedAt`, `blobPath`, `contentHash`
- `ProviderAdapter`
  - `authenticate()`, `listTree()`, `readText()`, `writeText()`, `createFile()`, `createFolder()`, `rename()`, `delete()`, `pollChanges()`
- `TextDocument`
  - `id`, `workspaceId`, `path`, `name`, `encoding`, `lineEnding`, `language`, `size`, `remoteRevision`, `dirty`, `cachedBody`
- `SessionCompareItem`
  - `id`, `type`, `label`, `localValue`, `remoteValue`, `selection`
- `ConflictRecord`
  - `documentId`, `baseRevision`, `localBody`, `remoteBody`, `detectedAt`, `resolution`

## Test Plan
- Unit tests:
  - Theme resolution for `system`, `light`, and `dark`, including synced override behavior.
  - Manifest serialization, revision bumping, device snapshot selection, and draft reference handling.
  - Encoding detection, binary detection, language mapping, Markdown sanitization, and sync queue transitions.
- Integration tests:
  - Open a cloud workspace, generate `vstext.json`, move to another device context, reopen it, and restore session state.
  - Edit cloud files offline, queue both document sync and session sync, reconnect, and flush safely.
  - Detect a newer remote session while the app is open and show the resume/compare prompt.
  - Create conflicting unsaved drafts for the same cloud file on two devices and verify the per-file diff flow.
- E2E tests:
  - Desktop: multi-tab editing, split Markdown preview, theme switching, native open/save/create/rename/delete, and session resume across devices.
  - Mobile: drawer-based tree/search, Markdown preview toggle, theme switching, session restore, and iOS/Safari local-file import/export fallback.
  - OneDrive, Google Drive, and Dropbox login, browse, open, save, manifest sync, and remote-session detection.
- Acceptance scenarios:
  - User starts a OneDrive workspace on computer A, edits files, changes layout/theme, then opens `vstext.json` on computer B and resumes correctly.
  - User returns to computer A after B changed the session and gets asked whether to resume, compare, or keep the current state.
  - User compares two sessions and picks individual tabs/layout items from each, while conflicting cloud drafts are resolved through explicit diff prompts.

## Assumptions And Defaults
- Cross-device resume is supported only for cloud-root workspaces in v1; local-root workspaces still restore session locally per device.
- No separate backend or app account is added; provider OAuth PKCE remains the only auth model.
- The manifest file name is fixed as `vstext.json`, with auxiliary synced state under `vstext/`.
- Sync detection is in-app via provider polling/delta feeds while the app is running; no server push or background daemon.
- Text draft conflicts are never auto-merged; session metadata can be selectively combined, but draft bodies always require explicit user choice.
