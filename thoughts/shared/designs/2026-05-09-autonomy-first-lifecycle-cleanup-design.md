---
date: 2026-05-09
topic: "Autonomy-first lifecycle cleanup and search boundaries"
status: validated
---

## Problem Statement

Completed issue worktrees can remain under the shared `/root/CODE` parent after lifecycle finish. Those leftovers consume disk, pollute searches, and make users handle cleanup decisions that the system can often decide safely.

The workflow should be autonomy-first: automatically resolve safe, recoverable cleanup cases and only ask the user when continuing could lose real user work or requires external judgment.

## Constraints

- Do not force-delete dirty worktrees that may contain user work.
- Do not delete open issue worktrees or unrelated project clones automatically.
- Preserve recoverability when handling generated leftovers by backing up before removal where practical.
- Changes touch lifecycle and agent prompt surfaces, so they must be planned and executed through the normal lifecycle workflow.
- Search exclusions must not hide the active project root or active lifecycle worktree.

## Approach

Use an autonomy-first cleanup policy with explicit escalation boundaries.

Lifecycle finish should treat closed, merged, clean worktrees as automatically removable. If cleanup fails for recoverable reasons, it should retry safe cleanup steps before escalating. Dirty or ambiguous worktrees should not be silently force-removed; instead the final report must clearly explain why the system stopped and what user decision is needed.

Agent search prompts should avoid scanning sibling `issue-*` worktrees by default. Search should stay rooted in the active project/worktree and explicitly exclude `.git`, `node_modules`, and sibling lifecycle directories unless the user asks to inspect them.

## Architecture

The change has two cooperating layers:

- Lifecycle cleanup policy: classifies cleanup failures and performs safe automatic recovery before returning a terminal outcome.
- Agent search boundary policy: keeps locator/analyzer searches scoped to the active root to avoid old worktree pollution.

This avoids solving the problem only by hiding paths from search. The local filesystem is cleaned when safe, and search remains defensive even if historical leftovers exist.

## Components

- Lifecycle finish/merge cleanup: owns `git worktree remove`, safe retry, and final outcome reporting.
- Lifecycle state transition: must not label a lifecycle as fully cleaned when the worktree still exists for a non-recoverable reason.
- Agent prompts for codebase location/analysis: define default search boundaries and exclusions.
- Tests: cover successful cleanup, cleanup failure classification, and prompt guardrails around sibling worktrees.

## Data Flow

1. A lifecycle reaches finish after executor success.
2. Finish selects PR or local merge strategy and merges the branch.
3. Cleanup attempts to remove the lifecycle worktree.
4. If removal succeeds, lifecycle records a cleaned outcome.
5. If removal fails, the system classifies the reason.
6. Safe/recoverable cases are retried automatically.
7. Unsafe/ambiguous cases surface a blocked or incomplete-cleanup outcome with a precise reason.
8. Future codebase searches stay inside the active root and do not traverse sibling issue worktrees by default.

## Error Handling

Cleanup errors should be classified instead of flattened into a generic note.

- Clean closed/merged worktree removal failure: retry safe git cleanup/prune once.
- Generated leftover conflict: back up or remove only when it is clearly current-task generated material.
- Dirty worktree with possible user work: do not force-delete; report the dirty paths and stop.
- Open issue or unmerged branch: do not clean automatically.
- Unknown external project clone: never delete automatically from micode lifecycle.

The user should only see a blocking request when the system cannot safely decide.

## Testing Strategy

- Unit-test cleanup classification for clean, dirty, missing, and ambiguous worktree states.
- Integration-test lifecycle finish where cleanup succeeds and where cleanup failure remains unsafe.
- Prompt/tests ensure codebase-locator and codebase-analyzer mention active-root scoping and sibling `issue-*` exclusion.
- Regression-test that open or dirty worktrees are not force-deleted.

## Open Questions

- Whether to add a dedicated cleanup command for historical leftovers across projects is out of scope for this change.
- Whether artifact search indexing needs project-id filtering is a related but larger follow-up.
