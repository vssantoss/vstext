# AI Plans

This folder stores dated AI-assisted planning documents for larger product, architecture, and workflow changes in vsText.

These files are useful as design history and implementation rationale, but they should not be treated as the live source of truth for current project status. For the current project snapshot, use [`PLAN.md`](../../PLAN.md).

## Naming Convention

Plan files in this folder use:

`YYYY-MM-DD - Topic Plan.md`

That keeps proposals easy to sort chronologically and makes it clear when a plan was written.

## How To Use This Folder

- Read these documents for background, tradeoffs, and implementation scope.
- Prefer adding a new dated plan when direction changes materially instead of rewriting older plans in place.
- Update [`PLAN.md`](../../PLAN.md) and product documentation when a plan becomes implemented reality.

## Current Documents

- [`2026-04-16 - Initial Plan.md`](./2026-04-16%20-%20Initial%20Plan.md): original greenfield plan for the shared PWA + Electron text editor.
- [`2026-04-18 - Conflict-Safe Multi-Desktop Plan.md`](./2026-04-18%20-%20Conflict-Safe%20Multi-Desktop%20Plan.md): conflict-safe workspace and file sync behavior across desktops.
- [`2026-04-19 - Multi-Device Draft Merge Workflow Plan.md`](./2026-04-19%20-%20Multi-Device%20Draft%20Merge%20Workflow%20Plan.md): merge-based review flow for drafts coming from multiple devices.
- [`2026-04-20 - Lazy Workspace Runtime Plan.md`](./2026-04-20%20-%20Lazy%20Workspace%20Runtime%20Plan.md): metadata-first workspace loading and lazy document buffer residency.
- [`2026-04-20 - Cloud-Ready Simplification and Optimization Pass.md`](./2026-04-20%20-%20Cloud-Ready%20Simplification%20and%20Optimization%20Pass.md): provider-preserving cleanup plan for shared core extraction, runtime simplification, dead-code removal, and bundle-size reduction.
