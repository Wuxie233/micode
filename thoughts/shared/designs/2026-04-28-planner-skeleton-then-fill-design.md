---
date: 2026-04-28
topic: "planner skeleton-then-fill write protocol"
status: draft
---

# Planner Skeleton-Then-Fill Write Protocol

## Problem Statement

Planner agent writes the entire `thoughts/shared/plans/YYYY-MM-DD-{topic}.md` file in a single `Write` tool call. Real plans inline complete test code AND complete implementation code for every task; with the agent's stated target of 5-15 tasks per batch and 3-6 batches, plan files commonly reach 2000-5000 lines.

When the LLM streams a tool call payload that large, any one of these failures wipes the entire response:

- Provider-side stream interruption mid-content
- Network blip between OpenCode and the model gateway
- Tool-call timeout in the runtime
- Token budget exhaustion mid-stream

The result is a `Write` tool call that returns empty / errors out. All the tokens the model already produced for that file are lost: nothing landed on disk, the planner has to start over, and from the user's perspective a long, expensive turn produced zero output.

This is the dominant failure mode for non-trivial plans in the current workflow.

## Constraints

**Hard constraints (non-negotiable):**

- Plan output path stays at `thoughts/shared/plans/YYYY-MM-DD-{topic}.md` (single file, not split)
- YAML frontmatter fields and shape unchanged (`date`, `topic`, `issue?`, `scope?`, `contract`)
- Dependency Graph format unchanged (single ASCII code block listing all batches)
- Every Task node still carries: `File`, `Test`, `Depends`, `Domain`, complete test code block, complete implementation code block, `Verify`, `Commit`
- Zero changes to downstream consumers: `executor`, `reviewer`, `implementer-frontend/backend/general`, `lifecycle_*` tools, `artifact_search` indexing
- Cross-domain contract file path unchanged: `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md`

**Soft constraints:**

- Change is prompt-only inside `src/agents/planner.ts`. No new files, no logic changes, no new tools.
- Pass `bun run check` (Biome + ESLint + tsc + bun test).

## Approach

**Skeleton-then-fill protocol.** The planner produces the same final document via two phases:

**Phase 1: Skeleton write (one small `Write` call).** Writes a structurally complete but content-light file:

- Full YAML frontmatter
- Goal / Architecture / Design link / Contract link header
- Complete `## Dependency Graph` code block (all batches enumerated)
- For each batch, the `## Batch N: ...` heading, one-line description, the parallelism note, and a single line of task titles as a TOC, followed by a fenced placeholder marker.

**Phase 2: Per-batch fill (one `Edit` call per batch).** Each `Edit` replaces a unique placeholder marker (`<!-- BATCH-N-TASKS -->`) with the full Task content for that batch. Markers are guaranteed unique by construction (numbered), so `oldString` matching is never ambiguous.

**Why this approach:**

- Per-call payload drops from "entire 3000-line plan" to "one batch's tasks", typically 300-1000 lines. Stream-interruption probability scales with payload size, so this is roughly an order-of-magnitude reduction.
- If a mid-stream failure hits Edit number K, batches 1..K-1 are already on disk. Re-running planner reads the existing file, identifies remaining `<!-- BATCH-* -->` markers, and resumes; nothing is wasted.
- File path, frontmatter, Task field shape are all preserved, so executor/reviewer/lifecycle see a byte-equivalent final artifact compared to today.
- No tool-layer changes. The fix lives entirely in prompt text. Reversible by reverting the prompt diff.

**Approaches considered and rejected:**

- *Split into per-batch files.* Rejected: changes the artifact contract, forces executor/lifecycle/search updates, breaks existing search indexes.
- *Auto-chunk inside the Write tool.* Rejected: the Write tool can't know semantic batch boundaries, and silently chunking violates prompt-as-contract; also Edit anchors are model-controlled, not tool-controlled.

## Architecture

The change is purely additive to the planner's system prompt. The runtime, tools, and other agents are untouched.

```
planner agent (prompt change)
  │
  ├── Phase 1: Write(plan.md, skeleton)         <- small payload, low fail risk
  │
  ├── Phase 2.1: Edit(plan.md, BATCH-1 marker → batch 1 tasks)
  ├── Phase 2.2: Edit(plan.md, BATCH-2 marker → batch 2 tasks)
  ├── Phase 2.N: Edit(plan.md, BATCH-N marker → batch N tasks)
  │
  └── (optional) contract.md via same protocol when cross-domain
```

The planner's other behaviors stay the same: research minimization, mindmodel/project-memory lookups, Domain tagging, contract generation, TDD enforcement, dependency-graph construction.

## Components

**Skeleton template (new prompt section).** Specifies the exact shape of the Phase 1 file:

- Frontmatter
- Header (Goal, Architecture, Design link, Contract link)
- Dependency Graph code block
- Per batch: heading, parallelism note, task TOC line, placeholder marker

**Placeholder marker format.** Fixed string `<!-- BATCH-N-TASKS -->` where `N` is the 1-based batch index. HTML-comment syntax keeps it invisible in any markdown renderer that ignores comments and uniquely identifies replacement targets for `Edit`.

**Fill protocol rules (new prompt section).** Hard rules the planner must follow:

- One `Edit` per batch. No splitting a batch across multiple Edits.
- `oldString` for each Edit is exactly the placeholder marker, full string match.
- `newString` contains the entire batch's task content (all Task nodes in that batch).
- Edits are sequential, batch 1 first, then batch 2, etc. (sequential, not parallel, because they all target the same file).
- Planner finishes the run only after the file contains zero `<!-- BATCH-*-TASKS -->` markers.

**Resume rule (new prompt section).** Before any write, planner checks if the target plan path already exists. If yes:

- Read the existing file
- If frontmatter / skeleton already present and some `<!-- BATCH-* -->` markers remain, only fill the remaining ones
- If frontmatter present but topic / structure mismatches the current task, treat as fresh write and overwrite the skeleton

**Oversize-task escape hatch.** If a single Task's combined test + implementation code exceeds roughly 500 lines, the planner may further split that task within its batch using a second-level placeholder (`<!-- BATCH-N-TASK-Y -->`). This is a recursion of the same protocol, not a new mechanism. Documented but expected to be rare.

**Contract file handling.** For cross-domain plans, the contract file `{topic}-contract.md` follows the same protocol: skeleton write (frontmatter + section headings + `<!-- ENDPOINTS -->`, `<!-- TYPES -->` placeholders), then one Edit per section. Contract files are typically smaller, so a single Write is also acceptable when the contract has fewer than ten endpoints AND fewer than fifteen shared types; planner picks based on its own size estimate.

## Data Flow

1. Planner reads design doc, mindmodel constraints, project memory, and any inputs it needs (unchanged from today).
2. Planner enumerates batches and tasks in memory (unchanged).
3. **NEW:** Planner emits a single `Write` call with the skeleton document. File now exists on disk with frontmatter, dep graph, all batch headings, and N placeholder markers.
4. **NEW:** For each batch i in 1..N, planner emits one `Edit` call replacing `<!-- BATCH-i-TASKS -->` with the full task content for batch i.
5. **NEW:** Planner verifies (via Read) that no placeholder markers remain. If any do, it re-Edits them.
6. (Cross-domain only) Planner emits the contract file via the same protocol.
7. Planner returns the plan path to its caller (brainstormer / commander), unchanged.

## Error Handling

**Per-call failure semantics:**

- *Skeleton Write fails.* Planner reports the failure and stops. No partial state on disk. Caller can retry the planner.
- *Batch i Edit fails.* Batches 1..i-1 are already on disk. Planner reports which batch failed and stops. On retry/resume, planner reads the file, sees `<!-- BATCH-i-TASKS -->` and onward still present, and resumes from there.
- *Edit oldString not found.* This indicates either a prior Edit corrupted the marker or the planner used the wrong index. Planner reports clearly and stops; this is a logic error, not a transient one.

**Anti-pattern guard rails (added to `<never-do>`):**

- Never re-Edit a batch that has already been filled (no marker present).
- Never combine multiple batches into one Edit.
- Never use `Write` to overwrite a partially-filled file (it would destroy already-landed batches).
- Never put placeholder markers inside Task code blocks (would create false replacement targets).

## Testing Strategy

This is a system-prompt change, so testing is mostly indirect:

- **Static checks:** `bun run check` to verify the modified TypeScript template literal still parses (escaping, backticks, no broken interpolation), Biome / ESLint pass, full test suite green.
- **Behavioral verification (manual):** After build + sync to `/root/.micode`, run a brainstorm → planner cycle on a non-trivial topic in a sandbox project. Confirm:
  1. The plan file is created with placeholder markers visible after the first Write.
  2. Each subsequent Edit removes one placeholder.
  3. Final plan content is structurally equivalent to what today's planner would produce (frontmatter, dep graph, all task fields present, contract emitted when cross-domain).
  4. Executor reads the final plan without complaint.
- **Resume test (manual):** Manually kill the planner mid-run after batch 2 Edit lands, re-run the planner with the same inputs, verify it resumes at batch 3 without re-overwriting batches 1-2.

No automated test added: this layer of micode does not have LLM-loop e2e tests, and adding one for prompt behavior is out of scope.

## Open Questions

None blocking. Implementation can proceed.

One forward-looking note: if even single-batch payloads turn out to still be too large for some plans (very rare, but possible for backend tasks with large schema migrations), the oversize-task escape hatch using `<!-- BATCH-N-TASK-Y -->` second-level markers handles it. We can promote that from "rare escape hatch" to "normal mode" later if real telemetry justifies it.
