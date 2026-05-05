---
date: 2026-05-05
topic: "Brainstormer workflow guardrails"
status: validated
---

# Brainstormer workflow guardrails

## Problem Statement

We need to stop non-trivial work from being treated as scoped direct execution. The immediate user-visible failure was a brainstormer path that tried to handle atlas command/runtime work without the normal lifecycle, plan, and executor flow.

During recovery, we also found a lifecycle safety bug: old `gh repo view` resolves a forked repository to upstream when an `upstream` remote exists. That can route lifecycle progress to the wrong GitHub repository, so workflow guardrails are not trustworthy until repo resolution is hardened.

## Constraints

- Do not implement the atlas Chinese localization task in this lifecycle.
- Preserve legitimate quick-mode behavior for typo-level and local operational work.
- Treat slash command, agent, runtime deploy, workflow, lifecycle, and cross-module feature work as non-trivial by default.
- Keep remote writes pointed at the user's fork, never upstream.
- Do not restart OpenCode without explicit user approval.

## Approach

Use a two-layer fix.

**Layer 1: lifecycle repository resolution hardening**

Lifecycle pre-flight should resolve the target repository from the `origin` remote and pass that explicit owner/repo to GitHub CLI. It must not depend on bare `gh repo view` in repositories that also define `upstream`.

**Layer 2: brainstormer direct-execution guardrails**

Brainstormer should treat direct execution as a narrow allow-list, not a broad semantic judgment. If a request touches runtime-sensitive or workflow-sensitive surfaces, the route is lifecycle plus design/plan/executor, not `executor-direct`.

## Architecture

The lifecycle pre-flight becomes the hard safety boundary for remote target selection. It classifies the repository GitHub will mutate based on `origin`, not based on GitHub CLI's implicit current-directory heuristic.

The brainstormer prompt remains the routing policy surface, but with stricter non-trivial detection language and explicit forbidden routes for `executor-direct`.

## Components

**Lifecycle pre-flight**

- Extract the GitHub slug from `origin`.
- Query that exact slug with GitHub CLI.
- Classify fork, owned repo, upstream, or unknown from the explicit query result.
- Fail closed when the origin URL cannot be parsed or the explicit query fails.

**Brainstormer prompt**

- Add a high-priority non-trivial task detector.
- Restrict workflow autonomy to post-alignment and post-lifecycle phases.
- Forbid `executor-direct` for agent, slash command, runtime, lifecycle, workflow, and deploy-sensitive tasks.

**Tests**

- Add repository-resolution tests for fork plus upstream remote.
- Add prompt contract tests for direct-execution forbidden surfaces.
- Keep existing quick-mode tests green for truly trivial tasks.

## Data Flow

Lifecycle start flows from user request to pre-flight classification to issue/worktree creation. The critical change is that pre-flight no longer lets GitHub CLI infer the target from all remotes.

Brainstormer routing flows from request classification to either design/lifecycle or `executor-direct`. The critical change is that non-trivial and sensitive surfaces are denied from direct execution before effort estimation.

## Error Handling

Lifecycle pre-flight should fail closed if it cannot prove that `origin` is the user's fork or owned repository. The failure message should identify the parsed origin and the GitHub CLI target so the user can fix remote configuration without guessing.

Brainstormer should surface non-trivial classification as a short statement, then proceed through lifecycle after user convergence. It should not silently downgrade non-trivial work into direct execution.

## Testing Strategy

- Unit-test origin slug parsing and explicit GitHub CLI argument construction.
- Regression-test fork plus upstream behavior so `origin` wins over `upstream`.
- Prompt-test brainstormer for atlas command/runtime-sensitive examples that must not match direct execution.
- Prompt-test that trivial single-file or local operational tasks can still use direct execution.

## Open Questions

None for this lifecycle. Runtime deployment may be needed after implementation if the running OpenCode plugin must pick up the workflow fix; restart still requires explicit user approval.
