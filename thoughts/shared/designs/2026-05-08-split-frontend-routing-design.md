---
date: 2026-05-08
topic: "Split Frontend Workflow Routing"
status: validated
---

## Problem Statement

The current workflow treats all frontend work as one `frontend` task class. That collapses two meaningfully different work types into the same implementer and model: page/UI/UX design work, and frontend code-logic work.

We want model routing to reflect the strengths of the available models. UI/UX-heavy frontend tasks should use Gemini 3.1 Pro for stronger visual and interaction design, while code-logic frontend tasks should use gpt-5.5 for stronger frontend engineering, bug fixing, typing, and tests.

## Constraints

- Do not keep the old `frontend` Domain as a supported planner or executor value.
- Do not change `backend` or `general` routing semantics.
- Do not change reviewer routing or reviewer model selection.
- Do not introduce a new model-resolution mechanism; rely on existing per-agent `micode.jsonc` configuration.
- Cross-domain contract generation must treat any `frontend-*` task plus a `backend` task as a frontend/backend contract trigger.
- Unknown domains keep the existing safe fallback behavior, but the literal stale `frontend` value must produce a clear stale-plan error.
- The change must stay consistent across planner prompt, executor prompt, agent registration, role labels, examples, docs, and tests.

## Approach

Replace the single frontend task class with two explicit frontend domains:

- `frontend-ui` for page, layout, styling, visual hierarchy, accessibility polish, animation, interaction design, and design-system use.
- `frontend-code` for frontend logic, bug fixes, state/data flow, forms, event behavior, type fixes, tests, and small engineering changes.

The executor routes each domain to a dedicated implementer agent:

- `frontend-ui` -> `implementer-frontend-ui`, configured by the user to Gemini 3.1 Pro.
- `frontend-code` -> `implementer-frontend-code`, configured by the user to gpt-5.5.

This keeps classification in the planner, dispatch in the executor, and model choice in existing per-agent config. It avoids hidden runtime guessing and makes plans auditable.

## Architecture

The workflow remains a planner-driven dispatch pipeline:

1. Planner classifies each micro-task with a `Domain` value.
2. Executor reads the `Domain` line and dispatches to the matching implementer agent.
3. Implementer agents share the existing base implementation behavior, with frontend-specific suffixes tuned for either UI/UX or code-logic work.
4. Reviewer continues to review completed task output independently of which frontend implementer produced it.

The old `frontend` value is intentionally not accepted as a compatibility alias. If it appears, the executor should treat the plan as stale and stop with a clear instruction to regenerate the plan.

## Components

**Planner domain classification:** Updates the valid domain set from `frontend | backend | general` to `frontend-ui | frontend-code | backend | general`. It owns the distinction between design-facing frontend work and engineering-facing frontend work.

**Executor dispatch table:** Maps `frontend-ui` and `frontend-code` to separate implementer agents. It preserves `backend` and `general` behavior, and adds a special stale-plan guard for the literal `frontend` value.

**Frontend UI implementer:** A new implementer variant focused on user-visible design quality: design-system tokens, semantic structure, visual hierarchy, responsive behavior, accessibility, interaction detail, and motion quality.

**Frontend code implementer:** A new implementer variant focused on correctness and maintainability: minimal scoped changes, state/data flow, event logic, type safety, tests, and preserving existing UI unless the task explicitly asks for visual change.

**Agent registry and role labels:** Registers both new implementers and gives each a distinct human-readable role label so session tracking and spawn logs are clear.

**Configuration examples and docs:** Shows model assignment examples for the two frontend agents without changing config schema or model resolution.

## Data Flow

For a UI/UX-heavy task, the planner emits `Domain: frontend-ui`. The executor dispatches that task to `implementer-frontend-ui`, and the configured model for that agent handles the implementation.

For a frontend code-logic task, the planner emits `Domain: frontend-code`. The executor dispatches that task to `implementer-frontend-code`, and the configured model for that agent handles the implementation.

For mixed frontend/backend plans, the planner's contract trigger treats both frontend domains as frontend participation. Any plan containing at least one `frontend-ui` or `frontend-code` task and at least one `backend` task must produce the same frozen API contract behavior used today.

For stale plans containing `Domain: frontend`, the executor stops instead of silently routing. The recovery path is to regenerate the plan so tasks receive the new explicit domain values.

## Error Handling

Unknown domain values continue to use the existing fail-safe fallback to `implementer-general`, preserving behavior for malformed or future domain values.

The old `frontend` value is handled differently because it is a known stale value. It should produce a clear blocked/stale-plan message that tells the user to rerun planner, preventing accidental execution under the wrong model.

If planner cannot confidently classify a frontend task, it should prefer `frontend-code` when correctness is the main risk and `frontend-ui` when user-visible design quality is the main goal. Ambiguous large tasks should be split into separate UI and code tasks rather than assigned to one domain.

## Testing Strategy

- Update executor dispatch tests to verify `frontend-ui` routes to `implementer-frontend-ui` and `frontend-code` routes to `implementer-frontend-code`.
- Add stale-plan coverage proving `Domain: frontend` does not silently fallback.
- Update planner prompt tests or snapshot-style assertions that validate the allowed domain set and contract trigger language.
- Update agent registration tests to ensure both new implementers are registered and available to executor prompts.
- Verify config examples accept per-agent model overrides for both frontend implementers without schema changes.

## Open Questions

None. The user explicitly chose not to retain old `frontend` compatibility and accepted the default contract/fallback/prompt-suffix behavior.
