# Plan: Multi-Device Draft Merge Workflow

## Summary

Replace file draft review from a `pick one version` flow to a real `merge into a working result` flow.

When a file has drafts from multiple devices, opening that file, or explicitly refocusing its tab, starts a sequential merge review for that file only. The user edits a working merged result directly in the main editor while reviewing one remote draft at a time. After the last remote draft is reviewed, the app auto-resolves the file: it writes the final merged body to the real workspace file, publishes a shared draft-resolution record, and clears all reviewed remote drafts for that file across devices.

`Skip file` remains available. If the user skips, nothing is cleared and the file keeps its pending-draft notification. Review is offered again the next time that file is explicitly focused.

## Key Changes

### Draft data model

- Replace `TextDocument.foreignDraft` with:
  - `foreignDrafts: ForeignDraftMetadata[]`
  - `pendingForeignDraftCount: number`
- Add immutable bundle records for shared file-level resolution:
  - `DraftResolutionRecord { revisionId, path, resolvedAt, resolvedByDeviceId, resolvedByDeviceName, clearedDraftRevisionIds: string[], finalContentHash }`
- Bundle scans must return `resolutions` along with `sessions` and `drafts`.
- Active remote drafts for a file are computed as:
  - all latest foreign drafts for that path
  - minus any draft revisions already listed in a resolution record for that path

### File activation and review trigger

- Route file tree open, search open, tab activation, and clicking the already-active tab through one central file-activation handler.
- Draft review starts only when:
  - the user opens a file with pending remote drafts, or
  - the user explicitly focuses that file’s tab again
- Bundle polling does not auto-open merge UI. It only updates counts, metadata, and pending indicators.

### Merge presentation

- Use an inline merge mode in the main editor region, not a separate modal or extra merge tab.
- Layout during merge mode:
  - main editor remains the editable `working result`
  - a temporary side panel shows the current remote draft read-only
  - a top merge bar shows file name, device name, saved time, and progress like `Draft 2 of 4`
- The working result starts as the current local editor buffer.
- Each remote draft is reviewed sequentially, newest-first.
- The user merges manually by editing the working result directly while the remote draft stays visible for reference.
- Per-step actions:
  - `Next draft`: accept the current working result as the result of this step and move on
  - `Use draft as base`: replace the working result with the current remote draft, then continue editing or advance
  - `Save draft copy`: open the current remote draft in a separate local copy tab, keep the working result unchanged
  - `Skip file`: leave merge mode immediately, do not write or clear anything
- No automatic text merge algorithm in v1. Merge is user-driven text editing with draft comparison context.

### Resolution semantics

- After the last remote draft is reviewed without skipping:
  - the current working result becomes the final resolved body for the original file
  - if it differs from disk, write it to the workspace file immediately
  - emit one `DraftResolutionRecord` for that file containing all reviewed foreign draft revisions
  - clear merge mode and clear pending foreign drafts for that path locally
  - refresh bundle state so all devices stop surfacing those drafts
- Resolution is file-level, not draft-level. One completed merge run for a file retires every reviewed remote draft revision for that file.
- New drafts created later for the same file still appear normally.

### Other devices after resolution

- A published `DraftResolutionRecord` is authoritative.
- If another device still has that file open with stale dirty content, then on poll, focus refresh, or pre-save check:
  - it must adopt the resolved file result automatically
  - clear dirty state and all pending foreign drafts for that path
  - exit any local draft-review UI for that path
  - it must not offer `Keep local` against a file that was already globally resolved elsewhere
- `saveWorkspaceSession` must rescan bundle state before emitting drafts:
  - if the file was already resolved elsewhere, do not write a stale draft revision for it

### Session merge

- Keep the previously agreed session plan:
  - replace the single remote-session prompt with a session picker listing all pending foreign sessions
  - compare/apply one selected foreign session at a time
  - after applying one session, the result becomes the local base for the next selected session
  - user chooses session order manually

### Notifications

- Show pending draft count on file tabs.
- Show pending draft count for the active file in the status bar.
- Show pending foreign session count in the Sessions area.

## Test Plan

- A file with drafts from multiple devices opens into merge mode and reviews drafts newest-first.
- The working result is editable throughout the review and carries forward between steps.
- `Use draft as base` replaces the working result with the remote draft and later edits persist into following steps.
- `Save draft copy` creates a separate local tab without changing the working result.
- `Next draft` preserves the edited working result and advances correctly.
- `Skip file` leaves all remote drafts untouched, keeps the pending count, and reopens review on the next explicit focus of that file.
- After the last reviewed draft, the app auto-resolves the file, writes the final body, emits one resolution record, and clears all reviewed remote drafts across devices.
- Another device with stale dirty content force-adopts the resolved result on refresh/focus/save and cannot recreate the cleared drafts.
- Clicking the already-active tab retriggers review for a file that still has pending drafts.
- Multiple foreign sessions still appear in the session picker and can be merged step by step independently of file draft review.

## Assumptions and Defaults

- Draft merge is manual text editing, not automatic 3-way merge or CRDT-style collaboration.
- Draft review order is newest-first.
- `Skip file` suppresses nothing permanently; it simply aborts the current review and the file prompts again on next explicit focus.
- Auto-resolution happens immediately after the last reviewed draft for a file; it does not wait for a separate confirm step.
- One finished merge run resolves all reviewed foreign draft revisions for that file globally.
