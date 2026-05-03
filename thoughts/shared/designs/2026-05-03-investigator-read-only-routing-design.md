---
date: 2026-05-03
topic: "Investigator Agent for Read-Only Diagnostic Routing"
status: validated
---

## Problem Statement

micode already has a reasonable model routing strategy: strong models handle delivery and implementation, while lighter models handle review and analysis. The failure mode is task classification: diagnostic information-gathering work can be routed to `executor`, causing GPT-5.5 to spend time on low-mutation, evidence-gathering work.

The goal is to add a clear role for diagnostic read-only investigation without weakening `executor` or changing the core implementation workflow.

## Constraints

- Keep `executor` and `implementer-*` on strong delivery models.
- Do not make primary agents generally use `spawn_agent` as the routing fix.
- Do not rely on brittle keyword trigger lists.
- Do not scope the new role only to ops, logs, runbooks, or Minecraft server diagnostics.
- Do not let the new role become a lightweight executor, planner, or generic read-only fallback.
- Preserve existing responsibilities for `codebase-locator`, `codebase-analyzer`, `pattern-finder`, `executor`, and `reviewer`.
- No service restart is part of this change.

## Approach

Add a new `investigator` agent and route only diagnostic read-only investigation tasks to it. The routing decision is based on the requested output and side-effect boundary, not on trigger words.

`investigator` exists for cases where the user presents an observed failure, inconsistent behavior, unknown cause, runtime symptom, or evidence fragment, and the requested output is a fact-backed diagnosis rather than a code change.

The chosen model is Claude Sonnet 4.6. It is fast enough for evidence gathering and strong enough to correlate files, configs, logs, command output, and prior facts into a useful diagnosis package.

## Architecture

The workflow gains one new diagnostic lane:

- Location questions continue to use `codebase-locator`.
- Code and architecture explanation continue to use `codebase-analyzer`.
- Diagnostic read-only investigations use `investigator`.
- Delivery, mutation, commits, deployments, and lifecycle execution continue to use `executor`.

This keeps executor as the delivery orchestrator while preventing it from becoming the default tool for all “go find out what happened” tasks.

## Components

**`investigator` agent:** Performs read-only diagnostic investigation. It gathers facts, builds evidence chains, proposes root-cause hypotheses, marks uncertainty, and recommends whether to escalate.

**Routing guidance:** Coordinator prompts describe routing by target output and side effects. The key distinction is whether the user wants a diagnosis package or a changed system.

**Model config:** `micode.jsonc` maps `investigator` to Claude Sonnet 4.6. Existing model assignments remain unchanged.

**Escalation protocol:** `investigator` never performs the fix. It recommends one of: no escalation needed, executor should fix a scoped issue, or user confirmation is needed before a side-effecting action.

## Data Flow

For a diagnostic read-only task:

1. The coordinator classifies the request by requested output and side-effect requirements.
2. If the output is a diagnosis package and no mutation is requested, the coordinator delegates to `investigator`.
3. `investigator` reads relevant evidence and may run safe read-only diagnostics.
4. `investigator` returns confirmed facts, evidence, likely cause, uncertainty, and escalation advice.
5. If a fix is requested or clearly required, the coordinator routes the evidence package to `executor` for delivery.

For a direct implementation task:

1. The coordinator routes to the existing lifecycle, planner, and executor path.
2. `executor` continues to dispatch implementers and reviewers according to the current workflow.

## Error Handling

`investigator` stops rather than improvises when investigation requires side effects, missing credentials, destructive commands, service restarts, deployments, or changes to files.

If evidence is insufficient, it reports uncertainty and the minimum next action needed. If the issue requires code or config changes, it recommends escalation to `executor` with the narrowest confirmed scope.

If a task is only a code-location or architecture-explanation request, the coordinator should avoid `investigator` and use the existing specialist agents instead.

## Testing Strategy

Verify the routing and model behavior through focused tests:

- Agent registry includes `investigator`.
- Config merge supports an `investigator` model override.
- Active config maps `investigator` to Claude Sonnet 4.6.
- Coordinator prompt guidance differentiates locator, analyzer, investigator, and executor by requested output.
- `investigator` prompt forbids mutation, commits, deploys, restarts, and implementation work.
- `investigator` output contract requires facts, evidence, likely cause, uncertainty, and escalation advice.

Manual smoke validation should use a request like “this behavior failed, first investigate why without changing anything” and confirm it routes to `investigator`, not `executor`.

## Open Questions

- Whether `investigator` should have hard tool restrictions for write/edit/task, matching reviewer’s read-only posture.
- Whether safe read-only shell commands need an allowlist or prompt-level constraint is sufficient for the first version.
- Whether future OpenCode Task model routing changes will require simplifying this design.
