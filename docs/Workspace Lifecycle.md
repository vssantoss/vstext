# Workspace Lifecycle

This document explains all important workspace-related events in the app.

## Terms

- `Workspace`: the real folder you opened, with actual files on disk.
- `Workspace bundle`: the optional shared sync folder used for sessions, drafts, and resolutions.
- `Cached snapshot`: a local-only IndexedDB copy of the current workspace metadata, session state, and dirty buffers, used to restore the app on next launch.
- `Draft`: a bundle record for a dirty file. This is different from the local cached snapshot.

## What Happens When I Open The App?

1. The app starts with the sample workspace loaded in memory.
2. It then tries to restore the last cached workspace snapshot from IndexedDB.
3. If a cached workspace exists, it replaces the sample workspace in the UI.
4. If no cached workspace exists, the sample workspace stays loaded.

Important:

- This restore uses local cache only.
- It does not automatically reopen filesystem permissions in the browser.
- It does not automatically reopen a bundle folder in the browser unless the browser session still has that access.

## What Gets Cached Locally?

The app locally caches:

- the current workspace root
- the file tree
- per-file workspace metadata
- the current manifest
- the linked bundle reference
- session/layout state
- dirty document buffers, including unsaved in-memory content

This cache is saved to IndexedDB after about 350ms whenever workspace or document state changes.

## What Happens When I Open A Local Workspace?

1. The app asks you to choose a folder.
2. It scans supported files in that folder for metadata only.
3. It builds the workspace tree.
4. It creates workspace file records from those paths.
5. It clears previous bundle access if needed.
6. It hydrates the app state with this workspace.

Important:

- Opening a workspace does not preload every file body into memory.
- Text bodies load only when a file is opened, saved, merged, or otherwise needs content.
- In browsers, binary detection for mislabeled files now happens when a file is opened as text, not during the initial scan.

Supported files are text-based file types such as `.md`, `.txt`, `.json`, `.ts`, `.tsx`, `.js`, `.py`, `.css`, `.html`, `.xml`, `.yaml`, `.toml`, and others supported in the code.

## What Happens When I Open A Workspace Bundle?

1. The app asks you to choose a bundle folder.
2. It scans the bundle contents.
3. It checks the bundle bootstrap metadata.
4. It resolves the real workspace folder that the bundle refers to.
5. It opens that real workspace.
6. It builds a runtime manifest from bundle sessions, drafts, and resolutions.
7. It hydrates the app with the workspace and bundle state.

The bundle stores:

- `vstext.json`
- `vstext/sessions/...`
- `vstext/drafts/...`
- `vstext/resolutions/...`

## What Happens When I Open The Sample Workspace?

1. The app clears real workspace access.
2. The app clears bundle access.
3. It loads the bundled sample files in memory.

Important:

- The sample workspace is editable in memory.
- Saving a file in the sample workspace does not write to disk.
- Saving a bundle for the sample workspace is blocked.

## What Happens When I Edit A File?

When you type in the editor:

- the active buffer `cachedBody` changes
- the active buffer becomes `dirty`
- the file `size` updates
- the file `modifiedAt` updates

Important:

- This does not write the workspace file yet.
- This does not necessarily write a bundle draft yet.

## What Happens When I Click Save File?

When you save the current file:

1. The app checks whether a draft merge is currently active for that file.
2. If merge review is active, file save is blocked until you finish or skip the review.
3. If the current workspace is the sample workspace, the file is marked clean in memory only.
4. If a real workspace is open, the app checks the current file snapshot on disk.
5. If the on-disk file no longer matches the last synced snapshot, the app opens a disk-conflict flow instead of saving.
6. If the snapshot still matches, the app writes the file to the real workspace folder.
7. The document is then marked clean and its synced timestamps and size are updated.

Important:

- File save writes the real workspace file.
- File save does not directly mean “save a bundle draft”.

## What Happens If The File Changed On Disk Before I Save?

If the file changed outside the app:

- and your local document is clean, the app refreshes metadata and reloads content only if that file is visible
- and your local document is dirty, the app opens a disk-conflict flow

If the file was deleted outside the app:

- and your local document is clean, it may disappear from the workspace
- and your local document is dirty, the app raises a conflict instead of silently dropping your work

## When Does The App Check The Real Workspace For Changes?

The app checks workspace files:

- every 30 seconds
- when the window gets focus
- when the page becomes visible again

This is for the real workspace files on disk, not the bundle.

Important:

- Workspace polling is metadata-first.
- Clean files that are not visible do not get reread into memory during polling.

## When Does The App Check The Bundle For Changes?

The app checks the bundle:

- every 15 seconds
- when the window gets focus
- when the page becomes visible again

This is how it detects:

- remote sessions
- remote drafts
- remote resolutions

## What Is A Draft?

A draft is a saved bundle record for a dirty file.

Drafts are not the real workspace file.

They are used to:

- preserve unsaved changes across devices
- enable cross-device draft review and merge

## What Are The Conditions To Save A Draft?

A draft is saved only when all of these are true:

1. the current workspace is not the sample workspace
2. a workspace bundle is linked and accessible
3. the document is dirty
4. bundle session save runs

Bundle session save runs:

- automatically after about 1.4 seconds of relevant changes
- when the app becomes hidden
- when you manually save the workspace session

## Where Is A Draft Saved?

Drafts are saved inside the bundle folder, not inside the workspace folder.

Draft path format:

- `vstext/drafts/<deviceId>/<docKey>/<revisionId>.draft.json`

## If I Do Not Have A Workspace Open, Is A Draft Saved While I Work On A File?

There are two cases.

### Case 1: Only the sample workspace is open

No.

- The app may keep your edits in the local IndexedDB cache.
- But it does not write bundle drafts.
- It does not write real files to disk.

### Case 2: A real workspace is open, but no bundle is linked

Also no.

- The app keeps your edits in memory.
- The app caches workspace state locally in IndexedDB.
- But it does not write bundle drafts because there is no active bundle target.

So the short answer is:

- no bundle linked: no bundle drafts
- sample workspace: no bundle drafts
- local cache may still contain unsaved state for app restore

## What Is The Difference Between Local Cache And Drafts?

Local cache:

- stored in IndexedDB on this device only
- used to restore the app locally after restart
- restores workspace metadata and dirty buffers immediately
- does not persist every clean file body
- not meant for cross-device sync

Draft:

- stored in the workspace bundle
- visible to other devices using the same bundle
- used for remote draft review and merge

## What Happens During Bundle Autosave?

When bundle autosave runs:

1. the app ensures a valid bundle target exists
2. it reads the latest manifest from the bundle
3. it syncs local document state against bundle resolutions and remote drafts
4. it writes the current device session as a new immutable session file
5. it writes new draft files for all dirty documents
6. it writes draft-clear records for files that used to be dirty on this device but are now clean
7. it reloads the bundle manifest
8. it syncs local state again from the updated manifest

Important:

- bundle autosave writes session and draft metadata
- it does not replace workspace file save

## What Happens When A File Has Remote Drafts?

Remote drafts do not automatically replace the editor content.

Draft review only starts when:

- you open that file, or
- the file is already open and you explicitly focus its tab again

When review starts:

1. the app loads all foreign drafts for that file
2. it sorts them newest first
3. it enters inline merge review mode
4. the main editor becomes the working merged result
5. a side panel shows the current remote draft

Per draft step, you can:

- `Next draft`
- `Use draft as base`
- `Save draft copy`
- `Skip file`

## What Happens When I Finish Draft Merge?

After the last reviewed draft:

1. the current editor content becomes the final resolved result
2. the app writes that final content to the real workspace file
3. it creates a `DraftResolutionRecord`
4. it clears the reviewed remote drafts for that file
5. it saves the workspace session so stale drafts from this device are not recreated

Important:

- resolution is file-level
- reviewed drafts for that file are retired globally
- newer drafts created later can still appear normally

## What Happens On Other Devices After A Draft Resolution?

If another device already resolved a file:

1. this device sees the resolution on bundle sync
2. it adopts the resolved content
3. it clears local dirty state for that file
4. it clears pending foreign drafts for that file
5. it exits merge UI for that file if merge was active

This prevents stale local state from recreating already-cleared remote drafts.

## What Happens When I Click Save Session?

This saves the workspace bundle, not the active file directly.

It may:

- create the bundle if needed
- write bundle bootstrap metadata
- write the current device session
- write dirty-file drafts
- write clear records for drafts that should be removed

## What Happens When I Change Bundle Location?

1. the app asks for a new bundle folder
2. it creates or links the new bundle target
3. it writes the current session state into that new bundle

This changes where sessions, drafts, and resolutions are stored.

## What Happens If The Bundle Is Remembered But Not Accessible?

This mostly affects browser mode.

The app can remember the bundle link in local cache, but browser filesystem access may be gone after reload.

In that case:

- the bundle is remembered
- the app shows that it must be reopened in the current browser session
- bundle sync and draft writes do not work until access is restored

## What Is The Simplest Mental Model?

- Editing changes in-memory document state.
- Saving file writes the real workspace file.
- Saving session writes bundle session and drafts.
- Local cache restores your last app state on the same device.
- Bundle drafts and resolutions coordinate work across devices.
