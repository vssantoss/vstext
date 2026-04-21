# VS Text

VS Text is a cross-platform text editor designed to run as both a web application and a desktop application from the same codebase. The web version is packaged as a PWA, and the desktop version is wrapped with Electron, so the editor can be used in the browser, installed like an app, or run locally as a native desktop shell.

The application is built for users who want a focused editor for text-based files without being locked to a single machine. It supports local folder workspaces, tabbed editing with preview tabs and split editor groups, Markdown preview, read-only PDF preview, syntax highlighting for common file types, desktop-only workspace search, and a responsive interface that works on desktop and mobile layouts. It also includes light, dark, and system theme modes so the interface adapts cleanly across devices and environments.

A central part of the project is its workspace session model. VS Text saves shared editor session state into a user-chosen workspace bundle folder, keeping `vstext.json` plus `vstext/drafts` outside the opened work folder. That lets a workspace be reopened on another computer and resumed with tabs, layout, theme choice, and other session details without auto-writing session files into the project itself. When the bundle is synchronized between machines through a cloud sync client such as OneDrive, Google Drive for desktop, or Dropbox, the app can detect that a newer session exists and let the user resume it, compare both sessions, or keep the current one.

Today, the application already works well for local-folder editing in the browser and in Electron. The architecture also prepares the project for direct cloud-provider integrations, with a shared provider contract and visible scaffold states for future OneDrive, Google Drive, and Dropbox support.

## Some notes

We are very very early in this project. Expect bugs.

## Repository Layout

The repository is organized so app targets live under `apps/`:

- `apps/web`: React + Vite renderer, including the PWA shell
- `apps/desktop`: Electron main and preload processes
- `dist/apps/web`: built renderer output loaded by Electron in production

This keeps the project root focused on shared workspace files and leaves room for future targets such as additional apps or backend services.

Current implemented foundation:

- PWA-ready React + Vite app
- Electron shell with a preload-only local filesystem bridge
- Shared provider contract with a ready local provider and scaffolded cloud providers
- Responsive mobile/desktop layout
- CodeMirror editor with common text/markup/code highlighting
- VS Code–style preview tabs, drag-and-drop tab reordering, and cross-group tab moves
- Split editor groups with per-group tab strips and resizable widths
- Resizable Markdown preview and merge review panes
- Read-only PDF preview inside the editor pane (browser + Electron)
- Markdown preview
- Desktop-only workspace search via main-process on-demand scanning
- Light, dark, and system theme modes
- Metadata-first workspace loading with lazy document buffers and dirty-buffer persistence
- Lazy-loaded editor, language, and Markdown chunks for a smaller initial bundle
- User-chosen external workspace bundles with `vstext.json` plus draft blobs in `vstext/drafts`
- Remote-session prompt, compare flow, and inline remote draft review/resolution

## Run

```bash
corepack enable
pnpm install
pnpm dev
```

Desktop shell:

```bash
pnpm dev:desktop
```

Production build:

```bash
pnpm build
```

Windows portable `.exe`:

```bash
pnpm dist:win
```

The packaged desktop build is written to `release/` as a Windows portable executable.

Tests:

```bash
pnpm test
```

## Current Scope

- Fully working: local folder workspaces in browser and Electron, lazy workspace loading, session manifest save/restore, responsive editor shell, theme system, Markdown preview, PDF preview, inline remote draft review, and desktop search.
- Scaffolded only: direct OAuth/API integrations for OneDrive, Google Drive, and Dropbox. The UI exposes provider readiness and capability states, but the provider-specific auth/root discovery/file API flows still need to be implemented.

## Workspace Session Files

The app writes these files inside a user-chosen workspace bundle folder:

- `vstext.json`
- `vstext/drafts/*.draft.json`

`Open Folder…` does not create those files inside the work folder. If the workspace bundle itself is synchronized by OneDrive, Google Drive for desktop, or Dropbox, those files can move between machines and trigger the resume/compare flow when another machine updates the session.
