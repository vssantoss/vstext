# Project Terms

This glossary defines the recurring product, architecture, runtime, storage, and source-code terms used in vsText.

## Basic App Flow

To start using the app, choose **Open Folder**. The folder you open becomes your **workspace**. A workspace is the real folder on your computer that contains the files you want to read or edit.

After a workspace is open, its files appear in the **Explorer**. Clicking a file opens it in a **tab**. If you single-click a file, it may open as a **preview tab**, which is temporary. If you edit it, double-click it, or choose **Keep Open**, it becomes a regular tab.

When you type in a file, that file has **unsaved changes**. The app also calls this a **dirty file**. Dirty only means the file has changes in the editor that have not been written back to the real file yet.

To write those changes to the real file in your workspace, use **Save File**. Saving a file updates the actual file in the folder you opened.

If you want to continue the same workspace session on another device, choose a **workspace bundle**. The workspace bundle is a separate folder where vsText saves your session, drafts, and cross-device state. This bundle is what allows the workspace session to be shared between devices when the bundle folder is synced with a tool like OneDrive, Google Drive for desktop, or Dropbox.

Use **Save Session** to save the editor session into the workspace bundle. A session includes things like open tabs, layout, theme, search state, cursor positions, and drafts for dirty files.

A **draft** is a saved copy of unsaved file content inside the workspace bundle. It is different from a dirty file: dirty means the file has unsaved edits right now in this app; draft means those unsaved edits were saved into the bundle so they can be recovered or reviewed across devices.

On another device, use **Open Workspace Bundle** to open the synced bundle. The app uses the bundle to find the related workspace and restore the saved session. If another device saved newer state, you may see options like **Resume remote** or **Compare sessions**.

If another device saved unsaved content for a file, you may see a **remote draft**. The app lets you review that draft before it changes your real file. If there is a conflict, you can keep your local content, use the other version, or **Save copy** so no work is lost.

The app also keeps a **local cache** on each device. This helps reopen your last local app state, but it is not for sharing between devices. Sharing between devices depends on the workspace bundle being available and synced.

## Terms App Users Should Know First

- **Workspace**: The folder you open in vsText. It contains the real files you want to read or edit.
- **Workspace bundle**: A separate folder where vsText saves your editor session, unsaved drafts, and cross-device state. It is responsible for allowing a workspace session to be shared between devices when the bundle folder is synced. It is not the same thing as your workspace.
- **Open Folder**: Opens a real folder as your workspace.
- **Open Workspace Bundle**: Opens a saved workspace bundle so vsText can restore a previous session and reconnect it to the real workspace.
- **Change Save Location**: Chooses a different workspace bundle folder for future session saves.
- **Save File**: Writes the current file's content back to the real workspace file.
- **Save Session**: Saves tabs, layout, theme, cursor positions, and dirty-file drafts to the workspace bundle.
- **Session**: The editor state you can resume later, including open tabs, layout, search state, theme, and cursor positions.
- **Draft**: Unsaved file content saved inside the workspace bundle. A draft does not replace the real file until you choose to save or resolve it.
- **Remote draft**: A draft from another device using the same workspace bundle.
- **Compare sessions**: Lets you choose which parts of a local or remote session to keep.
- **Resume remote**: Applies a newer session saved by another device.
- **Dirty file**: A file with changes that have not been saved to the real workspace file.
- **Unsaved changes**: Edits that exist in the editor but have not been written to the real file yet.
- **Conflict**: A situation where the file or draft changed somewhere else before your current change was saved.
- **Save copy**: Saves your current content as a separate file so it is not lost during a conflict.
- **Local cache**: Device-only storage used to reopen your last app state on the same machine. It is not for sharing across devices.
- **Sample workspace**: The built-in demo workspace. It is useful for trying the app, but saving it does not write real files to disk.
- **Explorer**: The file tree in the sidebar.
- **Tab**: An open file in the editor.
- **Preview tab**: A temporary tab opened by single-clicking a file. It can be replaced by the next file you preview.
- **Keep Open**: Turns a preview tab into a normal tab.
- **Split editor**: Shows two or more editor panes side by side.
- **Markdown preview**: A rendered view of a Markdown file.
- **PDF preview**: A read-only view of a PDF file.
- **Cloud providers**: OneDrive, Google Drive, and Dropbox entries shown in the app. Direct cloud integrations are scaffolded but not finished yet.
- **Theme**: The visual mode of the app: system, light, or dark.
- **Search**: Finds text across the workspace. Desktop search can scan the workspace; browser search is more limited by browser file access.

## Product And Runtime

- **vsText**: The cross-platform text editor in this repository.
- **App shell**: The full editor interface, including title bar, activity bar, sidebar, editor groups, tab strips, and status bar.
- **Web app**: The browser version of vsText, built with React and Vite.
- **Desktop app**: The Electron-wrapped version of vsText.
- **PWA**: The installable Progressive Web App build of the web app.
- **Renderer**: The React/Vite UI process used by both the web app and the Electron desktop app.
- **Electron main process**: The desktop process in `apps/desktop/main.cjs` that owns native filesystem and window operations.
- **Electron preload bridge**: The controlled API surface in `apps/desktop/preload.cjs` that exposes selected desktop features to the renderer.
- **Runtime**: The environment the app is running in, mainly browser or Electron desktop.
- **Runtime platform**: The detected operating system family, such as Windows, macOS, Linux, or unknown.
- **Browser mode**: Running vsText directly in a browser with browser filesystem capabilities where available.
- **Desktop mode**: Running vsText through Electron with native filesystem capabilities.
- **Sample workspace**: The built-in in-memory example workspace named `Sample Notes`.
- **Local filesystem**: Files and folders read from the user's machine through Electron or the browser File System Access API.
- **Cloud provider**: A planned external file provider such as OneDrive, Google Drive, or Dropbox.
- **Cloud root**: A future provider-backed workspace root discovered through a cloud API.
- **Scaffolded provider**: A provider whose UI and contract exist, but whose OAuth and file transport are not implemented yet.
- **Provider contract**: The shared interface for provider status, capabilities, workspace discovery, file reads, file writes, polling, and bundle sync.
- **Provider registry**: The runtime object that groups provider status and the active local provider implementation.
- **Provider readiness**: The provider state: `ready`, `scaffolded`, or `needs-config`.
- **Provider capability**: A provider feature flag, such as auth, workspace discovery, read file, write file, poll workspace, or bundle sync.
- **Client ID**: A cloud provider OAuth configuration value expected through `VITE_*_CLIENT_ID` environment variables.
- **OAuth**: The planned cloud-provider sign-in mechanism.
- **OneDrive relative path**: A portable path hint for locating local OneDrive-synced workspaces.

## Workspace Model

- **Workspace**: The real folder opened for editing, containing the user's actual files.
- **Workspace root**: The top-level opened folder and its provider metadata.
- **Workspace kind**: The workspace root category, currently `local-root` or future `cloud-root`.
- **Workspace ID**: The stable identifier used internally to associate files, buffers, sessions, and cached state.
- **Root ID**: The provider-specific identifier for a workspace root.
- **Root path**: The filesystem path or runtime path for the opened workspace root.
- **Display name**: The human-readable name shown for a workspace, bundle, or provider.
- **Workspace tree**: The folder/file hierarchy shown in Explorer.
- **File tree node**: A single file or directory entry in the workspace tree.
- **Tree node kind**: Whether a file tree node is a `file` or `directory`.
- **Workspace file record**: Metadata for a supported workspace file, including id, path, language, size, timestamps, conflict state, and draft state.
- **Workspace file snapshot**: A metadata-only reading of a real file or directory during polling or scanning.
- **Workspace entry operation**: A create, copy, move, rename, reveal, or delete action against a file tree entry.
- **Absolute path**: The full native filesystem path to a local file or folder.
- **Relative path**: The workspace-relative path used for tabs, manifests, drafts, and portable session state.
- **Workspace reference**: The portable description of where a workspace can be found again.
- **Local workspace reference**: A workspace reference for a local folder.
- **Cloud workspace reference**: A future workspace reference for a cloud-provider folder.
- **Device workspace hint**: A per-device absolute-path hint used to reopen a local workspace from a bundle.
- **Bundle-relative path**: A path from the workspace bundle to the workspace folder when that relationship can be represented portably.
- **Supported text extension**: A file extension treated as editable text, such as `md`, `txt`, `json`, `ts`, `tsx`, `js`, `py`, `css`, `html`, `yaml`, `toml`, or `csv`.
- **Supported binary extension**: A binary extension the app can preview. Currently this is `pdf`.
- **Unsupported file**: A file skipped by workspace loading because its extension is outside the supported text and binary lists.
- **Unavailable file**: A file record retained in state even though the underlying file is not currently reachable.
- **Skipped folder**: A folder omitted from scanning after the user skips it or a scan rule prunes it.

## Workspace Bundles And Session Files

- **Workspace bundle**: A user-chosen external sync folder that stores shared session state, drafts, and resolutions outside the real workspace. It is responsible for allowing the same workspace session to be shared between devices when the bundle folder is synced by OneDrive, Google Drive for desktop, Dropbox, or another sync tool.
- **Workspace bundle link**: The app's current connection to a workspace bundle and its workspace reference.
- **Bundle directory**: The folder selected or created as the workspace bundle.
- **Bundle directory suffix**: The `-vstext` suffix added to generated bundle folder names.
- **Bundle bootstrap**: The `vstext.json` metadata that identifies the bundle format, workspace id, display name, and workspace reference.
- **Bundle format**: The persisted bundle schema name. The current value is `multi-device-v1`.
- **Bundle manifest**: The runtime view of bundle state built from bootstrap metadata, device sessions, draft references, and resolution records.
- **Workspace manifest**: The app's normalized session manifest for a workspace.
- **Manifest file**: `vstext.json`, the root metadata file in a workspace bundle.
- **Manifest directory**: `vstext`, the bundle subfolder that contains session, draft, and resolution records.
- **Session folder**: `vstext/sessions`, the bundle location for device session files.
- **Draft folder**: `vstext/drafts`, the bundle location for draft files.
- **Resolution folder**: `vstext/resolutions`, the bundle location for draft-resolution files.
- **Session file**: A `.session.json` record for one saved device session revision.
- **Draft file**: A `.draft.json` record for unsaved content belonging to one dirty document.
- **Resolution file**: A `.resolution.json` record that retires reviewed remote drafts for a file.
- **Blob path**: The bundle-relative path to a saved draft or resolution payload.
- **Bundle scan**: Reading a bundle folder to find bootstrap metadata, sessions, drafts, and resolutions.
- **Bundle sync**: Reading or writing bundle session, draft, and resolution records.
- **Bundle autosave**: The delayed automatic save of session and draft metadata to the linked workspace bundle.
- **Bundle runtime**: The browser-side code that scans a bundle using File System Access handles.
- **Open Workspace Bundle**: The action that opens an existing bundle and resolves the referenced real workspace.
- **Change Save Location**: The action that selects or creates a different workspace bundle for future session saves.
- **Save Session**: The action that writes workspace session state and dirty-file drafts to the bundle.

## Sessions, Drafts, And Conflicts

- **Device**: One browser profile or desktop installation participating in a workspace session.
- **Device ID**: A locally stored UUID used to distinguish one device's sessions and drafts from another's.
- **Device name**: A readable runtime label such as `web:Win32` or `desktop:Win32`.
- **Device session**: One device's saved workspace state, including open tabs, active tab, layout, sidebar, search, cursor positions, and theme.
- **Session snapshot**: The app state captured before writing a device session.
- **Session revision**: A unique saved version of a device session.
- **Revision ID**: A timestamp-plus-UUID identifier used for sessions, drafts, and resolutions.
- **Head revision**: The numeric timestamp representing the latest known manifest update.
- **Last writer device ID**: The device ID associated with the latest manifest-changing record.
- **Pending remote session**: A newer session from another device that the current device has not acknowledged.
- **Remote session prompt**: The UI that lets the user resume, compare, or ignore a pending remote session.
- **Resume remote**: Applying a remote session's state to the current app.
- **Compare sessions**: Reviewing local and remote session sections before choosing which values to apply.
- **Session compare item**: A compare-row for tabs, active file, layout, sidebar, search, cursor positions, theme, or drafts.
- **Session selection**: Whether a compare item should use the local or remote value.
- **Use All Local**: A compare action that selects every local session value.
- **Use All Remote**: A compare action that selects every remote session value.
- **Acknowledged remote session**: A remote session revision the current device has already seen or dismissed.
- **Draft**: A bundle record for unsaved dirty content. It is not the real workspace file.
- **Draft reference**: Metadata that points to a draft payload in the bundle.
- **Foreign draft**: A draft created by another device.
- **Foreign draft metadata**: The summary data shown for another device's draft.
- **Remote draft**: Another name for a foreign draft.
- **Pending foreign draft count**: The number of remote drafts waiting for a file.
- **Draft merge**: The inline workflow for reviewing remote drafts against the current local file.
- **Draft merge entry**: One remote draft plus its loaded body during merge review.
- **Draft review**: The user-facing step-by-step inspection of remote drafts.
- **Use draft as base**: A merge action that replaces the working merged result with the remote draft content.
- **Save draft copy**: A merge action that writes a separate file containing a remote draft's content.
- **Skip file**: A merge action that leaves the current file unresolved for now.
- **Draft resolution**: The final file-level decision that writes resolved content and clears reviewed drafts.
- **Draft resolution record**: The bundle metadata that records who resolved a file, when, which drafts were cleared, and the final content hash.
- **Clear record**: A draft marker indicating that a previously dirty file on a device is now clean.
- **Cleared draft revision ID**: A draft revision retired by a resolution record.
- **Final content hash**: The hash of the resolved file body stored in a resolution record.
- **Content hash**: A stable hash of document text used to compare draft or resolution payloads.
- **Base remote revision**: The remote file revision or synced file snapshot a draft was based on.
- **Conflict state**: A file-level marker such as `disk-changed` or `foreign-draft-available`.
- **Disk conflict**: A save-time conflict caused by the real file changing on disk after the app last synced it.
- **Workspace file conflict dialog**: The UI that lets the user keep local content or save a copy when a disk conflict appears.
- **Keep local**: A conflict action that keeps the current editor content.
- **Keep remote**: A conflict action that accepts content from another source.
- **Save copy**: A conflict action that preserves local content in a separate file.
- **Dirty file**: A file whose in-memory content differs from its last saved or synced state.
- **Clean file**: A file with no unsaved in-memory changes.
- **Unsaved changes**: Dirty buffer content that has not been saved to the real file.
- **Dirty tab close prompt**: The confirmation shown before closing tabs that contain unsaved changes.
- **Close workspace prompt**: The confirmation shown before closing a workspace with unsaved session changes.

## Documents, Buffers, And Editor State

- **Document**: A workspace file as represented inside the editor.
- **Text document**: A workspace file record combined with an in-memory document buffer.
- **Document ID**: The internal id used to connect a file record, buffer, tab, and cursor state.
- **Document buffer**: The in-memory content and edit state for an opened or cached text document.
- **Cached body**: The text currently held in a document buffer.
- **Dirty buffer**: A buffer with unsaved edits.
- **Clean buffer**: A buffer without unsaved edits.
- **Persisted local buffer**: A buffer that has been saved to local IndexedDB cache.
- **Buffer map**: The in-memory lookup table of document IDs to document buffers.
- **File map**: The in-memory lookup table of document IDs to workspace file records.
- **Pinned buffer**: A buffer kept in memory because it is dirty or active in an editor group.
- **Clean-buffer eviction**: Removing older clean buffers from memory to keep memory use bounded.
- **Last accessed at**: The timestamp used to decide which clean buffers can be evicted first.
- **Encoding**: The text encoding detected or assigned for a document, such as UTF-8 or UTF-16.
- **UTF-8 BOM**: UTF-8 text with a byte-order mark at the start of the file.
- **Line ending**: The newline style for a document, currently LF or CRLF.
- **Binary detection**: A safety check that prevents likely binary files from being opened as text.
- **Language metadata**: The label and Markdown flag derived from a file extension.
- **Language extension**: The lazily loaded CodeMirror parser support for a language.
- **Markdown document**: A text document with Markdown preview support.
- **PDF document**: A supported binary file opened in a read-only preview.
- **Remote revision**: Provider-specific or synthesized file revision metadata.
- **Last synced modified time**: The file modification timestamp from the last known clean sync point.
- **Last synced size**: The file size from the last known clean sync point.
- **Cursor snapshot**: Saved cursor line, column, and scroll position for a document.
- **Search entry**: One search result with document id, path, title, snippet, score, and index time.
- **Search score**: A simple ranking value used to order search results.
- **Snippet**: The short surrounding text shown for a search match.
- **Workspace-wide search**: Searching across workspace content.
- **Loaded-buffer search**: Browser fallback search across buffers already loaded in memory.
- **Desktop search**: Electron main-process workspace scanning for search results.

## Editor UI

- **Activity bar**: The vertical icon rail for Files, Search, Sessions, Cloud Providers, and Settings.
- **Activity ID**: The internal id for an activity: `files`, `search`, `sessions`, `providers`, or `settings`.
- **Explorer**: The Files activity panel that displays the workspace tree.
- **Search panel**: The activity panel for workspace search.
- **Sessions panel**: The activity panel for bundle status, session save, remote session review, and save location.
- **Cloud Providers panel**: The activity panel that lists provider status and capabilities.
- **Settings panel**: The activity panel for user preferences such as theme and preview behavior.
- **Sidebar**: The side panel that hosts the active activity.
- **Sidebar state**: The persisted sidebar expansion and search-open state.
- **Layout state**: The persisted UI state for preview visibility, sidebar visibility, active activity, and mobile panel.
- **Mobile panel**: The active mobile view, currently tree, search, or preview.
- **Title bar**: The top app chrome with workspace status and primary actions.
- **Status bar**: The bottom app chrome showing active path, language, dirty status, cursor position, theme, and pending draft count.
- **Editor surface**: The main document area where editor groups render.
- **Editor surface placeholder**: The empty state shown before a file is opened.
- **Editor group**: One pane of tabs and editor content inside the editor surface.
- **Active group**: The editor group that currently receives open-tab and editor actions.
- **Group size**: A persisted percentage width for each editor group.
- **Split editor**: A multi-pane editor layout with more than one editor group.
- **Split Right**: The action that opens or moves a tab into a group to the right.
- **Resize handle**: A draggable divider for sidebar, editor groups, Markdown preview, or merge review panes.
- **Tab strip**: The row of open tabs for an editor group.
- **Tab**: An open document entry in a tab strip.
- **Active tab**: The tab currently shown in an editor group.
- **Open tabs**: The ordered list of tabs in a session or editor group.
- **Preview tab**: A reusable italic tab opened by single-clicking a file.
- **Promoted tab**: A preview tab converted to a permanent tab by editing, double-clicking, or choosing Keep Open.
- **Pinned tab**: A permanent tab that is not replaced by the next preview open.
- **Keep Open**: The action that promotes a preview tab.
- **Close Saved**: The tab context-menu action that closes only clean tabs.
- **Close to the Right**: The tab context-menu action that closes tabs after the selected tab.
- **Drag-and-drop tab reordering**: Moving tabs within a tab strip using native drag and drop.
- **Cross-group tab move**: Dragging a tab from one editor group into another.
- **Drop indicator**: The visual marker showing where a dragged tab will land.
- **Tab drag state**: The active drag metadata: source group, document, target group, target tab, and insertion side.
- **Tab badge**: The small count shown on a tab when remote drafts are pending.
- **Dirty indicator**: The visual marker for unsaved changes in the tree, tab strip, or status bar.
- **Context menu**: A right-click menu for tabs, files, folders, or empty Explorer space.
- **Inline create**: Creating a file or folder through an editable row in Explorer.
- **Inline rename**: Renaming a file or folder through an editable row in Explorer.
- **Reveal in File Explorer**: The desktop-only action that opens a file's location in the system file manager.
- **Copy Path**: The action that copies the full filesystem path.
- **Copy Relative Path**: The action that copies the workspace-relative path.
- **Markdown preview**: The rendered preview pane for Markdown documents.
- **PDF preview**: The read-only iframe preview for PDF files.
- **Merge review pane**: The side pane used during draft review.
- **Preview pane**: The UI area used for Markdown preview or merge review.
- **Resizable pane**: A pane whose width can be dragged within clamped limits.
- **Theme mode**: The user's theme preference: `system`, `light`, or `dark`.
- **Resolved theme**: The actual active theme: `light` or `dark`.
- **System theme**: A theme mode that follows the operating system preference.

## Scanning, Polling, And Persistence

- **Workspace scan**: Reading a workspace folder to build metadata and the file tree.
- **Metadata-first scan**: A scan that reads paths, sizes, and timestamps without loading every file body.
- **Lazy workspace loading**: Opening a workspace without reading file bodies until content is needed.
- **Lazy document buffer**: A document buffer loaded only when a file is opened, saved, searched, merged, or previewed.
- **Workspace polling**: Periodically checking the real workspace for file and folder metadata changes.
- **Bundle polling**: Periodically checking the workspace bundle for remote sessions, drafts, and resolutions.
- **Scan overlay**: The UI that shows live workspace scan progress.
- **Open directory progress event**: The progress event emitted during an Electron folder scan.
- **Workspace scan progress**: The renderer-side scan state with processed entries, loaded files, current path, folder stack, skip target, and cancellation state.
- **Folder stack**: The nested folder path currently being scanned.
- **Cancel scan**: The action that stops a workspace scan and opens the partially scanned workspace.
- **Skip folder**: The action that stops scanning the current long-running non-root folder.
- **Entries processed**: The count of files and folders visited during a scan.
- **Files loaded**: The count of supported files added during a scan.
- **Load warning**: A non-fatal warning produced while opening a workspace.
- **Cached snapshot**: A local IndexedDB copy of workspace metadata, session state, and dirty buffers.
- **Local cache**: Device-only IndexedDB storage used to restore the app locally.
- **IndexedDB**: The browser database used through Dexie for workspace cache, files, buffers, settings, and manifests.
- **Dexie**: The IndexedDB wrapper used by the app.
- **Text workspace database**: The `vstext-db` IndexedDB database.
- **Stored setting**: A persisted key/value preference.
- **Workspace cache restore**: Loading a cached snapshot on app startup.
- **Cache hydration**: Rebuilding runtime state from cached workspace, file, and buffer records.
- **File handle**: A browser File System Access API handle to a file.
- **Directory handle**: A browser File System Access API handle to a directory.
- **File System Access API**: Browser API used to open folders, read files, and write files.
- **Filesystem permission**: Browser or desktop access to a selected workspace or bundle folder.
- **Open directory result**: The Electron result for a selected folder, including root metadata, tree, warnings, and scan counts.
- **Bundle directory selection**: The selected bundle folder path and name.
- **File write result**: The updated modified time and size returned after a write.

## Build, Packages, And Project Files

- **Workspace package**: A package managed by the root `pnpm-workspace.yaml`.
- **`apps/web`**: The React + Vite renderer app.
- **`apps/desktop`**: The Electron desktop shell.
- **`packages/core`**: Shared JavaScript helpers and constants used by browser and Electron code.
- **`dist/apps/web`**: The built web renderer output loaded by production Electron builds.
- **`release`**: The output directory for packaged desktop builds.
- **pnpm**: The package manager required by this project.
- **Vite**: The web dev server and bundler.
- **React**: The UI framework used by the renderer.
- **TypeScript**: The typed source language used by the web app.
- **CodeMirror 6**: The editor engine used for text editing and syntax highlighting.
- **Lucide React**: The icon library used by the app shell.
- **React Markdown**: The Markdown rendering library.
- **Remark GFM**: Markdown extension support for GitHub Flavored Markdown.
- **Rehype Sanitize**: HTML sanitization for rendered Markdown.
- **Vitest**: The unit-test runner.
- **Electron Builder**: The packager used for Windows portable desktop builds.
- **Portable executable**: The Windows `.exe` artifact produced by `pnpm dist:win`.
- **Corepack**: The Node package-manager shim used in documented setup commands.
- **Vite PWA plugin**: The build plugin that emits PWA assets and service worker support.
- **Workbox**: The PWA service worker helper dependency.
- **Service worker**: The browser worker used by PWA builds for installability and caching behavior.
- **Initial bundle**: The first JavaScript bundle downloaded by the web app.
- **Lazy chunk**: A code chunk loaded only when needed, such as editor, language, or Markdown preview code.
- **Bundle size**: The emitted JavaScript size tracked during optimization work.

## Source-Code Type Names

- **`ProviderId`**: The union of provider ids: `local`, `onedrive`, `gdrive`, and `dropbox`.
- **`ThemeMode`**: The persisted theme preference type.
- **`ResolvedTheme`**: The concrete active light or dark theme type.
- **`ActivityId`**: The app activity identifier type.
- **`WorkspaceKind`**: The root-kind type for local and cloud workspaces.
- **`TreeNodeKind`**: The file-tree node kind type.
- **`ProviderReadiness`**: The provider readiness status type.
- **`Encoding`**: The supported text encoding type.
- **`LineEnding`**: The supported line-ending type.
- **`SessionSelection`**: The compare selection type for local or remote session values.
- **`CursorSnapshot`**: The saved cursor and scroll position type.
- **`SidebarState`**: The persisted sidebar state type.
- **`SearchState`**: The persisted search UI state type.
- **`LayoutState`**: The persisted editor-shell layout type.
- **`FileTreeNode`**: The file or directory tree node type.
- **`WorkspaceRoot`**: The opened workspace root type.
- **`DeviceWorkspaceHint`**: The per-device local path hint type.
- **`LocalWorkspaceReference`**: The local workspace reference type.
- **`CloudWorkspaceReference`**: The future cloud workspace reference type.
- **`WorkspaceReference`**: The union of local and cloud workspace references.
- **`WorkspaceBundleLink`**: The current bundle-link type.
- **`ForeignDraftMetadata`**: The remote-draft summary type.
- **`DraftResolutionRecord`**: The draft-resolution metadata type.
- **`DraftRef`**: The draft reference type.
- **`WorkspaceFileRecord`**: The workspace file metadata type.
- **`DocumentBuffer`**: The in-memory document buffer type.
- **`TextDocument`**: The merged workspace file and buffer type.
- **`DeviceSession`**: The persisted per-device session type.
- **`DeviceSessionEditorGroup`**: The persisted editor-group state inside a device session.
- **`BundleBootstrap`**: The bundle bootstrap metadata type.
- **`WorkspaceManifest`**: The normalized runtime manifest type.
- **`SessionCompareItem`**: The session comparison row type.
- **`SearchEntry`**: The search result type.
- **`WorkspaceFileSnapshot`**: The metadata snapshot type for files and directories.
- **`BundleScanResult`**: The result of scanning a workspace bundle.
- **`CachedWorkspace`**: The local cached workspace snapshot type.
- **`StoredSetting`**: The local persisted setting type.
- **`FileWriteResult`**: The result of a successful file write.
- **`WorkspaceEntryOperation`**: The file-tree operation target type.
- **`OpenDirectoryResult`**: The desktop open-folder result type.
- **`BundleDirectorySelection`**: The selected bundle directory type.
- **`WorkspaceScanFolder`**: One folder entry in the active scan stack.
- **`OpenDirectoryProgressEvent`**: The desktop folder-scan progress event type.
- **`WorkspaceScanProgress`**: The renderer scan-progress state type.
- **`AppDesktopApi`**: The Electron preload API exposed to the renderer.
- **`ProviderCapabilities`**: The provider feature capability type.
- **`ProviderStatus`**: The provider status displayed in the UI.
- **`EditorGroupState`**: The runtime state for one editor group.
- **`TabDragState`**: The runtime state for a dragged tab.
