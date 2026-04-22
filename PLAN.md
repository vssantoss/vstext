# vsText Status

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

## Current Reality vs Original Plan

- The original plan targeted direct cloud-provider roots in v1.
  - The current implementation stops short of that and instead supports synced workspace manifests inside local folders.
- The original plan called for a full provider abstraction with remote polling and write flows.
  - The shared provider contract is now in place, but the actual cloud adapters are still scaffolded.
- The theme system and cross-device session UX are implemented at the app level.
  - The remaining work is mainly around real provider transport and deeper filesystem operations.
