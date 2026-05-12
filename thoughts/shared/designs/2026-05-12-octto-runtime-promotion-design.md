---
date: 2026-05-12
topic: "Octto runtime promotion after batched auto-resume"
status: validated
---

# Octto runtime promotion after batched auto-resume

## Problem Statement

The Octto batched auto-resume and model inheritance change from issue #65 is complete. The user now wants that completed work available in the runtime checkout so the next manual OpenCode restart uses the new behavior.

The important boundary is that this task promotes already-finished code; it must not restart OpenCode or mutate implementation logic.

## Constraints

- Treat runtime/deploy work as workflow-sensitive and route through lifecycle, planner, and executor.
- Do not restart OpenCode, `opencode web`, `opencode serve`, or any related service/process.
- Preserve the user's expectation that they will manually restart later.
- Prefer safe git operations only; no force push, hard reset, branch deletion, or destructive cleanup.
- If issue #65 is already merged into main, report that instead of attempting a duplicate merge.
- Runtime deploy should use the repository's existing deploy helper, not an ad hoc copy flow.

## Approach

Use the existing runtime deployment workflow as the only promotion path. The executor should first verify that main contains the issue #65 implementation, then run the documented runtime deploy command from main.

This avoids manual drift between the source checkout and `/root/.micode`. The operation ends at "runtime ready" and deliberately stops before restart.

## Architecture

The promotion path has three boundaries:

- **Source checkout:** The canonical repository state. It must contain the issue #65 implementation on main.
- **Runtime deploy helper:** The repository-owned script that syncs/builds the runtime checkout and prints the no-restart readiness message.
- **Runtime checkout:** The location loaded by OpenCode after a manual restart.

No new component is introduced. The task is operational orchestration over existing git and deploy tooling.

## Components

**Main verification:** Confirms issue #65's implementation commit or equivalent diff is reachable from main.

**Ownership pre-flight:** Confirms remote ownership before any remote mutation, following project policy.

**Runtime deploy command:** Runs the existing `deploy:runtime` flow and captures success/failure.

**Runtime verification:** Confirms the runtime checkout/build reflects the promoted source version enough for the next manual restart.

**No-restart guard:** Explicitly avoids any service restart and reports that restart remains a user action.

## Data Flow

1. Executor inspects repository state and confirms whether issue #65 is already present on main.
2. If local main is behind the safe remote target, executor performs a non-destructive update.
3. Executor runs the existing runtime deploy helper from main.
4. Deploy helper syncs/builds the runtime checkout using the repository's preserved-path and exclusion rules.
5. Executor verifies runtime readiness and reports the exact state back to the user.
6. User manually restarts OpenCode later, at which point the runtime copy loads the promoted Octto behavior.

## Error Handling

- If main does not contain the issue #65 work and cannot be safely updated, stop and report the blocker.
- If ownership classification is unsafe or ambiguous, stop before remote mutation.
- If runtime deploy preflight fails due to dirty state or missing tooling, report the blocker and do not improvise a copy.
- If deploy succeeds but verification is inconclusive, report runtime status as blocked/uncertain rather than claiming readiness.
- Never attempt to fix runtime readiness by restarting OpenCode.

## Testing Strategy

- Verify git ancestry or equivalent evidence that issue #65 is on main.
- Run the existing runtime deploy command.
- Use the deploy helper's own build/preflight result as the primary verification.
- Optionally run a targeted post-deploy check if the helper exposes version/build evidence.

## Open Questions

- None. The user explicitly wants runtime prepared for a future manual restart, not an automatic restart now.
