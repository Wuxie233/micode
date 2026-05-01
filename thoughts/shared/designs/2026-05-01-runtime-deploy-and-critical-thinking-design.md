---
date: 2026-05-01
topic: "Runtime Deploy Helper and Critical Thinking Policy"
status: validated
---

## Problem Statement

Runtime-sensitive micode plugin changes do not take effect just because the development repository was changed, committed, or merged. OpenCode loads the live plugin from `/root/.micode`, and it loads the built bundle, so the development copy must be synced and rebuilt before the user restarts OpenCode.

We also need global agent policy to better distinguish user needs from user-proposed implementation ideas. The need is authoritative, but the implementation idea should be evaluated and improved when there is a safer or more robust path.

## Constraints

- Never restart OpenCode automatically without explicit approval in the current conversation.
- For runtime-sensitive plugin changes, do all safe preparation first: sync code into `/root/.micode`, run `bun run build`, verify output, then stop for user restart.
- Preserve runtime-local state during sync: `node_modules`, `thoughts` runtime state, lifecycle records, worktrees, caches, and local configuration.
- Do not overwrite secrets or OpenCode global configuration as part of project sync.
- Keep the workflow reusable so future agents can invoke one helper instead of re-deriving copy/build details.
- Global `AGENTS.md` is outside the repo and must be reported separately from repo lifecycle commits.

## Approach

The chosen approach is a small deployment helper plus policy updates.

**Deployment helper:** add a repo-owned script that safely syncs `/root/CODE/micode` into `/root/.micode`, rebuilds the live plugin, verifies the built bundle, and explicitly refuses to restart OpenCode.

**Policy update:** update global agent instructions so agents treat the user's core requirement as fixed, but evaluate the user's proposed solution critically and propose better implementations when appropriate.

**Project memory:** persist the runtime-sensitive workflow as durable memory so future agents remember the expectation even before reading docs.

I considered relying only on documentation, but rejected that because this workflow is operational and easy to forget. I also considered auto-restarting OpenCode after build, but rejected it because restarting interrupts the active session and must remain user-approved.

## Architecture

The helper is an operational boundary between development and live runtime.

**Development checkout:** `/root/CODE/micode` remains the source of project work and lifecycle commits.

**Live checkout:** `/root/.micode` remains the plugin path loaded by OpenCode.

**Build artifact:** `/root/.micode/dist/index.js` is the artifact OpenCode will load after restart.

The helper performs preflight checks, selective sync, dependency verification, build, and post-build validation. It stops with a clear message: restart is still pending and must be approved by the user.

## Components

**Sync/build helper:** one command future agents can run after runtime-sensitive micode changes.

- Verifies source and runtime paths exist.
- Checks for unsafe dirty states before syncing.
- Uses selective sync that excludes runtime-local state.
- Runs dependency install only when needed.
- Rebuilds the runtime plugin and verifies `dist/index.js`.
- Produces a concise handoff summary for the user.

**Documentation update:** project docs explain the expected three-step operational rule.

- Sync code.
- Build in `/root/.micode`.
- Stop and ask the user to restart OpenCode.

**Global agent policy update:** global `AGENTS.md` gains a need-first critical thinking rule.

- User need is the source of truth.
- User-proposed solution is a candidate implementation, not automatically the best implementation.
- Agents should point out risks, propose a better path when available, and still stay aligned with the user's actual goal.
- If the user explicitly insists on their approach after the trade-off is explained, follow it unless it is unsafe or impossible.

## Data Flow

For future runtime-sensitive work:

1. Agent completes implementation, tests, and commit/merge flow in the development checkout.
2. Agent detects that the live plugin needs the change.
3. Agent runs the sync/build helper.
4. Helper syncs tracked project code into `/root/.micode` while preserving runtime state.
5. Helper runs build in `/root/.micode` and verifies the output bundle.
6. Agent reports that the plugin is ready and stops before restart.
7. User restarts OpenCode manually or explicitly approves an agent-managed restart.

For future solution design:

1. User states a need and may propose an implementation.
2. Agent identifies the core need as authoritative.
3. Agent evaluates the proposed implementation against safety, maintainability, fit, and simplicity.
4. Agent either accepts it, improves it, or explains a better alternative.
5. Agent proceeds without drifting away from the user's actual goal.

## Error Handling

**Dirty development checkout:** helper stops before sync and tells the agent what must be resolved.

**Dirty runtime checkout:** helper stops to avoid overwriting live local changes.

**Missing runtime path:** helper stops and reports that `/root/.micode` is not available.

**Dependency install failure:** helper stops before build and reports that runtime is not ready for restart.

**Build failure:** helper stops and leaves the previous runtime state visible, with clear failure status.

**Verification failure:** helper treats missing or empty `dist/index.js` as a failed deployment preparation.

**Restart temptation:** helper never restarts OpenCode. The final state is always “built, waiting for user restart” or “not ready, see failure.”

## Testing Strategy

Tests should cover the helper as an operational script, not just happy-path copying.

**Preflight tests:** missing source, missing runtime, dirty source, dirty runtime, and clean path.

**Sync tests:** runtime-local state is preserved, stale project files are removed, and excluded directories are untouched.

**Build tests:** successful build verifies bundle existence, build failure returns non-zero, and dependency failure does not claim readiness.

**Policy tests:** documentation and global instruction updates are reviewed for the need-first critical thinking behavior and the no-auto-restart constraint.

## Open Questions

- Whether the helper should support a dry-run mode by default. The recommended default is to provide both dry-run and apply modes, with future agents using apply after normal preflight.
- Whether global `AGENTS.md` should be backed up before edit. The recommended path is to make a timestamped backup because it lives outside the repo.
- Whether the helper should send a QQ notification after build-ready. The recommended behavior is yes when the completion notification system is available, but not as a hard dependency.
