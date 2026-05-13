---
date: 2026-05-13
topic: "selected-claude-routing"
contract: "none"
---

# Selected Claude Runtime Routing Implementation Plan

**Goal:** Update active micode runtime routing so existing `wuxie-openai/gpt-5.3-codex-spark` routes move to `wuxie-claude/claude-haiku-4-5-20251001`, while `planner` uses `wuxie-claude/claude-opus-4-7`.

**Architecture:** This is a single-file runtime config edit scoped to `/root/.config/opencode/micode.jsonc`. The implementer must preserve JSONC structure/comments where possible, back up the active file first, validate JSONC after editing, and only inspect `opencode.json` provider definitions if validation/discovery shows the target models are not defined. No OpenCode restart is allowed.

**Design:** User-provided runtime routing requirements in chat.

**Contract:** none

---

## Dependency Graph

```text
Batch 1 (parallel): 1.1 [runtime config - no deps]
```

---

## Batch 1: Runtime Config (parallel - 1 implementer)

All tasks in this batch have NO dependencies.
Tasks: 1.1

### Task 1.1: Selected Claude runtime route update
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** none
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Implementation requirements:

1. Before changing the file, create a timestamped backup of the active file next to it using this exact suffix shape:
   - `/root/.config/opencode/micode.jsonc.<YYYYMMDD-HHMMSS>-selected-claude-routes.bak`
2. Edit only `/root/.config/opencode/micode.jsonc` unless validation/discovery shows the target provider model definitions are missing from `opencode.json`.
3. Replace every micode route currently set to `wuxie-openai/gpt-5.3-codex-spark` with `wuxie-claude/claude-haiku-4-5-20251001`.
4. Set the `planner` route/model to `wuxie-claude/claude-opus-4-7`, even if it was included in the previous replacement set.
5. Do not restart OpenCode or any OpenCode-related service/process.
6. Do not print secrets, raw provider credential values, tokens, API keys, or full provider credential blocks.
7. Validate the edited JSONC parses successfully. Use an existing project/runtime JSONC-capable parser if available; otherwise use a safe parser that supports comments/trailing commas.
8. Report the exact changed agents/routes by name, with old model and new model. Do not include raw credentials.

Suggested implementation approach:

```text
1. Read /root/.config/opencode/micode.jsonc.
2. Create the timestamped backup before overwrite.
3. Parse or structurally inspect the route/model mapping.
4. Apply the replacement rule for all entries equal to wuxie-openai/gpt-5.3-codex-spark.
5. Apply the planner override to wuxie-claude/claude-opus-4-7.
6. Write the updated JSONC while preserving comments/format as much as practical.
7. Validate JSONC.
8. If and only if target provider model definitions are missing, inspect/update the relevant provider definition file; otherwise leave all other files untouched.
9. Produce a concise report listing exact changed agents/routes and backup path.
```

**Verify:** JSONC validation succeeds for `/root/.config/opencode/micode.jsonc`; changed-agent report includes all routes changed from `wuxie-openai/gpt-5.3-codex-spark` plus the `planner` override.
**Commit:** none (runtime config outside repo; no OpenCode restart)
