---
date: 2026-05-03
topic: "Executor Direct for No-Plan Scoped Execution"
status: validated
---

## Problem Statement

The current `executor` is designed as a plan-driven dispatcher, but clear no-plan delivery tasks can still be routed to it directly. In those cases, GPT-5.5 spends time doing ad hoc exploration and implementation for work that is already scoped enough to execute directly.

We need a separate direct execution path that keeps the existing executor reliable for plan-driven delivery while giving clear no-plan implementation, build, deploy, and verify tasks a faster configurable model lane.

## Constraints

- Do not rename the existing `executor` agent.
- Do not add a generic `runner`, `operator`, or light executor lane.
- Do not let the new agent spawn subagents, create plans, or own lifecycle state.
- Do not hardcode private provider model names in repository examples.
- Active host config may pin `executor-direct` to Claude Sonnet 4.6.
- `executor-direct` can use write/edit/bash for scoped direct work, but it must not become a dispatcher.
- Do not restart OpenCode without explicit user approval.

## Approach

Add a new `executor-direct` subagent for no-plan scoped direct execution. Keep the existing `executor` as the GPT-5.5 plan-driven dispatcher and make its input contract explicit: it requires a `thoughts/shared/plans/*.md` plan path.

Routing is based on plan presence, requested output, and scope clarity:

- Plan exists or implementer/reviewer dispatch is required: `executor`.
- No plan, steps are clear, scope is bounded, and a single agent can complete implementation/build/deploy/verify: `executor-direct`.
- Cause is unknown: `investigator`.
- Scope is broad or requires design: `planner`.

## Architecture

The executor family becomes two roles:

**`executor`:** Plan-driven dispatcher. Reads planner output, batches tasks, spawns implementers and reviewers, handles review cycles, and records lifecycle commits.

**`executor-direct`:** Direct scoped executor. Performs the work itself in one subagent session. It may edit files and run commands, but it may not spawn other agents, create lifecycle artifacts, or default to commit/push behavior.

This split keeps automated flows intact because `executor-direct` is a subagent and can be spawned by primary agents. It avoids routing clear direct tasks through GPT-5.5 while preserving the full planner/executor path for complex work.

## Components

**`executor-direct` agent:** A new subagent with a prompt focused on execution envelope, scoped work, self-review, verification, deployment safety, and escalation.

**Existing `executor` prompt:** Gains a hard input guard: without an explicit plan path under `thoughts/shared/plans/`, it should stop and report that the task belongs to `executor-direct`, `planner`, or `investigator` depending on scope.

**Coordinator routing guidance:** Commander and brainstormer gain explicit rules differentiating plan-driven execution from direct scoped execution.

**Model configuration:** Repository examples expose a placeholder for direct execution model. Active host config pins `executor-direct` to Claude Sonnet 4.6. The model remains configurable, so the role can later move to GPT-5.5 or another model.

## Data Flow

For plan-driven delivery:

1. Planner writes `thoughts/shared/plans/*.md`.
2. Coordinator spawns `executor` with the plan path.
3. Executor dispatches implementers and reviewers by batch.
4. Executor records lifecycle commit/finish through the existing flow.

For direct scoped execution:

1. User or coordinator provides clear steps and a bounded scope.
2. Coordinator spawns `executor-direct` with the goal, scope, constraints, expected targets, and verification requirements.
3. `executor-direct` states the execution envelope before acting.
4. `executor-direct` performs edits/commands/deploy/verification as required.
5. `executor-direct` returns changed files, commands run, verification results, deployment/restart status, and residual risks.

If direct execution expands beyond bounds, it stops and recommends escalation instead of continuing.

## Error Handling

`executor-direct` must stop and escalate when:

- Root cause is unknown and a diagnosis is needed.
- The task requires cross-domain architecture, API contract, data model, or dependency decisions.
- The task requires subagent parallelism, reviewer cycles, lifecycle, PR, or issue management.
- Verification fails and the cause is not immediately local and obvious.
- Commit, push, or remote write is requested without explicit current-turn authorization and ownership preflight.
- Any action would restart OpenCode.
- A requested operation would expose secrets, tokens, hashes, or credentials.

Escalation targets:

- `investigator` for unknown cause.
- `planner` for broad or design-heavy work.
- `executor` for plan-backed delivery.
- User confirmation for destructive or high-risk operations.

## Testing Strategy

Verify:

- `executor-direct` is registered and exported.
- `executor-direct` disables `task` and `spawn_agent` tools.
- `executor-direct` prompt requires an execution envelope, self-review, verification report, and escalation rules.
- `executor-direct` prompt forbids lifecycle ownership, default commit/push, OpenCode restart, and secret output.
- Existing `executor` prompt requires an explicit `thoughts/shared/plans/*.md` path and refuses natural-language direct tasks.
- Commander and brainstormer routing distinguish `executor` from `executor-direct` by plan presence and scope clarity.
- Existing no-runner/operator tests continue to reject generic runner lanes without rejecting `executor-direct`.
- Active host config maps `executor-direct` to Claude Sonnet 4.6 and leaves `executor` and `implementer-*` on GPT-5.5.

Manual smoke examples:

- “Execute this existing plan at thoughts/shared/plans/x.md” routes to `executor`.
- “Implement these explicit AuthMeLite steps, build, deploy to the named servers, and verify logs” routes to `executor-direct`.
- “Why did deployment fail?” routes to `investigator`.
- “Design a new cross-server auth architecture” routes to `planner`/design flow.

## Open Questions

- Whether `executor-direct` should ever be allowed to commit locally when the user explicitly requests it, or whether all commits should stay in lifecycle/executor paths.
- Whether future model routing should give `executor-direct` per-task model overrides based on risk, or rely only on `micode.jsonc` config.
