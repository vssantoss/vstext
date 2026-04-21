# Conflict-Safe Multi-Desktop Workspace and File Sync

## Summary

- Keep the multi-device bundle design, but extend it to cover the real workspace files and foreign unsaved drafts.
- The bundle becomes safe for multiple desktops by using immutable, device-scoped revision files.
- The editor becomes safe for shared synced folders by detecting on-disk file changes on focus and on a periodic poll before a stale editor buffer can overwrite them.
- This is not live collaboration. It is explicit conflict detection and recovery with no silent overwrite of a file that changed on another device, and no silent application of an unsaved draft from another device.

## Interface Changes

- Keep `vstext.json` as stable bootstrap metadata only.
- Add immutable bundle revision shapes:
  - `DeviceSessionRevision`: one file per save under `vstext/sessions/<deviceId>/...`
  - `DeviceDraftRevision`: one file per dirty document save under `vstext/drafts/<deviceId>/...`
- Extend `TextDocument` with workspace-sync state:
  - `lastSyncedModifiedAt: string`
  - `lastSyncedSize: number`
  - `conflictState?: "disk-changed" | "foreign-draft-available"`
  - `foreignDraft?: { deviceId, deviceName, savedAt, contentHash }`
- Add an internal workspace scan result shape:
  - `WorkspaceFileSnapshot { path, absolutePath?, modifiedAt, size, exists }`
- Add one explicit desktop API instead of reloading the full tree on every check:
  - `scanWorkspace(rootPath)` returning metadata-only snapshots for all supported text files
  - keep `readFile` for targeted reload when one file actually changed

## Implementation Changes

- Bundle safety:
  - `vstext.json` is written only on bundle creation or explicit metadata changes.
  - Autosave writes only new immutable files owned by the current device.
  - Electron uses temp-file-then-rename for revision files.
  - Browser writes unique new files only; no shared mutable bundle file is rewritten during autosave.
  - On read, scan all device revision folders, pick the latest valid revision per device and per draft, and ignore corrupt or duplicate sync-provider files.
  - Keep the current remote prompt/compare UX, but feed it from the newest foreign device revision instead of a shared manifest head.
- Workspace-file change detection:
  - Add `pollWorkspaceChanges()` and run it on:
    - `window.focus`
    - `visibilitychange` when state becomes `visible`
    - a background interval every 30 seconds while a real workspace is open
  - Debounce scans so only one scan runs at a time.
  - Scan metadata first, not file bodies. Reload file content only for files whose `modifiedAt` or `size` changed, or files newly added to the tree.
  - Detect:
    - file changed on disk
    - file added
    - file deleted
    - rename as delete + add
- Conflict behavior for real workspace files:
  - Clean local document + newer disk version:
    - auto-reload from disk
    - update `lastSyncedModifiedAt` and `lastSyncedSize`
  - Dirty local document + newer disk version:
    - mark `conflictState: "disk-changed"`
    - show a conflict dialog before save or when the file becomes active
    - options are:
      - `Keep Local`: overwrite disk with local editor content, then refresh baseline
      - `Use Disk`: replace editor content with disk content and clear dirty state
      - `Save Copy`: create a new in-memory dirty tab named `<base>.local-conflict.<ext>` and keep the original conflicted file unchanged
  - Deleted file on disk:
    - clean local document: close or mark unavailable and remove from tree
    - dirty local document: show the same conflict dialog, with `Use Disk` meaning accept deletion and `Keep Local` recreating the file on next save
- Foreign draft behavior:
  - Foreign drafts are treated as unsaved state from another device, not as canonical file contents.
  - Opening a file that has a foreign draft must never silently replace the editor buffer.
  - If the local file is clean and a foreign draft exists:
    - open the current on-disk file normally
    - mark `conflictState: "foreign-draft-available"`
    - show a banner or prompt: `Draft available from another device`
    - options are `Open Draft`, `Compare`, and `Dismiss`
  - `Open Draft` loads the foreign draft into the editor as a dirty buffer only; it does not write to disk.
  - `Compare` opens the same conflict UI with local/on-disk content on one side and the foreign draft on the other.
  - `Dismiss` hides the prompt for that foreign draft revision only, not forever.
  - If the local file already has unsaved edits and a foreign draft exists, show the draft conflict dialog immediately.
  - If multiple foreign drafts exist for the same file, surface only the newest one by default and allow the others to be ignored in v1.
- Save guard:
  - Before any workspace file write, re-check that file's current disk snapshot.
  - If the disk snapshot differs from `lastSyncedModifiedAt` or `lastSyncedSize`, do not write immediately; raise the disk conflict flow first.
  - This guard is required even with focus polling so a stale background tab cannot silently overwrite a newer synced copy.
- Tree refresh:
  - When scan detects add/delete/rename, refresh the file explorer tree and keep open tabs mapped by path where possible.
  - If an open file disappeared, mark it unavailable until the user resolves it.

## Test Plan

- Two devices edit different files in the same synced workspace and both saves succeed without bundle conflicts.
- Two devices edit the same file; device B regains focus after device A saved and the app detects the disk change before B saves.
- Dirty local file plus newer disk file triggers the conflict dialog and blocks silent overwrite.
- `Keep Local` overwrites disk and updates baseline fields.
- `Use Disk` reloads the newer file and clears dirty state.
- `Save Copy` preserves local work in a new dirty tab and leaves the conflicted original untouched.
- Clean file changed on disk reloads automatically.
- Opening a file with a foreign draft does not silently replace the editor content.
- Clean local file plus foreign draft shows the draft-available prompt.
- Dirty local file plus foreign draft opens the draft conflict dialog immediately.
- `Open Draft` loads the foreign content as a dirty buffer without writing to disk.
- Added, deleted, and renamed files are reflected in the explorer after focus or polling.
- Bundle loader ignores corrupt JSON and sync-provider duplicate copies while still recovering the latest valid device revisions.
- Browser and Electron both perform focus-based and interval-based workspace checks.

## Assumptions

- The app should protect both the bundle files and the actual synced workspace documents.
- The design must work in both Electron and browser.
- No live collaboration, file locking, or auto-merge in v1.
- The current resume/compare prompt stays; it is not replaced by a new sessions list workflow.
- Foreign drafts are advisory unsaved state and never override on-disk content automatically.
- This remains a greenfield change, so no backward-compatible dual-write format is required.
