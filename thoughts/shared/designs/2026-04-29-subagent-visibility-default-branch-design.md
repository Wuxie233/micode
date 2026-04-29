---
date: 2026-04-29
topic: "Subagent visibility and lifecycle default branch handling"
status: validated
---

## Problem Statement

Two workflow bugs are hurting day-to-day use. First, some micode-created internal or subagent sessions can appear like normal top-level conversations instead of being cleanly grouped, hidden, or deleted after success. Second, `lifecycle_finish` assumes the base branch is `main`, so repositories whose default branch is `master` or a custom name fail during checkout or merge.

We need to reduce inbox clutter from successful internal agent work and make lifecycle finish respect the repository's actual default branch.

## Constraints

**Subagent visibility constraints:**

- Preserve failed, blocked, or resumable sessions when they are needed for diagnosis or `resume_subagent`.
- Do not delete useful debugging evidence from failed executor/reviewer work.
- If OpenCode exposes parent or internal session metadata, use it at creation time.
- If OpenCode does not expose that metadata, fall back to reliable cleanup, explicit internal titles, and diagnostic logging.

**Default branch constraints:**

- Do not hardcode `main` or `master` when repository metadata can provide the default branch.
- Support `main`, `master`, and custom default branches.
- Preserve ownership preflight before remote mutation.
- Surface clear errors when the detected base branch does not exist locally or remotely.

## Approach

We will implement this as two scoped fixes under one lifecycle.

For session visibility, micode will create internal sessions with the strongest available classification. The preferred path is parent/internal metadata if the OpenCode SDK accepts it. The fallback path is explicit internal titles plus deletion retry and logging, so successful sessions do not linger silently as top-level conversations.

For lifecycle finish, micode will detect the repository default branch through git and GitHub metadata, thread that value through lifecycle context, and use it for PR and local merge paths. A user override remains possible for unusual repositories.

## Architecture

**Session creation wrapper:** Centralize micode-created session creation behind a small helper that applies title, directory, parent ownership when available, and internal metadata when available. This removes duplicated raw `session.create` calls that currently omit classification.

**Cleanup policy:** Successful ephemeral sessions are deleted with bounded retry. Failed or blocked sessions stay available when they are needed for resume or debugging. Cleanup failures are logged, not silently swallowed.

**Default branch resolver:** Add a lifecycle branch resolver that detects the base branch in this order: explicit override, remote `origin/HEAD`, GitHub `defaultBranchRef`, existing local branch fallback, and finally a clear warning before using `main` as a last resort.

**Finish integration:** `lifecycle_finish` passes the resolved base branch into merge strategy resolution, PR creation, local checkout, merge, and push. Error messages name the branch used and the detection source.

## Components

**Internal session helper:** Responsible for creating micode-owned internal sessions with stable titles and best-effort parent/internal metadata. It also centralizes deletion retry behavior.

**Spawn agent integration:** `spawn_agent` uses the helper instead of raw blank session creation. Successful sessions are cleaned reliably; blocked/task_error sessions continue to be preserved according to current resume rules.

**Constraint reviewer integration:** Constraint reviewer follows the same helper pattern so internal review sessions do not bypass cleanup conventions.

**Branch detection utility:** Resolves default branch from git and GitHub data with a deterministic precedence order.

**Lifecycle finish threading:** Types, tool input, finisher context, merge strategy, PR path, and local merge path all carry the same resolved base branch.

## Data Flow

**Session flow:**

- A micode feature needs an internal agent session.
- The helper creates the session with title, directory, parent/internal metadata when supported, and a known internal marker.
- The caller prompts the session and reads results.
- On success or hard failure, cleanup runs with retry.
- On blocked/task_error, the session is preserved only when resume semantics require it.

**Lifecycle finish flow:**

- `lifecycle_finish` starts from the active lifecycle record.
- Base branch is resolved from override or repository metadata.
- Merge strategy uses the resolved branch consistently.
- Local merge checks out the resolved branch, merges the issue branch, and pushes that branch.
- PR merge creates the PR against the resolved branch.
- Failures include the resolved branch and source so the user can recover quickly.

## Error Handling

**Session metadata unsupported:** If the SDK ignores or rejects parent/internal metadata, fall back to minimal supported `title` and directory fields. The helper should not break session creation for unsupported optional metadata.

**Deletion failure:** Retry deletion a small number of times. If it still fails, log a warning with session id, agent name, and outcome. Do not mask the primary agent result.

**Default branch unavailable:** Try all detection sources before fallback. If fallback is required, include the failure reasons in diagnostics.

**Missing base branch:** Block finish with an actionable error instead of attempting `git checkout main` blindly.

## Testing Strategy

**Session visibility tests:**

- Session creation includes title and supported classification metadata.
- Successful sessions are deleted with retry.
- Cleanup failure is logged but does not fail the primary result.
- Blocked/task_error sessions are preserved for resume.

**Default branch tests:**

- `origin/HEAD` resolving to `main` is used.
- `origin/HEAD` resolving to `master` is used.
- GitHub `defaultBranchRef` fallback is used when git metadata is missing.
- Explicit override wins over detected default.
- `lifecycle_finish` passes the resolved branch to local merge and PR merge.
- Missing branch errors identify the attempted branch.

## Open Questions

The only uncertainty is whether the installed OpenCode SDK accepts parent/internal session metadata on `session.create`. Implementation should probe this through types and safe optional fields. If unsupported, the fallback cleanup/title path is still valuable and should ship.
