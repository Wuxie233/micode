---
date: 2026-04-28
topic: "Lifecycle autoflow redesign: auto-commit, progress logging, shared design/plan docs"
status: validated
issue: 6
---

## Problem Statement

The v9 lifecycle workflow has three concrete usability gaps that surfaced in real usage:

1. **Manual commit/push.** Agents finish work and stop. The user has to ask "commit and push" every cycle. Issue #34 (FlyBuild) shipped via plain `git merge` + `git push` because brainstormer never went through `lifecycle_commit`.

2. **Issue body is a static skeleton.** Between `lifecycle_start_request` and `lifecycle_finish` the issue gets only artifact pointers. Decisions, blockers, discoveries, handoff intent are nowhere on GitHub. New conversations resort to "go re-derive context from chat history", which defeats the cross-conversation index.

3. **`thoughts/` is fully gitignored.** Designs and plans are local-only by policy (`.gitignore:7-8`). Cross-developer reuse, cross-machine continuation, and "look up how we solved this before" are blocked. The current rationale ("issue body is the canonical index") is undermined by gap #2.

A fourth gap surfaced while attempting to start the lifecycle for this very issue:

4. **`lifecycle_start_request` itself is broken in many environments.** `runner.gh()` does not accept `cwd`, and `pre-flight.ts` calls it without setting one. `gh repo view` falls back to "current directory" git inference and fails when the OpenCode plugin process is not rooted in the target repo. The pre-flight then returns `UNKNOWN`, the user sees `pre_flight_failed`, and the lifecycle aborts. This blocks #1 and #2 from being usable at all.

## Constraints

- **Push targets fork `origin` only.** Never `upstream`. Ownership pre-flight must keep classifying correctly.
- **Backward compatible.** Existing lifecycle records (e.g. FlyBuild #34's `1.json`) must continue to load and operate.
- **Hard-error over guessing.** Ambiguous lifecycle resolution must fail loudly, not pick a candidate.
- **v9-only.** Do not propagate any new mechanism into the v8 fallback path.
- **No issue body rewrite churn.** v1 keeps progress in comments; do not add a "Latest Progress" body section that would race with `record_artifact`'s replace-mode body rendering.
- **`thoughts/lifecycle/`, `thoughts/ledgers/`, `thoughts/brainstorms/`, `thoughts/octto/` stay gitignored.** Only design/plan docs become shareable.
- **Existing tests must keep passing.** `tests/tools/lifecycle/*` and `tests/lifecycle/*` define current contract.

## Approach

Ship in four phases gated by dependencies. Each phase is independently committable.

**Phase 0 — Unblock the foundation.** Fix `runner.gh` to accept `cwd`. Fix `pre-flight` to pass it. Switch `lifecycle_commit` staging from `git add --update` to `git add --all`. These three changes are pure bug fixes; without them the rest of the redesign produces zero observable improvement.

**Phase 1 — Make designs and plans shareable.** Partial unignore of `thoughts/shared/designs/**/*.md` and `thoughts/shared/plans/**/*.md`. Update brainstormer / planner / executor prompts so design and plan docs are committed via `lifecycle_commit` when an active lifecycle exists, plain `git` otherwise. Extend `artifact-auto-index` to recognize design files.

**Phase 2 — Resolver-first active lifecycle.** Introduce `lifecycle_current` and `lifecycle_resume`. Active lifecycle is *inferred*, not stored as a flag. Cross-machine resume reconstructs from the GitHub issue body using existing `parseIssueBody`.

**Phase 3 — Progress as first-class events.** Add `lifecycle_log_progress` (append-only issue comment with hidden kind marker) and `lifecycle_context` (returns issue body + recent progress for new-conversation onboarding). Existing lifecycle tools auto-emit progress events on success.

This sequence is forced by dependencies: Phase 0 unbreaks the lifecycle tools themselves, Phase 1 makes shared docs commit-able, Phase 2 lets agents discover the active issue automatically, Phase 3 records what happens between checkpoints.

## Architecture

```
                           GitHub issue (canonical cross-conversation index)
                                ▲                        ▲
                                │ body sync              │ comments (Phase 3)
                                │ (start/artifact/finish) │
                                │                        │
   ┌────────────────────────────┴─────────┐    ┌────────┴──────────────┐
   │ src/lifecycle (state machine + ops)  │    │ progress comment      │
   │  - index.ts (handle factory)         │    │  marker:              │
   │  - pre-flight.ts (FIXED: gh cwd)     │    │  <!-- micode:         │
   │  - commits.ts   (FIXED: add --all)   │    │     lifecycle:        │
   │  - runner.ts    (FIXED: gh cwd)      │    │     progress kind=xxx │
   │  - resolver.ts  (NEW: current/resume)│    │  -->                  │
   │  - progress.ts  (NEW: log + context) │    └───────────────────────┘
   │  - issue-body.ts (unchanged)         │
   │  - store.ts      (unchanged)         │
   └────────────────────────────────────┬─┘
                                        │
                ┌───────────────────────┴────────────────────────┐
                │ src/tools/lifecycle (tool wrappers)            │
                │  start_request / record_artifact /             │
                │  commit / finish                               │
                │  current (NEW) / resume (NEW)                  │
                │  log_progress (NEW) / context (NEW)            │
                └────────────────────────────────────────────────┘
                                        ▲
                                        │ called by
                                        │
  brainstormer / planner / executor — prompts updated to: try resolver, use lifecycle, fallback to plain git
```

## Components

### Phase 0 fixes

**`src/lifecycle/runner.ts`**

- Extend `LifecycleRunner.gh` signature to `(args, options?: { cwd?: string }) => Promise<RunResult>`, mirroring `git`.
- `runCommand` already supports cwd; just thread it through the factory.
- Default cwd for `gh`: when omitted, the runner uses Bun's default (process cwd). Existing callers that pass no cwd remain functional in environments where process cwd is the repo root.

**`src/lifecycle/pre-flight.ts`**

- `classifyRepo` already gets a `cwd` parameter. Pass it to the `gh` call: `runner.gh(GH_REPO_ARGS, { cwd })`.
- No schema changes, no new code paths. One-line fix.

**`src/lifecycle/commits.ts`**

- Replace `git add --update` (line 22 / 114, the `GIT_ADD_UPDATE_ARGS` constant) with `git add --all`.
- Rationale: `--update` only stages files already tracked. Designs/plans/new source files born inside the lifecycle worktree never get committed without explicit `git add` from the agent. `--all` respects `.gitignore` (so personal `thoughts/` subtrees are still excluded) and includes new tracked-eligible files.
- Keep the rest of `commitAndPush` (push retry once, autoPush from config) untouched.

### Phase 1 components

**`.gitignore` (plugin repo and template intent)**

The micode plugin's own `.gitignore` adopts a tiered policy:

```
# Tier 1: completely local (personal session state)
thoughts/ledgers/
thoughts/brainstorms/
thoughts/octto/
thoughts/lifecycle/

# Tier 2: shareable (cross-developer artifacts)
# (these are NOT ignored — design and plan docs ship in git)
# thoughts/shared/designs/**/*.md
# thoughts/shared/plans/**/*.md
```

The current single-line `thoughts/` rule becomes a tiered block. Existing committed history isn't affected because `thoughts/shared/` was never committed under the old rule.

For user projects, the same rule lives in their own `.gitignore`; we do not auto-write it (the plugin doesn't currently template `.gitignore` for users, and adding that is out of scope).

**Brainstormer prompt (`src/agents/brainstormer.ts`)**

Existing rule: "Commit the design document to git (if git add fails because the file is gitignored, skip the commit — NEVER force-add ignored files)".

New rule: "After writing the design doc, call `lifecycle_current` to discover the active issue. If found, use `lifecycle_commit` (auto-pushes). If no active lifecycle, use plain `git add` + `git commit`. If `git add` fails because the file is gitignored, skip silently — NEVER force-add ignored files."

**Planner prompt (`src/agents/planner.ts:170-173`)**

Existing rule: "Do NOT commit". Removed.

New rule: "After writing the plan, call `lifecycle_current`. If active lifecycle, `lifecycle_commit` it. If not, leave it for the user to commit (plans without an active lifecycle context are likely a design-only flow)."

**Executor prompt (`src/agents/executor.ts:230-245`)**

Already integrates with lifecycle. Verify Phase 0 changes don't break it. No prompt change required.

**`src/hooks/artifact-auto-index.ts`**

Add design pattern alongside the existing ledger and plan patterns:

```
designPattern: /thoughts\/shared\/designs\/.*\.md$/
```

Index designs the same way plans are indexed today.

### Phase 2 components

**`src/lifecycle/resolver.ts` (new)**

Pure function module. No state, no I/O beyond what runner provides.

```
createResolver(deps: { runner, store }) -> {
  current(): Promise<ResolverResult>
  resume(issueNumber: number): Promise<LifecycleRecord>
}
```

`ResolverResult` is a discriminated union:
- `{ kind: "resolved", record: LifecycleRecord }`
- `{ kind: "none" }` — branch isn't a lifecycle branch and store has no candidates
- `{ kind: "ambiguous", candidates: number[] }` — multiple lifecycles plausibly active; agent must disambiguate

`current()` algorithm:

1. Run `git rev-parse --abbrev-ref HEAD` to get current branch.
2. Match against `^issue/(\d+)-` regex. If match, load `store.load(N)`. Hit → resolved. Miss → fall through to step 3.
3. List `store.listOpen()` (helper added on store): records whose state is not `closed/cleaned/aborted`. If exactly one → resolved. Zero → none. More than one → ambiguous.

`resume(N)` algorithm:

1. `store.load(N)`. If hit, return immediately.
2. Read GitHub issue body via `runner.gh([issue, view, N, --json, body])`.
3. Run existing `parseIssueBody` to extract artifacts and state markers.
4. Reconstruct a minimal `LifecycleRecord` (issueNumber, branch derived from issue title, worktree derived from current cwd if matching, parsed artifacts).
5. Persist to local store so subsequent calls hit the fast path.
6. Hard error if issue body has no managed markers — that issue wasn't created by lifecycle.

**`src/tools/lifecycle/current.ts` (new)** — thin wrapper. Returns formatted markdown table.

**`src/tools/lifecycle/resume.ts` (new)** — thin wrapper. Takes `issue_number`, returns formatted summary.

**Why no state file?**

- Branch name is already structured (`issue/<N>-<slug>`) and lifecycle-managed.
- Linked git worktrees share `.git/` semantics weirdly (`.git` is a file pointer, not a dir) — any `.git/MICODE_ACTIVE_LIFECYCLE` write needs `git rev-parse --git-path` indirection, adding complexity for no benefit.
- Multiple parallel lifecycles in different worktrees Just Work because each worktree has its own current branch.
- One less thing to keep consistent.

### Phase 3 components

**`src/lifecycle/progress.ts` (new)**

```
createProgressLogger(deps: { runner, resolver }) -> {
  log(input: { issueNumber?, kind, summary, details? }): Promise<ProgressOutcome>
  context(input: { issueNumber? }): Promise<ContextSnapshot>
}
```

`kind` is `"decision" | "blocker" | "discovery" | "status" | "handoff"` as a const map.

`log()` algorithm:

1. Resolve issueNumber: explicit input, else `resolver.current()`. If `current` returns `none` or `ambiguous`, hard error with clear message.
2. Format comment body:
   ```
   <!-- micode:lifecycle:progress kind=KIND -->
   ## KIND_LABEL — SHORT_TIMESTAMP

   SUMMARY

   <details>
   DETAILS (if provided)
   </details>
   ```
3. Call `runner.gh([issue, comment, N, --body, formatted])`.
4. Return `{ commentUrl, kind }`.

**Critical**: `log()` does not require local lifecycle record. The new-conversation case is "user resumes from another machine, has GitHub issue but no local JSON". `log()` posts to GitHub regardless. (`resume()` is the path that materializes the local record.)

`context()` algorithm:

1. Resolve issueNumber.
2. `gh issue view N --json body,comments`.
3. Filter comments by hidden marker `<!-- micode:lifecycle:progress`. Take last 10.
4. Return `{ body, recentProgress: [{ kind, summary, createdAt, url }] }` formatted as markdown.

**Auto-emit from existing tools**

Each existing lifecycle handle method gets a progress emit on success:

- `start.ts`: emit `{ kind: status, summary: "Lifecycle started: branch=X, worktree=Y" }` after issue creation succeeds.
- `record-artifact.ts`: emit `{ kind: status, summary: "Recorded ARTIFACT_KIND: pointer" }`.
- `commits.ts`: emit `{ kind: status, summary: "Committed SHA, pushed=true/false" }` after commit (success or note path).
- `finish.ts`: emit `{ kind: status, summary: "Finished: merged=X, prUrl=Y" }`.

Best-effort: if the progress emit fails (network blip, gh rate limit), the lifecycle operation itself is not rolled back. Wrap in try/catch, log warning, move on.

**Agent prompt triggers** (added to brainstormer / planner / executor)

- **brainstormer**: when user picks one of multiple proposed approaches → `decision`. When session ends with handoff to planner → `handoff`.
- **planner**: when a key dependency or constraint is discovered → `discovery`. When plan is complete → `status` + `handoff` to executor.
- **executor**: when a batch completes → `status`. When a task is BLOCKED → `blocker`. When all batches done → `handoff`.
- **All agents**: structural rule: emit `handoff` before transferring control or ending session, summarizing "what's done, what's next, what to know".

**`src/tools/lifecycle/log-progress.ts` (new)** — wrapper, four args: `kind`, `summary`, `details?`, `issue_number?`.

**`src/tools/lifecycle/context.ts` (new)** — wrapper, one optional arg: `issue_number?`. Returns formatted brief.

## Data Flow

### Normal flow (after all phases land)

```
User starts work
    │
    ▼
agent calls lifecycle_start_request
    │  ├─ pre-flight (with cwd, FIXED)
    │  ├─ create GitHub issue
    │  ├─ create branch issue/N-slug
    │  ├─ create worktree
    │  ├─ save thoughts/lifecycle/N.json
    │  ├─ sync issue body
    │  └─ AUTO: lifecycle_log_progress(status, "started")
    ▼
agent writes design to thoughts/shared/designs/...md
    │
    ▼
agent calls lifecycle_current → resolves to N from current branch
    │
    ▼
agent calls lifecycle_commit
    │  ├─ git add --all (FIXED: includes new design file)
    │  ├─ git commit -m "..."
    │  ├─ git push origin issue/N-slug (autoPush from config)
    │  ├─ save updated record
    │  ├─ sync issue body (commit artifact appears)
    │  └─ AUTO: lifecycle_log_progress(status, "Committed SHA, pushed=true")
    ▼
agent calls lifecycle_log_progress(decision, "User picked approach X over Y because Z")
    │  └─ gh issue comment
    ▼
... (planner phase, executor phases, similar pattern) ...
    ▼
agent calls lifecycle_finish
    │  ├─ merge (PR or local-merge)
    │  ├─ close issue
    │  ├─ remove worktree
    │  └─ AUTO: lifecycle_log_progress(status, "Finished: merged=true")
```

### New-conversation continuation flow

```
User in a fresh conversation: "继续 #6 的 lifecycle redesign"
    │
    ▼
agent calls lifecycle_context(6)
    │  ├─ resolver.current() — sees current branch is issue/6-..., resolves
    │  ├─ gh issue view 6 --json body,comments
    │  ├─ filters last 10 progress comments
    │  └─ returns: { body, recentProgress: [...] }
    ▼
agent has full context: issue body sections + last decisions/discoveries
    │
    ▼
work continues from where last conversation left off
```

### Cross-machine continuation flow

```
Developer B clones the repo on machine B
    │
    ▼
git checkout issue/6-...
    │  (no thoughts/lifecycle/6.json locally because it's gitignored)
    ▼
agent calls lifecycle_current
    │  ├─ branch matches issue/6-X
    │  ├─ store.load(6) → MISS
    │  ├─ falls through to listOpen → empty
    │  └─ returns kind=none
    ▼
agent calls lifecycle_resume(6)
    │  ├─ store.load(6) → MISS
    │  ├─ gh issue view 6 --json body
    │  ├─ parseIssueBody → artifacts
    │  ├─ reconstruct record from issue body + current branch + cwd
    │  ├─ store.save → local materialization
    │  └─ returns hydrated record
    ▼
subsequent calls to lifecycle_current hit local store fast path
```

## Error Handling

**Phase 0 fixes don't introduce new error paths.** They change which inputs succeed, not what failure looks like.

**`lifecycle_current` failure modes:**

- `none`: agent treats as "no active lifecycle" and falls back to plain git. Not an error.
- `ambiguous`: agent must surface to user with the candidate list. Hard error in tool output.
- Network failure (rare, only if it has to call gh — usually pure local): bubble up as tool error.

**`lifecycle_resume` failure modes:**

- Issue not found on GitHub → hard error.
- Issue exists but has no managed markers (i.e. wasn't created by lifecycle) → hard error: "Issue #N is not a lifecycle issue."
- Issue body unparseable → hard error with body excerpt for debugging.

**`lifecycle_log_progress` failure modes:**

- No active lifecycle and no explicit `issue_number` → hard error: "No active lifecycle. Pass issue_number explicitly or run lifecycle_resume first."
- gh rate limit / network → tool returns failure, but does NOT throw within an auto-emit path (wrapped in try/catch by the lifecycle handle).

**Auto-emit progress failures are non-fatal.** The whole point of progress is observability. If observability itself is the failure, the underlying lifecycle operation still succeeded; emitting a warning to the agent log is sufficient.

**Backward compatibility for existing records.** Records pre-Phase-2 have no progress comments. `lifecycle_context` simply returns empty `recentProgress`. Records pre-Phase-0 (e.g. FlyBuild #34) work because nothing in their schema changed.

## Testing Strategy

**Phase 0 tests** (new):

- `tests/lifecycle/runner.test.ts`: `gh` accepts and respects `cwd`.
- `tests/lifecycle/pre-flight.test.ts`: classifyRepo passes cwd to gh, succeeds when process cwd is unrelated.
- `tests/lifecycle/commits.test.ts`: regression — `git add --all` stages new untracked file under the worktree. Assert file appears in commit's tree.

Existing tests in `tests/tools/lifecycle/*` and `tests/integration/lifecycle-end-to-end.test.ts` must keep passing without modification (modulo the staging change, where one assertion may need updating to expect untracked-included behavior).

**Phase 1 tests** (new):

- `tests/agents/brainstormer-commit.test.ts`: when active lifecycle exists, brainstormer's commit step calls `lifecycle_commit` mock, not plain git mock.
- `tests/hooks/artifact-auto-index.test.ts`: design files trigger indexing.
- Smoke test: write a design under `thoughts/shared/designs/` and assert `git check-ignore` returns non-zero (i.e. NOT ignored).

**Phase 2 tests** (new):

- `tests/lifecycle/resolver.test.ts`:
  - branch matches → resolved
  - branch doesn't match, store has 1 open → resolved
  - branch doesn't match, store has 2 open → ambiguous
  - branch doesn't match, store empty → none
  - resume from issue body when local missing → reconstructs and saves
  - resume on non-lifecycle issue → hard error

**Phase 3 tests** (new):

- `tests/lifecycle/progress.test.ts`:
  - log() resolves issue automatically when current() succeeds
  - log() formats comment with hidden marker
  - log() works when local record is missing (only needs gh)
  - context() filters comments by marker, returns last N
  - auto-emit from start/commit/finish wraps errors (mock gh failure during auto-emit; assert primary op still succeeded)

**Integration test:** end-to-end "fresh clone → lifecycle_resume → lifecycle_log_progress → lifecycle_context shows the comment" against a mock gh runner.

## Open Questions

None blocking. A few items deferred by explicit decision:

- **Issue body "Latest Progress" section** — deferred to v2. v1 keeps progress in comments to avoid colliding with `record_artifact`'s replace-mode body sync.
- **Auto-template `.gitignore` for user projects** — out of scope. Plugin doesn't currently write user gitignores; adding that is a separate feature.
- **Resolver caching** — not needed for v1. `git rev-parse` is microsecond-fast and `store.load` is a JSON read. Re-evaluate if instrumentation shows hot path.
- **Progress comment retention** — `context()` returns last 10. If issues accumulate hundreds, the agent context may need the cap to scale down or be configurable. Defer until observed.

## Ship order summary

| Phase | What | Blocks | Reversible |
|---|---|---|---|
| 0 | Fix runner cwd, pre-flight cwd, commit add --all | All other phases | Yes (small diffs) |
| 1 | Unignore shared docs, prompt updates, artifact-auto-index designs | None after Phase 0 | Yes (revert .gitignore + prompts) |
| 2 | Resolver tools (`lifecycle_current`, `lifecycle_resume`) | Phase 3 | Yes (new files only) |
| 3 | Progress tools (`lifecycle_log_progress`, `lifecycle_context`), auto-emit hooks, agent prompt triggers | None | Yes (new files + opt-in auto-emit) |

Ship Phase 0 first as its own commit. Then 1, 2, 3 in dependency order. Each phase is a clean rollback target if something goes wrong in QA.
