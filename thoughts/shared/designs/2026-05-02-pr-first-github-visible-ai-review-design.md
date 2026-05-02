---
date: 2026-05-02
topic: "PR-first lifecycle with GitHub-visible AI review summary"
status: validated
---

## Problem Statement

micode already performs internal AI review through the executor's implementer to reviewer loop, but that review is mostly invisible outside the OpenCode session and lifecycle artifacts.

The goal is to make reviewed work visibly traceable on GitHub without creating misleading automated human reviews or slowing the existing executor loop.

## Constraints

- Preserve the existing executor internal reviewer loop as the quality gate.
- Do not publish empty LGTM-style reviews or anything that looks like contribution farming.
- Do not use a personal GitHub token to automatically impersonate a human reviewer.
- Avoid duplicating review work: GitHub should receive a final review summary, not every internal micro-task review.
- Keep PR creation and merge behavior inside the lifecycle flow, with fork ownership safety unchanged.
- Avoid adding a blocking external review side effect to the executor's hot path.

## Approach

Use a PR-first lifecycle with a GitHub-visible AI review summary.

The internal reviewer remains the real automated quality gate. After executor success and lifecycle commit, the lifecycle opens or reuses a PR and injects a structured AI review summary into the PR body. Optionally, micode can add one non-state-changing PR comment with the same summary.

This proves the work passed review and improves traceability, while avoiding formal GitHub Review API approval semantics in the first version.

## Architecture

The design separates two review layers.

- Internal review: executor-owned, micro-task level, drives fix cycles.
- GitHub-visible review summary: lifecycle-owned, PR level, records the final reviewed state.
- Merge gate: lifecycle-owned, driven by required checks and existing PR merge strategy.

This keeps review decisions close to the system that can act on them, and keeps GitHub output focused on final evidence rather than process logs.

## Components

### Executor Internal Review

The executor continues to spawn implementers and reviewers per task and per batch. Reviewer verdicts remain internal signals: approved tasks continue, changes-requested tasks get a new fix pass, and blocked tasks stop the lifecycle before commit.

### Review Summary Collector

The lifecycle needs a compact summary of the executor's final state: reviewed scope, reviewer verdict, checks performed, tests run, contract or mindmodel checks, known risks, and final readiness.

The summary should be generated once from the final executor report, not from every intermediate reviewer attempt.

### PR Upsert Step

After lifecycle commit pushes the branch, lifecycle creates or reuses the PR for the branch. Reuse is required to avoid duplicate PRs when a blocked PR is later fixed.

### PR Body Injection

The lifecycle writes a stable AI review summary section into the PR body. Re-running the lifecycle updates that section instead of appending duplicates.

### Optional PR Comment

An opt-in setting may post one ordinary PR comment that says an AI-assisted internal review completed. This comment must not set formal PR review state and must not claim human approval.

## Data Flow

1. User starts a non-trivial task.
2. Lifecycle creates issue, branch, and worktree.
3. Brainstormer creates design, planner creates implementation plan.
4. Executor runs implementer and reviewer cycles.
5. If any task is blocked, lifecycle does not commit or open a PR.
6. If all tasks are approved, lifecycle commits and pushes the branch.
7. Lifecycle creates or reuses a PR for the branch.
8. Lifecycle injects or updates the AI review summary section in the PR body.
9. Optional PR comment is posted once or updated according to configuration.
10. Lifecycle waits for required checks when configured.
11. Lifecycle merges the PR, closes the issue, and cleans the worktree.

## Error Handling

Internal reviewer failure remains handled by the existing executor retry loop. Repeated changes-requested verdicts become blocked tasks, and blocked tasks prevent commit and PR creation.

PR creation should be idempotent: if a PR already exists for the branch, lifecycle reuses it.

PR body injection should update a stable marked section. If updating the summary fails, lifecycle should report a blocker rather than silently claiming review visibility.

Optional PR comment failure should not block merge unless the user explicitly configures it as required.

Required check failure blocks merge and leaves the lifecycle in progress with a blocker progress entry.

## Testing Strategy

Test the workflow as lifecycle behavior, not as isolated string formatting only.

- Verify PR-first flow creates or reuses exactly one PR per lifecycle branch.
- Verify review summary section is inserted once and updated idempotently.
- Verify blocked executor output prevents commit and PR creation.
- Verify optional comment does not affect merge state when disabled or when comment posting fails.
- Verify required check failure blocks merge and records a blocker.
- Verify ownership preflight still prevents accidental upstream mutation.

## Open Questions

- Whether PR-first should become the default for all lifecycle work or only non-trivial lifecycle work.
- Whether optional PR comment should default off or on for personal repositories.
- Whether review summary should be sourced from executor final report only, or also include lifecycle check results after PR checks complete.
