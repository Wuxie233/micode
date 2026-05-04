---
date: 2026-05-03
topic: "Commander Quick-Op Routing and Model Strategy"
status: validated
---

## Problem Statement

micode now has a clear split between diagnostic investigation and delivery execution, but simple operational work can still be routed into the heavy GPT-5.5 executor path. This makes low-risk work slower and can invite over-analysis or unnecessary workflow expansion.

The goal is to keep executor strong for real delivery while making commander the fast, narrow lane for scoped quick operations.

## Constraints

- Do not add a `runner`, `operator`, or light executor agent.
- Do not weaken `executor` or `implementer-*` models.
- Do not make commander a second executor.
- Do not route by brittle keyword trigger lists.
- Preserve existing boundaries for `codebase-locator`, `codebase-analyzer`, `investigator`, `executor`, `implementer-*`, and `reviewer`.
- Do not restart OpenCode as part of this change.

## Approach

Strengthen commander’s quick-op lane and configure commander to use Claude Sonnet 4.6. Commander remains the entry point and handles simple low-risk work directly. It escalates to `investigator` when the user needs root-cause evidence, and to `executor` when the requested outcome requires mutation delivery, lifecycle, commits, deployments, restarts, or cross-agent orchestration.

This avoids adding an overlapping `runner` agent. The distinction is not based on command words. It is based on requested output, risk, and side-effect boundary.

## Architecture

The routing architecture remains compact:

- **Commander:** Fast entry, routing, and narrow quick-op execution.
- **Investigator:** Diagnostic read-only investigation with facts, evidence, likely cause, uncertainty, and escalation advice.
- **Executor:** Heavy delivery orchestration, plan execution, implementer/reviewer loops, and lifecycle actions.

Commander quick-op covers scoped work that is clear enough to complete without planner/executor. It must stop and escalate when the work becomes diagnostic, multi-step delivery, or high-risk.

## Components

**Commander quick-op lane:** A prompt section that defines low-risk scoped work, anti-expansion rules, and hard escalation triggers.

**Routing guidance:** Existing routing by requested output is extended to make quick-op separate from diagnosis and mutation delivery.

**Active model config:** `commander` is set to Claude Sonnet 4.6. `executor` and `implementer-*` stay on GPT-5.5.

**Regression tests:** Tests assert that commander documents quick-op routing, preserves investigator/executor boundaries, and avoids a `runner` style path.

## Data Flow

1. User request enters commander.
2. Commander first states the expected effect before substantive work.
3. If the requested output is a simple scoped action result, commander handles it directly.
4. If the requested output is root-cause evidence, commander delegates to `investigator`.
5. If the requested output is a delivered change, commit, deployment, restart, or lifecycle result, commander uses the existing delivery path.
6. If quick-op reveals unknown cause or broader risk, commander stops quick-op and escalates.

## Error Handling

Commander must stop quick-op and escalate when any of these apply:

- Unknown root cause or evidence chain is required.
- The first quick attempt fails in a way that needs diagnosis.
- The task expands beyond a local, low-risk operation.
- The work needs lifecycle, planner, executor, implementer, reviewer, commit, push, deploy, restart, or remote write.
- The task touches secrets, permissions, production data, destructive filesystem commands, or irreversible git operations.

The escalation path is explicit: diagnosis goes to `investigator`; delivery goes to `executor`; high-risk destructive actions require user confirmation before proceeding.

## Testing Strategy

Tests should verify:

- Commander prompt contains a quick-op lane with scope and anti-expansion rules.
- Commander routing keeps diagnosis mapped to `investigator` and mutation/delivery mapped to `executor`.
- Commander guidance does not introduce `runner` or `operator` as a new execution lane.
- Active config maps `commander` to Claude Sonnet 4.6.
- Active config leaves `executor` and `implementer-*` on GPT-5.5.

Manual smoke validation should use three requests:

- “Run/check this small status and report result” should stay in commander quick-op.
- “Why did this fail?” should route to investigator.
- “Fix this and commit it” should route to executor.

## Open Questions

- Whether commander should remain Sonnet 4.6 permanently after enough dogfooding, or whether some repositories should keep commander on GPT-5.5 for safer routing.
- Whether future OpenCode support for per-call Task model overrides will allow finer quick-op routing without relying on commander model choice.
