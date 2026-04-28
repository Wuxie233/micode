---
date: 2026-04-28
topic: "v9 lifecycle integration fix"
status: validated
---

## Problem Statement

The v9 issue-driven delivery lifecycle (commits `0f85883`, `53f714f`, `00e4c33`)
shipped working `lifecycle_*` tools, but on the very first non-trivial run
(Issue #1 itself) the tools were never invoked end-to-end. The user manually
ran `gh issue create`, `git worktree add`, `git push`, `git merge`, and
`gh issue close`. The expected flow ("AI starts request, lifecycle creates
issue+worktree, executor commits/pushes per checkpoint, finish merges and
closes") did not happen because the tools are present but **nothing in the
agent prompts tells any agent when to call them, and the worktree path is
wrong**.

This means restarting OpenCode does **not** make the workflow self-driving.
Restart only loads code; it does not teach the LLM new behaviour.

## Constraints

- Repo is `Wuxie233/micode`, FORK of `vtemian/micode`. All git writes go to
  `origin` only. Pre-flight ownership check stays mandatory.
- `thoughts/` is project-gitignored. Design and plan files live in worktree
  but are **not** committed. The GitHub Issue body is the durable cross-
  conversation index.
- v9 protocol in `~/.config/opencode/memory/issue-driven-delivery.md` is the
  source of truth for the AI-self-decided flow. We are not changing the
  protocol, we are wiring agents to honour it.
- No code changes inside `lifecycle/runner.ts` (cwd already fixed by PR #2)
  or inside the existing `lifecycle/{commit,finish,record-artifact}` tools
  themselves: those work, they are just orphaned.
- `bun run check` must stay green: Biome + ESLint + tsc + bun test.
- No `class`, no `any`, ≤40 line functions, named exports, Valibot at
  boundaries, `@/` aliases, double quotes (project rules).

## Approach

We split the fix into **three orthogonal layers** so each is independently
testable:

1. **Prompt layer** — wire the three agents (`commander`, `brainstormer`,
   `executor`) to call the right `lifecycle_*` tool at the right moment.
   This is the high-leverage change; without it, no amount of code fixing
   matters because the LLM still won't invoke the tools.
2. **Code layer** — fix `worktreesRoot` to point at the parent directory of
   the repo (matches the v8 commander prompt's `git worktree add ../{name}`
   convention and keeps worktrees out of the repo working tree). Remove the
   dead `ownerLogin`/`repo` fields from `StartRequestInput` so the abort URL
   stops printing `unknown-owner/unknown-repo`.
3. **Plan layer** — planner emits an `issue: N` frontmatter line so the
   executor can pass `issue_number` to `lifecycle_commit` without guessing.

I considered a fourth alternative — making `lifecycle_commit` and
`lifecycle_finish` *implicitly* fire from a hook on `executor` completion —
and rejected it: hooks fire on every executor run including failures and
retries, which would corrupt the lifecycle state machine. Explicit tool
calls from the agent prompt are safer and visible in the conversation log.

I also considered **not** renaming `worktreesRoot` and instead nesting
worktrees inside the repo at `<repo>/.worktrees/issue-N-slug`. Rejected:
git's hard rule is that nested worktrees inside the same repo confuse
`git status` and `gitignore` resolution. The parent-dir convention is what
v8 used and what `git worktree` documentation recommends.

## Architecture

```
+------------------+    "open issue + worktree"     +------------------+
| brainstormer     | -----------------------------> | lifecycle_start_ |
| (after design    |                                 | request          |
|  agreement)      |                                 +------------------+
|                  |    "design.md created"                      |
|                  | --------------------------------+           v
|                  |                                  |   GitHub issue
|                  |                                 v          opened,
|                  |                       +-------------------+ branch +
|                  |                       | lifecycle_record_ | worktree
|                  |                       | artifact(design)  | created
|                  |                       +-------------------+
|                  |    spawn planner                          |
|                  | ----------------------------------------> |
+------------------+                                            |
                                                                v
+------------------+                                  +------------------+
| planner          |   plan written w/ issue: N      | lifecycle_record_|
| (writes plan +   | ------------------------------> | artifact(plan)   |
|  contract)       |                                  +------------------+
+------------------+                                            |
                                                                v
+------------------+   "all batches green"            +------------------+
| executor         | -------------------------------> | lifecycle_commit |
| (runs batches)   |                                  | (auto-pushes)    |
+------------------+                                  +------------------+
                                                                |
+------------------+    brainstormer reads result               v
| brainstormer     | <----------------------------------+
| (post-execution) |                                    |
|                  |   "executor success"               |
|                  | -------------------------------+   |
+------------------+                                |   |
                                                    v   v
                                          +------------------+
                                          | lifecycle_finish |
                                          | (merge + close + |
                                          |  cleanup)        |
                                          +------------------+
```

Trigger ownership is **agent-driven, not tool-driven**. Each `lifecycle_*`
call is a single line in the corresponding agent's prompt at a specific
phase boundary. The agent decides *when*; the tool handles *how*.

## Components

### Prompt-layer changes

**`src/agents/brainstormer.ts`** — replace the existing `<lifecycle>` block
(lines 118-126) with a phase-by-phase rule list:

- `<phase name="finalizing">`: after writing the design doc, call
  `lifecycle_record_artifact(issue_number, kind="design", pointer="thoughts/shared/designs/...md")`.
  Skip if no `lifecycle_start_request` was made (quick-mode).
- `<phase name="handoff">`: after planner returns, call
  `lifecycle_record_artifact(issue_number, kind="plan", pointer="thoughts/shared/plans/...md")`.
- `<phase name="execution">`: after executor returns, if outcome is "all
  batches green", call `lifecycle_finish(issue_number, merge_strategy="auto")`.
  If executor reports BLOCKED, do **not** call finish; report to user instead.

The brainstormer also stops adding the design doc to git (already in
existing prompt: "if git add fails because gitignored, skip" — keep as-is).

**`src/agents/executor.ts`** — add a new `<lifecycle>` block after
`<rules>` (line 220):

- Plan frontmatter contains `issue: N`. Read it during `parse-plan` phase.
- After every batch goes green AND there are no BLOCKED tasks remaining,
  the executor's *last action before reporting* is one
  `lifecycle_commit(issue_number, scope=<from plan>, summary=<concise>)`.
- Scope comes from a new plan frontmatter field `scope: <conventional-scope>`
  (e.g. `lifecycle`, `octto`, `mindmodel`).
- Summary is a 50-char concise version of the plan's title.
- Push is implicit (the `commit` tool auto-pushes per `config.lifecycle.autoPush`).
- If `lifecycle_commit` returns `pushed: false`, executor reports the SHA
  and the note in its final output but does **not** retry — that is the
  user's call.

**`src/agents/commander.ts`** — minor edit to existing `<lifecycle>` block
(lines 99-102) clarifying:

- For trivial / quick-mode tasks, do NOT call `lifecycle_start_request`.
- For complex tasks routed through brainstormer, the brainstormer (not
  commander) owns the lifecycle calls. Commander only ensures the user's
  request reaches brainstormer.

### Code-layer changes

**`src/index.ts:356-360`** — change one line:

```
worktreesRoot: ctx.directory,         →   worktreesRoot: dirname(ctx.directory),
```

Add `import { dirname } from "node:path"`.

**`src/lifecycle/types.ts`** — remove `ownerLogin` and `repo` from
`StartRequestInput`:

```
interface StartRequestInput {
  readonly summary: string;
  readonly goals: readonly string[];
  readonly constraints: readonly string[];
  // ownerLogin: REMOVED
  // repo: REMOVED
}
```

**`src/lifecycle/index.ts`** — update `issueUrlFor` and `abortStart`:

- `issueUrlFor` now takes `(preflight: PreFlightResult, issueNumber: number)`.
  When pre-flight succeeded enough to know `nameWithOwner`, use it.
  Otherwise return empty string.
- `abortStart` no longer references `input.ownerLogin`/`input.repo`.

**`src/tools/lifecycle/start-request.ts`** — remove the `OWNER_PLACEHOLDER`
and `REPO_PLACEHOLDER` constants and the `ownerLogin`/`repo` fields from the
`handle.start(...)` call. Tool args schema stays exactly as it is (was
already correct: `summary`, `goals`, `constraints` only).

### Plan-layer changes

**`src/agents/planner.ts`** — add a frontmatter section to the planner's
output template:

```
---
date: YYYY-MM-DD
topic: "..."
issue: N           ← NEW (omitted for plans without an active lifecycle)
scope: <scope>     ← NEW (conventional commit scope)
contract: <path|none>
---
```

Plans without an active lifecycle (quick-mode, manual planner runs) omit
the `issue` field. The executor falls back to **not** calling
`lifecycle_commit` in that case.

## Data Flow

### Happy path (complex feature)

1. User: "请帮我加 X 功能" → reaches brainstormer
2. brainstormer: gathers context (codebase-locator + analyzer + pattern-finder
   in parallel)
3. brainstormer presents design, says "I'm proceeding to create the design
   doc"
4. brainstormer **calls `lifecycle_start_request(summary, goals, constraints)`**
   → tool runs pre-flight, opens issue #N, creates branch
   `issue/N-<slug>`, creates worktree at `<parent>/issue-N-<slug>`. Returns
   `{ issueNumber: N, branch, worktree, state: "BRANCH_READY" }`
5. brainstormer writes design doc into the **worktree** at
   `<worktree>/thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`
6. brainstormer **calls `lifecycle_record_artifact(N, "design", path)`**
7. brainstormer spawns planner with worktree as cwd
8. planner reads design, writes plan with `issue: N` and `scope: ...` in
   frontmatter, returns to brainstormer
9. brainstormer **calls `lifecycle_record_artifact(N, "plan", path)`**
10. brainstormer spawns executor with plan path
11. executor parses plan frontmatter → finds `issue: N`, `scope: ...`
12. executor runs all batches via spawn_agent, all green
13. executor **calls `lifecycle_commit(N, scope, summary)`** → produces
    one commit with conventional message `<type>(<scope>): <summary> (#N)`,
    pushes to `origin/<branch>`. Returns `{ sha, pushed: true }`
14. executor reports success to brainstormer
15. brainstormer **calls `lifecycle_finish(N, merge_strategy="auto")`** →
    merges branch into main (no-ff or PR depending on `config.lifecycle.mergeStrategy`),
    pushes main, closes issue #N, removes worktree, deletes branch
16. brainstormer reports final status to user

### Failure paths

**Pre-flight UPSTREAM**: `lifecycle_start_request` returns ABORTED record
with note `pre_flight_failed: <repo>`. brainstormer reports to user, halts.
No issue created, no worktree created. (This is the safety net protecting
upstream from accidental pushes.)

**Worktree conflict**: `lifecycle_start_request` returns ABORTED record
with note `worktree_conflict: ...`. Issue *was* created (need to clean up
manually); brainstormer reports to user, halts.

**Executor BLOCKED**: executor does NOT call `lifecycle_commit`. Reports
BLOCKED tasks to brainstormer. brainstormer does NOT call `lifecycle_finish`.
User decides next step. Lifecycle state stays at `IN_PROGRESS`.

**Push failure inside `lifecycle_commit`**: tool returns
`{ sha, pushed: false, note: "push timed out, retained locally" }`.
executor surfaces this in its final report. User can decide whether to
retry push manually.

**Merge conflict in `lifecycle_finish`**: tool returns
`{ merged: false, note: "merge conflict on main" }`. brainstormer reports
to user, halts. State stays at `MERGING`. User resolves manually.

## Error Handling

- All `lifecycle_*` tools already wrap errors via `extractErrorMessage` and
  return human-readable markdown sections (see `start-request.ts:formatThrown`,
  `commit.ts:formatOutcome`). Agents simply forward these to the user.
- Agents do NOT retry lifecycle calls on failure — single attempt, surface
  result, let the user decide. Retries belong inside the tool (e.g.
  `commitAndPush`'s push retry already exists per
  `config.lifecycle.pushRetryBackoffMs`).
- Pre-flight failures are **terminal for the request**, not retryable.
  Repo classification doesn't change between two seconds apart, so retrying
  is meaningless.
- Worktree conflict is also terminal: it means a previous lifecycle didn't
  clean up. User must `git worktree remove` manually.

## Testing Strategy

### Unit tests (additions)

- `tests/lifecycle/index.test.ts`:
  - Assert `worktreesRoot` parameter is honoured: passing `/tmp/parent` and
    cwd `/tmp/parent/repo` produces worktree at `/tmp/parent/issue-N-slug`.
  - Assert abort URL no longer contains `unknown-owner/unknown-repo`. Use
    pre-flight stub returning `{ kind: UNKNOWN, origin: "" }` and check the
    record's `issueUrl` is empty string.
  - Assert `StartRequestInput` schema rejects extra fields.

- `tests/tools/lifecycle/start-request.test.ts` (new file):
  - Tool args schema accepts `{ summary, goals, constraints }`.
  - Tool args schema rejects `{ summary, goals, constraints, ownerLogin }`.

### Integration test (extension)

- `tests/integration/lifecycle-end-to-end.test.ts`:
  - Existing test stays. Add a new case that runs the **full chain** using
    fake runners:
    1. `start_request` → record exists with `BRANCH_READY`
    2. `record_artifact("design", "...")` → record has design pointer
    3. `record_artifact("plan", "...")` → record has plan pointer
    4. `commit(N, {scope, summary})` → SHA recorded, `pushed=true`,
       state still `IN_PROGRESS` (commit doesn't transition state)
    5. `finish(N, {mergeStrategy:"auto"})` → merged, closed, cleaned, state
       progresses through `MERGING`→`CLOSED`→`CLEANED`
  - Verify the issue body rendered into `gh issue edit` calls contains the
    design + plan + commit + worktree pointers.

### Smoke test (manual, after merge)

- Restart OpenCode (with user permission per runtime-core.md).
- Send a non-trivial request: "Add a hello-world helper to src/utils/hello.ts
  with a unit test."
- Verify in conversation log:
  - brainstormer calls `lifecycle_start_request` (look for tool invocation
    in transcript)
  - design doc and plan doc artifacts recorded
  - executor calls `lifecycle_commit`
  - brainstormer calls `lifecycle_finish`
  - issue auto-closed
  - branch deleted, worktree removed
- If any step is skipped, the prompt change failed for that agent; iterate.

### Lint / type / quality gate

- `bun run check` must pass.
- `bun run build` must produce a clean `dist/index.js`.
- New code must not introduce `any` or violate the existing project rules
  enforced by Biome / ESLint / sonarjs.

## Open Questions

None. The fix is fully defined. Three answered up front:

- **Q: Should brainstormer call `lifecycle_finish` automatically, or
  always wait for user confirmation?**
  A: Automatically. The user agreed to the workflow when they kicked off
  the request, and brainstormer's existing prompt already says
  "User approved the workflow when they started brainstorming - proceed
  without asking" (line 189). Auto-finish is consistent with that.

- **Q: What if the user wants quick-mode for what looks complex?**
  A: That's commander's call (line 91-96 of commander.ts). Commander
  decides quick-mode vs full-flow before brainstormer ever sees the
  request. Brainstormer only runs for non-trivial flows where lifecycle
  is desired.

- **Q: How do we recover when a previous run aborted mid-lifecycle?**
  A: Existing `lifecycle_set_state` and `/issue` slash command. Out of
  scope for this fix; covered by v9 protocol §5.
