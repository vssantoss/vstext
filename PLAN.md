# VS Text Status

## Summary

This project now has a working greenfield foundation for a shared web and Electron text editor. The current implementation covers the editor shell, lazy local workspace flows, theme system, session manifests, and the UI needed to resume or compare sessions across machines when the workspace bundle itself is synchronized by a cloud drive client.

## Done

- Project setup:
  - `React + TypeScript + Vite` app scaffolded.
  - PWA support added with `vite-plugin-pwa`.
  - Electron shell added with a preload-only bridge for local filesystem access.
- Editor experience:
  - Responsive mobile/desktop layout.
  - Tabbed editor UI.
  - `CodeMirror 6` editor integration.
  - Syntax highlighting for common file types such as `md`, `json`, `yaml`, `xml`, `html`, `css`, `js`, `ts`, `tsx`, `py`, `sh`, `ini`, `toml`, and `csv`.
  - Markdown preview rendering.
  - Basic large-file behavior with reduced feature mode thresholds.
  - VS Code–style preview tabs (single-click opens in a reusable italic tab; double-click or editing promotes to a permanent tab).
  - Tab drag-and-drop reordering within a group and drag-to-move tabs across groups, including drop-on-editor-body.
  - Split editors / multi-pane layouts with per-group tab strips, `Split Right` action, resizable group widths, and auto-collapse of empty groups.
  - Resizable Markdown preview and merge-review side panes (15–85%, double-click to reset).
  - Read-only PDF preview inside the editor pane (browser + Electron), served from lazy blob URLs per active PDF tab.
- Bundle size and loading:
  - `EditorSurface` lazy-loaded via `React.lazy` + `Suspense`.
  - `MarkdownPreview` extracted as a sub-lazy chunk so `react-markdown`/`remark-gfm`/`rehype-sanitize` only load when the preview is opened.
  - CodeMirror language support now loads on demand per file type instead of shipping every parser in the editor chunk.
  - The largest emitted web chunk is now below 500 kB minified.
- Local workspace support:
  - Local folder open flow in Electron.
  - Local folder open flow in browsers that support the File System Access API.
  - Metadata-first workspace scans with lazy document buffers and small clean-buffer residency.
  - Save-back to local files in Electron and supported browsers.
  - File tree browsing in both runtimes and desktop-only on-demand workspace search.
- Provider foundation:
  - Shared provider contract for auth/config state, capabilities, workspace discovery, and file operations.
  - `local` now conforms to the same provider surface that future cloud providers will use.
  - OneDrive, Google Drive, and Dropbox remain visible in the UI with honest scaffold/readiness states instead of fake connect flows.
- Theme system:
  - `system`, `light`, and `dark` theme modes.
  - Shared semantic CSS variables across app chrome, tree, editor, preview, dialogs, and compare UI.
  - Theme preference persisted locally and included in workspace session state.
- Workspace session sync:
  - `vstext.json` manifest support.
  - `vstext/drafts/*.draft.json` draft storage.
  - Session snapshot persistence for open tabs, active file, layout, sidebar state, search state, cursor state, and theme mode.
  - Prompt when a newer remote session is found.
  - Session compare dialog with per-section local/remote selection and bulk `Use All Local` / `Use All Remote`.
  - Inline remote draft review and resolution flow.
- Data and utilities:
  - IndexedDB storage via Dexie for cached workspace state, file metadata, and dirty buffers.
  - Shared pure core module for supported extensions and bundle payload normalization across browser and Electron.
  - Helpers for encoding detection, line ending detection, hash generation, and language mapping.
- Verification:
  - Unit tests added for shared core helpers, provider runtime behavior, workspace scanning, theme resolution, encoding helpers, language mapping, and session manifest helpers.
  - `pnpm test` passes.
  - `pnpm build` passes.

## Pending

- Real cloud provider integrations:
  - OneDrive OAuth PKCE flow is not implemented yet.
  - Google Drive OAuth PKCE flow is not implemented yet.
  - Dropbox OAuth PKCE flow is not implemented yet.
  - Provider registry and UI are scaffolded, but real provider-specific auth and file transport still need implementation.
- Cloud-root workspace support:
  - Opening a OneDrive, Google Drive, or Dropbox folder directly inside the app is not implemented yet.
  - Provider-backed file listing, read, write, create, rename, delete, and change polling are still pending.
  - Current cross-machine resume works only when the workspace folder is already synced externally by a desktop sync client.
- Sync engine depth:
  - No real remote delta sync for provider-backed files yet.
  - No offline replay queue for provider API writes yet.
  - No manifest polling against real provider change feeds yet.
- File operations:
  - Create/rename/delete flows are planned but not implemented in the UI.
  - Unsupported local-browser fallback import/export flow for iOS/Safari is not implemented yet.
  - Manual encoding reopen/save options are not exposed in the UI yet.
- Search and indexing:
  - Desktop search works as a main-process query-time scan, but there is no dedicated background index lifecycle yet.
  - Web/PWA intentionally does not expose workspace-wide search.
- Testing depth:
  - No integration or end-to-end coverage yet for Electron, browser file access, session handoff, or mobile layout.
  - No automated tests yet for compare flow and draft conflict resolution UI.

## Current Reality vs Original Plan

- The original plan targeted direct cloud-provider roots in v1.
  - The current implementation stops short of that and instead supports synced workspace manifests inside local folders.
- The original plan called for a full provider abstraction with remote polling and write flows.
  - The shared provider contract is now in place, but the actual cloud adapters are still scaffolded.
- The theme system and cross-device session UX are implemented at the app level.
  - The remaining work is mainly around real provider transport and deeper filesystem operations.

## Future Ideas

- Cloud and sync:
  - Complete direct OneDrive, Google Drive, and Dropbox adapters with PKCE auth and provider-specific delta polling.
  - Add true cloud-root workspaces in both PWA and Electron.
  - Add richer remote change handling, including manifest version history and better recovery flows.
- Editor capabilities:
  - Add in-file find/replace UI and command palette.
  - Add richer Markdown features such as outline view, table of contents, and preview navigation sync.
  - Add more languages and smarter large-file degradation.
  - PDF file utilities: join pdf files, remove pages, reorder pages, slice pdf files, etc
  - Photos/images preview allowing zoom, etc. On opening photo allow navigation on the other photos os the folder on the preview tab
- File management:
  - Add create, rename, delete, duplicate, and move for files and folders.
  - Add recent workspaces and pinned workspaces.
  - Add explicit import/export flows for restricted mobile browsers.
- Sync and collaboration:
  - Add a clearer session timeline so users can inspect which device changed what.
  - Add remote draft diffing with a stronger merge experience.
  - Explore optional app-account or backend support if cross-device state grows beyond folder-synced manifests.
- Product polish:
  - Add onboarding for provider setup and workspace manifest concepts.
  - Add stronger accessibility coverage, keyboard shortcuts, and touch-specific affordances.
  - Add integration and E2E test coverage for desktop, PWA install, and responsive behavior.
