# Changelog

All notable project changes are documented here.

## [0.2.1] - 2026-04-23

### Added

- **Tab context menu**: Right-click any editor tab to access Close, Close Others, Close to the Right, Close Saved, Close All, Copy Relative Path, Split Right, and Keep Open (for preview tabs).
- **Copy Path** (desktop only): Copies the full filesystem path of a file to the clipboard via the tab context menu.
- **Copy Relative Path**: Copies the workspace-relative path of a file to the clipboard via the tab context menu. Available on both browser and desktop.
- Disabled states for context menu actions that don't apply (e.g. Close to the Right on the rightmost tab, Close Saved when all tabs have unsaved changes).

### Fixed

- Workspace bug fixes.

## [0.2.0] - 2026-04-21

### Added

- ActivityBar with Files, Search, Sessions, Cloud Providers, and Settings activities, plus badges for connected providers and pending remote sessions.
- Draggable sidebar resize handle (clamped 220–480px).
- Clicking the active activity icon collapses the sidebar; clicking a different activity expands it to that panel.
- Per-file dirty indicator in the file tree and tab strip.
- Electron frameless window with Windows `titleBarOverlay` (and macOS `hiddenInset`) so native window controls sit on the custom title bar.
- `-webkit-app-region: drag` on the title bar with non-draggable actions, plus platform-aware padding (reserved space for macOS traffic lights and Windows controls) driven by `data-runtime` / `data-platform` attributes set at boot.
- `lucide-react` icon library for activity-bar, tree, tab, menu, and status-bar icons.
- `ACTIVITY_ITEMS` constant and `ActivityId` type driving the activity bar.
- `activeActivity` field on `LayoutState`, persisted per device session (defaults to `files` for older sessions).
- `Open Workspace Bundle…` and `Change Save Location…` actions in the title-bar menu, with bundle/link status in the Sessions panel.
- Workspace scan overlay with live progress (entries scanned, files loaded, current path) for both the Electron folder walker and the browser File System Access walker, with a 150 ms debounce so quick scans don't flash and no overlay while the native folder picker is still open.
- `Cancel scan` on the workspace scan overlay, opening the workspace with only the files already scanned and loaded.
- `Skip <folder> folder` on the workspace scan overlay after the same non-root folder stays active for 10 seconds, skipping the rest of that subtree while keeping anything already scanned inside it.
- Throttled IPC progress channel `local:open-directory:progress` on the Electron main process and an `onOpenDirectoryProgress` subscription on the preload bridge.
- `onProgress` option on `openBrowserWorkspace` so the browser walker can report live scan progress to the renderer.
- VS Code–style preview tabs: single-click opens a file in a reusable italic preview tab; double-click (or editing) promotes it to a permanent tab.
- Tab reordering via native HTML5 drag-and-drop, with drop indicators drawn before/after the hover target.
- Split editors / multi-pane layouts: per-group tab strips with independent active and preview tabs, a `Split Right` button on the tab strip, resize handles between groups, and auto-collapse of empty groups with group-size redistribution.
- Drag-to-move tabs across editor groups, including drop-on-editor-body to move a tab to the end of a non-focused group; drop targets draw a dashed accent overlay over the surface.
- Resizable split panes inside the editor surface (Markdown preview and merge review), clamped between 15% and 85%, with double-click to reset to 50%.
- `EditorSurfacePlaceholder` inline empty state rendered while no file is open, so the heavy editor chunk is not fetched until it is actually needed.
- PDF preview support: `.pdf` files appear in the workspace tree and open in a dedicated read-only iframe viewer inside the editor pane. Browser workspaces stream PDFs via the File System Access API; Electron workspaces read them through a new `local:read-file-bytes` IPC channel. Blob URLs are created lazily per active PDF tab and revoked when the PDF is closed.
- Structured renderer activity logs for workspace scans and polls, skipped folders, tab lifecycle, file reads, document content changes, and buffer lifecycle, with inline JSON payloads instead of `[object Object]`.

### Changed

- Redesigned the application shell to match a desktop IDE layout (title bar + activity bar + sidebar + editor + status bar), replacing the card-and-topbar layout.
- Rewrote the design system to use neutral VS Code–style grays (dark `#1e1e1e`, light `#f8f8f8`), 4–6px radii, 1px borders, and flat surfaces without backdrop blur.
- Replaced the warm cream light theme with a neutral light theme.
- Moved workspace actions (Open Folder, Load Sample, Save File, Save Session) into a title-bar overflow menu.
- Moved session status, cloud provider cards, and theme controls into dedicated sidebar activities.
- Moved the editor meta row (path, language, dirty state) into the new status bar, which also shows cursor line/column and a theme toggle.
- Reshaped the tab strip to squared tabs with a top accent, icon-per-filetype, and hover-revealed close button.
- Rewrote the CodeMirror editor theme for both light and dark to match the new shell.
- Switched UI typography to Inter and editor typography to JetBrains Mono (loaded from Google Fonts).
- Stopped writing workspace session files into the opened work folder.
- Moved shared session persistence to a user-chosen external workspace bundle folder containing `vstext.json` and `vstext/drafts`.
- Added portable local workspace locators for bundle reopen flows, using bundle-relative paths plus per-device absolute hints.
- Split browser workspace access from browser bundle access so local file saves and shared session saves use separate handles.
- Stopped auto-opening the first file after selecting a folder; the editor area now stays empty until the user picks a file from the tree. Restoring a saved session from a workspace bundle still reopens its saved tabs.
- Surfaced folder-open failures through a dismissible error banner instead of fleeting status-bar text.
- Lazy-loaded `EditorSurface` via `React.lazy` + `Suspense`; CodeMirror and its language parsers now ship in a separate chunk that is only downloaded when the user opens a file.
- Extracted `MarkdownPreview` into its own module, lazy-loaded from inside `EditorSurface`, so `react-markdown`, `remark-gfm`, and `rehype-sanitize` only load when the preview pane is opened.
- Split `lib/language.ts` into a lightweight metadata module (stays in main bundle) and a new `lib/languageExtensions.ts` that holds the CodeMirror language parsers and is only imported by `EditorSurface`, moving ~600 KB of parser code out of the initial bundle.
- Main (initial) JS bundle reduced from ~1016 KB (≈346 KB gzipped) to ~389 KB (≈122 KB gzipped).
- App startup now holds on a neutral boot screen while restoring the last workspace, instead of briefly rendering the sample workspace and then swapping to the cached one.
- Cached sample-workspace restores now rehydrate built-in sample buffers and read bundled sample file content directly instead of falling through to unreadable local-provider paths.
- Desktop cached-workspace restore now re-registers Electron filesystem access before hydrating the renderer, so restored workspaces can read files and rescan immediately after relaunch.
- Restored workspace trees are rebuilt from persisted file records so Electron/local tree node ids stay aligned with live `fileMap` ids after cache restore.
- Background scans now keep the user's skipped-folder list consistent across Electron and browser walkers, including pruning skipped subtrees when a folder is skipped mid-scan.

### Fixed

- Opening files from the bundled sample/demo workspace no longer creates blank tabs or throws `This workspace is not readable in the current runtime.` in the renderer.
- Startup cache restore no longer races with workspace persistence and no longer restores both the last local workspace and `Sample Notes` on the same launch.
- Restored desktop workspaces no longer fail file reads or background rescans after relaunch because the Electron root registry lost the previously opened folder.
- Background polling no longer interprets skipped folders or missing restored-root access as mass deletions that empty the workspace tree.
- Files in restored workspaces now open reliably before and after background scan events, including after cache hydration and tree rebuilds.
- Single-clicking an already promoted tab no longer demotes it back into the preview slot; promoted tabs now stay pinned until the user closes them.
- Skipping a folder is now logged explicitly with the folder name and relative path during workspace scan telemetry.

### Verified

- `corepack pnpm exec tsc --noEmit` (clean)
- `corepack pnpm test` (14/14 passing)
- `corepack pnpm build` (production bundle + PWA manifest emitted)
- `corepack pnpm dev` (Vite dev server serves the new shell)
- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit` (clean)
- `pnpm test` (20/20 passing)
- `pnpm build` (production bundle emitted; editor and markdown chunks split out)
- `pnpm test:web -- apps/web/src/sampleWorkspace.test.ts`
- `pnpm test:web -- apps/web/src/lib/providers.test.ts apps/web/src/lib/localWorkspace.test.ts`
- `pnpm test:web -- apps/web/src/lib/editorRuntime.test.ts`
- `pnpm build:web`

### Known Follow-ups

- Electron frameless window still needs a manual cross-platform smoke test (`corepack pnpm dev:desktop`) for drag region and native control overlay.
- Sidebar width is not yet persisted across reloads.
- Scan overlay + error banner still need a manual smoke test against a large OneDrive-synced project and a forced-failure case (folder renamed mid-scan).

## [0.1.0] - 2026-04-16

### Added

- Greenfield `React + TypeScript + Vite` application scaffold for a shared web and desktop text editor.
- PWA setup with installable build output and service worker generation.
- Electron desktop shell with a preload-only bridge for local filesystem access.
- Responsive mobile/desktop workspace layout with sidebar, tabs, editor surface, and modal flows.
- `CodeMirror 6` editor integration with syntax highlighting for common text, markup, and code file types.
- Markdown preview rendering for Markdown documents.
- Workspace-wide text search across loaded documents.
- Theme system with `system`, `light`, and `dark` modes.
- IndexedDB persistence for cached workspace state and settings.
- External workspace bundle support with `vstext.json`.
- `vstext/drafts/*.draft.json` draft storage for session-linked unsaved changes.
- Remote session prompt with `Resume Remote`, `Compare Sessions`, and `Keep Current` actions.
- Session compare UI with per-section local/remote selection and bulk apply actions.
- Draft conflict UI with `Keep Local`, `Keep Remote`, and `Save Copy` flows.
- Local folder open/save support in Electron.
- Local folder open/save support in browsers with the File System Access API.
- Unit tests for theme helpers, encoding helpers, language mapping, and session manifest helpers.

### Working Now

- Opening a local folder as a workspace.
- Browsing files in a tree and opening them in tabs.
- Editing and saving text files locally.
- Rendering Markdown preview.
- Highlighting common text/code file types.
- Switching between light, dark, and system themes.
- Searching across the loaded workspace files.
- Saving and restoring workspace session metadata through a user-chosen workspace bundle.
- Detecting a newer session from another machine when the same workspace bundle is externally synchronized.
- Comparing local and remote session state before applying it.
- Handling conflicting unsaved drafts with explicit user choice.

### Verified

- `corepack pnpm test`
- `corepack pnpm build`

### Known Limitations

- Direct OneDrive, Google Drive, and Dropbox API integrations are not finished yet.
- Cloud-provider login buttons and adapter structure exist, but OAuth and provider file operations are still scaffolded.
- Cross-machine resume currently works when the workspace bundle itself is synchronized by an external sync client such as OneDrive, Google Drive for desktop, or Dropbox.
