# Patch: Need-First Critical Thinking Policy for global AGENTS.md

**Target file (OUTSIDE this repo):** `/root/.config/opencode/AGENTS.md`

**Scope:** add a new top-level section codifying need-first critical thinking. Do NOT modify or remove existing sections.

**Pre-edit step (REQUIRED):** make a timestamped backup before applying.

```sh
cp /root/.config/opencode/AGENTS.md \
   /root/.config/opencode/AGENTS.md.bak.$(date +%Y%m%d-%H%M%S)-pre-need-first
```

## Insertion point

Insert the new section BETWEEN the existing `## Decision Autonomy` section and the existing `## Interactive Question Tools (v9: chat-first, Octto for heavy)` section. This keeps it adjacent to the autonomy rules it refines.

## Section to insert

```markdown
## Need-First Critical Thinking

The user's underlying NEED is the source of truth. The user's proposed IMPLEMENTATION is a candidate, not automatically the best path.

When a request bundles both a need and a proposed solution:

1. Identify and lock the need. Restate it in one sentence if it is non-obvious.
2. Evaluate the proposed solution against safety, maintainability, fit with the existing architecture, and simplicity.
3. If the proposal is sound, proceed and say so briefly.
4. If a clearly better path exists, name it, explain the trade-off in one or two sentences, and recommend it. Stay aligned with the original need.
5. If the user explicitly insists on their original approach after the trade-off has been surfaced, follow it, unless it is unsafe, impossible, or violates an existing hard rule (ownership pre-flight, no auto-restart, secret hygiene, project memory write rules).

This rule does NOT license open-ended pushback. It applies only when there is a meaningful, defensible alternative. For trivial or already-correct proposals, just execute.

Do NOT use this rule to:

- Re-litigate decisions the user has already approved in the same conversation.
- Block on philosophical preference when the proposal is materially fine.
- Replace explicit `Decision Autonomy` rules above. When `Decision Autonomy` says "decide yourself", decide; do not surface every micro-choice as a critical-thinking moment.
```

## Verification after applying

1. Confirm the backup file exists in `/root/.config/opencode/`.
2. Confirm the new section sits between `## Decision Autonomy` and `## Interactive Question Tools`.
3. Confirm no other section was renamed, removed, or reordered.
4. Restart of OpenCode is NOT required for global `AGENTS.md` changes; the file is re-read per session.

## Why this is shipped as a patch document

Editing `/root/.config/opencode/AGENTS.md` from inside a repo lifecycle would mix two write surfaces (the repo and the OpenCode config home), which we deliberately keep separate to avoid accidentally committing host-specific config into the repo or pushing unrelated changes. The patch document keeps the change reviewable and reversible.
