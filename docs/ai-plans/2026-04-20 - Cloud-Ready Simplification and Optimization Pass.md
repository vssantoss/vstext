# Cloud-Ready Simplification and Optimization Pass

## Summary

- Keep cloud integration as a first-class future capability, but stop mixing that unfinished work into the local-editor runtime.
- Aggressively simplify the codebase around what ships today while reorganizing provider code into a clean foundation for upcoming OneDrive, Google Drive, and Dropbox work.
- Primary goals: reduce renderer complexity, shrink hot paths and bundle size, remove dead code, and make provider integration implementation-ready instead of scaffold-shaped.

## Key Changes

### 1. Split the app into explicit runtimes

- Break the current root app into a thin shell plus focused modules:
  - workspace runtime: open, scan, poll, lazy buffers, save, disk conflict
  - bundle runtime: manifest, drafts, resolutions, autosave, remote session detection
  - editor runtime: tabs, preview tabs, splits, drag/drop, active group
  - provider runtime: provider registry, auth/config state, provider capabilities, future cloud entrypoints
  - app persistence/runtime hydration: theme, cache restore, session restore
- Move shared pure logic into a shared core layer so browser and Electron stop re-implementing the same normalization, manifest shaping, revision ordering, and extension filtering.

### 2. Make cloud integration code worth keeping

- Keep provider types, provider activity, and provider-facing code paths.
- Replace the current placeholder-shaped provider layer with a real provider contract:
  - auth/config status
  - capability flags
  - workspace root discovery/open
  - file listing/read/write/poll interfaces
- Make `local` conform to the same provider contract so future cloud providers plug into the same runtime instead of branching through the app shell.
- Keep provider UI visible, but make it explicit scaffold status rather than throwing placeholder errors from fake adapters.
- Preserve the bundle-sync model as a separate concern from direct cloud-root workspaces.

### 3. Simplify the monolith and duplicated logic

- Refactor the root renderer so it stops owning filesystem I/O, bundle I/O, tab logic, polling, search orchestration, and provider state in one file.
- Split the shell layer into shell frame, panels, dialogs, and tab strip modules.
- Split desktop main-process code by concern: window/bootstrap, workspace IPC, bundle IPC, provider/search IPC.
- Remove duplicated constants and parsing logic currently repeated between browser and desktop code, especially:
  - supported file extension lists
  - bundle bootstrap/session/draft/resolution normalization
  - workspace tree/snapshot shaping rules

### 4. Optimize runtime speed and bundle size

- Keep the current lazy-buffer workspace model and build on it rather than adding more root-level state.
- Reduce render churn:
  - centralize timers/focus/visibility polling in one scheduler
  - move broad derived maps/sorts out of render-time hot paths
  - prefer selectors/reducers over ad hoc state spreads in the app root
- Reduce JS payload:
  - stop statically bundling all CodeMirror language packages into the editor chunk
  - load language extensions on demand by file type and cache them
  - add explicit Vite chunking so editor core, optional languages, markdown preview, and PDF preview split cleanly
- Keep desktop search as the only workspace-wide search implementation; web stays without workspace search.

### 5. Align docs and product surface with the real system

- Update README and lifecycle docs so they accurately describe:
  - local workspaces
  - optional bundle sync
  - desktop-only workspace search
  - provider integrations as scaffolded but intentionally retained for upcoming work
- Keep the provider panel, but present clear readiness states instead of implying fully working cloud roots.

## Planned Removals

- `SyncJob` model and Dexie `syncJobs` table:
  - Intended for a future write queue/sync engine.
  - Current reality: unused.
- Renderer-side `lib/search.ts`:
  - Intended for in-renderer workspace search.
  - Current reality: superseded by desktop main-process search and disabled web search.
- `DraftConflictDialog` and `findDraftConflicts(...)`:
  - Intended for explicit local-vs-remote draft conflict handling.
  - Current reality: not used by the shipped draft-merge flow.
- `flattenTree(...)` and any other no-caller helpers:
  - Intended as generic tree utilities.
  - Current reality: dead code.
- Unused Electron preload/main IPC after refactor, especially methods with no renderer caller.
- Provider placeholder behavior that only exists to throw “not configured yet” errors, but not the provider surface itself.

## Test Plan

- Keep `pnpm build:web` and `pnpm test:web` green during each stage.
- Add unit tests for the new shared core:
  - revision ordering
  - bundle/session/draft/resolution normalization
  - extension filtering and workspace tree shaping
- Add reducer/runtime tests for:
  - tab and split behavior
  - preview-tab replacement
  - lazy buffer residency and eviction
  - disk conflict and draft-merge state transitions
- Add provider-runtime tests for:
  - configured vs unconfigured provider states
  - capability flags
  - local provider conformance to the shared provider contract
- Add bundle/build acceptance checks:
  - no emitted chunk over 500 kB minified
  - editor chunk materially smaller than the current large CodeMirror-heavy chunk
- Re-run lifecycle scenarios manually after refactor:
  - open local workspace
  - restore cached workspace
  - save file
  - detect disk change
  - save bundle session
  - receive remote session
  - review/resolve remote drafts
  - open provider panel and verify honest scaffold states

## Assumptions and Defaults

- Keep both Electron and PWA builds.
- Keep current real features: local workspaces, bundle sync, markdown preview, PDF preview, split editor groups, draft merge, and desktop search.
- Keep provider integration code and provider UI surface.
- This pass should make provider work easier to start, not implement actual cloud APIs yet.
- No backward-compatibility work is required.
- Aggressive deletion is allowed everywhere except the cloud/provider foundation that you want preserved and improved.
