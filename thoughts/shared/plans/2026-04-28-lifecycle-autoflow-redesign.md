---
date: 2026-04-28
topic: "Lifecycle autoflow redesign"
issue: 6
scope: lifecycle
contract: none
---

# Lifecycle Autoflow Redesign Implementation Plan

**Goal:** Ship the four-phase v9 lifecycle redesign (Phase 0 bug fixes, Phase 1 partial unignore + prompts, Phase 2 resolver, Phase 3 progress) so that `lifecycle_start_request` works in this environment, designs/plans become shareable through git, the active issue auto-resolves from the current branch, and decisions/blockers/handoffs are captured as GitHub issue comments.

**Architecture:** All changes are internal to the `micode` OpenCode plugin (TypeScript). The lifecycle module gains two new pure-function modules (`resolver.ts`, `progress.ts`) and four new tool wrappers (`lifecycle_current`, `lifecycle_resume`, `lifecycle_log_progress`, `lifecycle_context`). Existing handle methods (`start`, `recordArtifact`, `commit`, `finish`) auto-emit best-effort progress events on success. No state file, no `.git/MICODE_ACTIVE_LIFECYCLE`; the active lifecycle is inferred from the current branch (regex `^issue/(\d+)-`) and falls back to `store.listOpen()`. Cross-machine resume reconstructs the local record from the GitHub issue body via the existing `parseIssueBody`.

**Design:** [thoughts/shared/designs/2026-04-28-lifecycle-autoflow-redesign-design.md](../designs/2026-04-28-lifecycle-autoflow-redesign-design.md)

**Contract:** none (single-domain TypeScript plugin internals)

**Tracking issue:** https://github.com/Wuxie233/micode/issues/6

---

## Operating context (read first)

- Work happens directly on `main`. Lifecycle tools are broken in this environment until Phase 0 lands; `lifecycle_start_request` cannot be used to open a worktree for this redesign. The user has agreed to a single manual `git push` at the end.
- After Phase 0 source changes land, the live runtime at `/root/.micode/dist/` is still stale. The wrap-up task copies the freshly built `dist/` into `/root/.micode/` and BLOCKS asking the user to restart OpenCode. Do NOT auto-restart.
- Every task is `Domain: general` (single-domain plugin internals).
- TDD-first: each implementation task ships with its test file; tests are written first and must fail before implementation lands. Where a task only modifies an existing test (regression update), the modification is the test deliverable and the verification is "the existing suite still passes."
- Use `bun run check` (Biome + ESLint + typecheck + `bun test`) as the single quality gate; individual tasks run focused `bun test path/to/file.test.ts` as a fast feedback loop.

### Gap-filling decisions (filled by planner, not in design)

- **Progress comment marker format.** Design specifies `<!-- micode:lifecycle:progress kind=KIND -->`. Planner choice: also embed timestamp in ISO 8601 to make `context()` ordering deterministic without re-fetching `createdAt`.
- **`listOpen()` semantics.** Design says "records whose state is not closed/cleaned/aborted". Planner choice: implement as `store.list()` followed by `store.load()` per id, filter by `LIFECYCLE_TERMINAL_STATES = ["closed", "cleaned", "aborted"]` (added as a `readonly` const tuple in `store.ts`). Iteration cost is O(open lifecycles), bounded.
- **Resolver record reconstruction.** Design lists fields. Planner choice: `branch` derived from `git rev-parse --abbrev-ref HEAD`; `worktree` derived from `git rev-parse --show-toplevel`; `state` from parsed body (default `IN_PROGRESS` if marker absent but artifacts exist); `artifacts` from `parseIssueBody`. Validate via `LifecycleRecordSchema.safeParse` before saving.
- **Auto-emit `runtime.now` for tests.** Inject a `now: () => number` (default `Date.now`) into `createProgressLogger` so tests can assert deterministic timestamps in formatted comment bodies.
- **Config flag for auto-emit.** Add `config.lifecycle.autoEmitProgress: boolean` (default `true`) so the kill-switch is one boolean flip if a downstream environment behaves badly.
- **Wrap-up live-path location.** Per `CLAUDE.md`, `/root/.micode/` is the runtime path that OpenCode loads. Wrap-up task syncs `dist/` into it and tells the user to restart manually.

---

## Dependency Graph

```
Phase 0 (bug fixes, ships first)
  Batch 0a (parallel, 3 tasks): test-first regressions/extensions
    0.1 runner.gh cwd test
    0.2 pre-flight passes cwd test (no behaviour change in fake runner)
    0.3 commits.ts staging-arg test (--all)
  Batch 0b (parallel, 3 tasks): production code to make 0a green
    0.4 runner.ts gh accepts cwd        depends 0.1
    0.5 pre-flight.ts threads cwd       depends 0.2, 0.4
    0.6 commits.ts STAGE_ARGS = --all   depends 0.3
  Batch 0c (1 task)
    0.7 phase-0 quality gate            depends 0.4, 0.5, 0.6

Phase 1 (shareable docs + prompts)
  Batch 1a (parallel, 3 tasks)
    1.1 .gitignore tiered policy + smoke test
    1.2 artifact-auto-index design pattern test
    1.3 artifact-auto-index design pattern impl   depends 1.2
  Batch 1b (parallel, 3 tasks)
    1.4 brainstormer prompt: lifecycle_current → lifecycle_commit
    1.5 planner prompt: drop "Do NOT commit", add lifecycle_current branch
    1.6 executor prompt verification (no edit, just confirm Phase 0 fix unblocks it)

Phase 2 (resolver + cross-machine resume)
  Batch 2a (parallel, 4 tasks): test-first
    2.1 store.listOpen test
    2.2 resolver.current branches test
    2.3 resolver.resume happy/error test
    2.4 lifecycle types: TERMINAL_STATES export test
  Batch 2b (parallel, 4 tasks): impl
    2.5 store.ts listOpen + TERMINAL_STATES   depends 2.1, 2.4
    2.6 resolver.ts current + resume          depends 2.2, 2.3, 2.5
    2.7 tools/lifecycle/current.ts            depends 2.6
    2.8 tools/lifecycle/resume.ts             depends 2.6
  Batch 2c (1 task)
    2.9 wire current/resume into createLifecycleTools + index.ts   depends 2.7, 2.8

Phase 3 (progress + auto-emit + agent triggers)
  Batch 3a (parallel, 3 tasks): test-first
    3.1 progress.log/context test
    3.2 auto-emit best-effort test (failure does not break primary op)
    3.3 lifecycle_log_progress / lifecycle_context tool wrapper tests
  Batch 3b (parallel, 4 tasks): impl
    3.4 lifecycle/progress.ts createProgressLogger        depends 3.1
    3.5 lifecycle/index.ts auto-emit wiring (try/catch)   depends 3.2, 3.4
    3.6 tools/lifecycle/log-progress.ts                   depends 3.3, 3.4
    3.7 tools/lifecycle/context.ts                        depends 3.3, 3.4
  Batch 3c (1 task)
    3.8 wire log-progress/context into createLifecycleTools + index.ts   depends 3.6, 3.7
  Batch 3d (parallel, 3 tasks): prompt edits
    3.9 brainstormer progress triggers (decision/handoff)
    3.10 planner progress triggers (discovery/handoff)
    3.11 executor progress triggers (status/blocker/handoff)

Wrap-up (final, 1 task)
  4.1 quality gate + build + dist sync + BLOCK + post-restart smoke   depends ALL
```

---

## Phase 0: Unblock the foundation (parallel within batches)

Phase 0 ships in three small batches. Tests ship first (0a), implementation follows (0b), then a Phase-0 gate (0c) before moving on. **This phase MUST land and the runtime MUST be rebuilt before lifecycle tools are usable for Phases 1-3.** However, since the user has agreed we work directly on `main` for this redesign, the rebuild and runtime restart only happen at the end of the wrap-up task; intermediate batches commit normally with `git commit` (no lifecycle tool needed).

### Batch 0a: Phase 0 regression tests (parallel - 3 implementers)

#### Task 0.1: Test that `runner.gh` accepts and respects `cwd`
**File:** `tests/lifecycle/runner.test.ts`
**Test:** itself (this task extends an existing test file)
**Depends:** none
**Domain:** general

Add a third `it(...)` to the existing `describe("createLifecycleRunner", ...)` block. The new test verifies that passing `{ cwd }` to `runner.gh` is accepted by the type signature AND that the underlying process honors the cwd. We test cwd honoring by running `git rev-parse --show-toplevel` indirectly: easier path is to assert the signature compiles and the call resolves with `OK_EXIT_CODE`. Since `gh --version` does not depend on cwd, we use a no-op assertion that the call shape is accepted. The behavioural integration is covered by `tests/lifecycle/pre-flight.test.ts` (Task 0.2 / 0.5).

```typescript
// Append to tests/lifecycle/runner.test.ts inside describe("createLifecycleRunner", ...)

it("accepts an optional cwd on gh and resolves successfully", async () => {
  const runner = createLifecycleRunner();

  const completed = await runner.gh(VERSION_ARGS, { cwd: process.cwd() });

  expect(completed.exitCode).toBe(OK_EXIT_CODE);
  expect(completed.stdout.trim().length).toBeGreaterThan(0);
});
```

This test will FAIL before Task 0.4 lands (the current `gh` signature does not accept a second argument; TypeScript will reject the call).

**Verify:** `bun test tests/lifecycle/runner.test.ts` (expect new test to fail before 0.4)
**Commit:** `test(lifecycle): assert runner.gh accepts cwd option`

#### Task 0.2: Test that `classifyRepo` threads `cwd` to the gh runner
**File:** `tests/lifecycle/pre-flight.test.ts`
**Test:** itself
**Depends:** none
**Domain:** general

Update the `expectCalls` helper and the assertions so that the `gh` call records the cwd. The fake runner's `gh` method already ignores cwd; extend the fake to record it and the existing tests to expect `cwd: CWD` for both `git` and `gh` rows.

```typescript
// In tests/lifecycle/pre-flight.test.ts replace the gh handler in createRunner:
gh: async (args, options) => {
  calls.push({ bin: "gh", args, cwd: options?.cwd });
  return outputs.gh ?? createRun(EMPTY_OUTPUT);
},

// And update expectCalls:
const expectCalls = (runner: FakeRunner): void => {
  expect(runner.calls).toEqual([
    { bin: "git", args: GIT_ARGS, cwd: CWD },
    { bin: "gh", args: GH_ARGS, cwd: CWD },
  ]);
};
```

This change makes the existing four tests fail before Task 0.5 lands (the production `classifyRepo` does NOT pass cwd to `runner.gh`, so `cwd` will be `undefined`).

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts` (expect failures before 0.5)
**Commit:** `test(lifecycle): assert pre-flight threads cwd to gh`

#### Task 0.3: Test that staging uses `--all` and includes untracked files
**File:** `tests/lifecycle/commits.test.ts`
**Test:** itself
**Depends:** none
**Domain:** general

Two surgical changes:

1. Replace the `STAGE_ARGS` constant: `const STAGE_ARGS = ["add", "--all"] as const;`
2. Existing assertions that compare `runner.calls` to `[{ args: STAGE_ARGS, cwd: CWD }, ...]` continue to assert the new staging arg automatically.
3. Add ONE new positive test that staging produces `--all`:

```typescript
it("stages with git add --all so untracked files are included", async () => {
  const runner = createRunner([createRun(), createRun(), createRun(`${SHA}\n`), createRun()]);

  await commitAndPush(runner, INPUT);

  expect(runner.calls[0]).toEqual({ args: ["add", "--all"], cwd: CWD });
});
```

This makes the suite fail before Task 0.6 lands (the production `STAGE_ARGS` is still `["add", "--update"]`).

**Verify:** `bun test tests/lifecycle/commits.test.ts` (expect failures before 0.6)
**Commit:** `test(lifecycle): assert commitAndPush stages with --all`

### Batch 0b: Phase 0 production code (parallel - 3 implementers)

#### Task 0.4: Extend `runner.gh` to accept `cwd`
**File:** `src/lifecycle/runner.ts`
**Test:** `tests/lifecycle/runner.test.ts` (Task 0.1)
**Depends:** 0.1
**Domain:** general

Mirror the existing `git` shape. `runCommand` already accepts `cwd`; just thread it through.

```typescript
// src/lifecycle/runner.ts (full file)
import { $ } from "bun";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface LifecycleRunner {
  readonly git: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
  readonly gh: (args: readonly string[], options?: { cwd?: string }) => Promise<RunResult>;
}

const LOG_MODULE = "lifecycle";
const GIT_BIN = "git";
const GH_BIN = "gh";
const EMPTY_OUTPUT = "";
const FAILURE_EXIT_CODE = 1;

async function runCommand(bin: string, args: readonly string[], cwd?: string): Promise<RunResult> {
  try {
    const tokens = [...args];
    const command = cwd ? $`${bin} ${tokens}`.cwd(cwd) : $`${bin} ${tokens}`;

    const completed = await command.quiet().nothrow();
    return {
      stdout: completed.stdout.toString(),
      stderr: completed.stderr.toString(),
      exitCode: completed.exitCode,
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    log.warn(LOG_MODULE, `${bin} failed: ${message}`);
    return { stdout: EMPTY_OUTPUT, stderr: message, exitCode: FAILURE_EXIT_CODE };
  }
}

export function createLifecycleRunner(): LifecycleRunner {
  return {
    git: (args, options) => runCommand(GIT_BIN, args, options?.cwd),
    gh: (args, options) => runCommand(GH_BIN, args, options?.cwd),
  };
}
```

**Verify:** `bun test tests/lifecycle/runner.test.ts`
**Commit:** `fix(lifecycle): runner.gh accepts cwd option`

#### Task 0.5: Pass `cwd` from `classifyRepo` to `runner.gh`
**File:** `src/lifecycle/pre-flight.ts`
**Test:** `tests/lifecycle/pre-flight.test.ts` (Task 0.2)
**Depends:** 0.2, 0.4
**Domain:** general

One-line change. Locate the `runner.gh(GH_REPO_ARGS)` call inside `classifyRepo` and add `{ cwd }`.

```typescript
// src/lifecycle/pre-flight.ts: edit ONLY the gh call inside classifyRepo
export async function classifyRepo(runner: LifecycleRunner, cwd: string): Promise<PreFlightResult> {
  const remote = await runner.git(GIT_ORIGIN_ARGS, { cwd });
  if (!completed(remote)) return createUnknown();

  const origin = remote.stdout.trim();
  const inspected = await runner.gh(GH_REPO_ARGS, { cwd });
  if (!completed(inspected)) return createUnknown(origin);

  const view = parseRepoView(inspected.stdout);
  if (!view) return createUnknown(origin);

  return createResult(origin, view);
}
```

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts`
**Commit:** `fix(lifecycle): classifyRepo threads cwd into gh repo view`

#### Task 0.6: Switch staging from `--update` to `--all`
**File:** `src/lifecycle/commits.ts`
**Test:** `tests/lifecycle/commits.test.ts` (Task 0.3)
**Depends:** 0.3
**Domain:** general

One-line change to the `STAGE_ARGS` constant.

```typescript
// src/lifecycle/commits.ts: only change STAGE_ARGS
const STAGE_ARGS = ["add", "--all"] as const;
```

Rationale: `--update` only stages files already tracked. New design/plan files (post-Phase-1 unignore) and any new source file born inside the lifecycle worktree must be picked up. `--all` respects `.gitignore`, so personal `thoughts/` subtrees are still excluded.

**Verify:** `bun test tests/lifecycle/commits.test.ts`
**Commit:** `fix(lifecycle): stage with git add --all so new files commit`

### Batch 0c: Phase 0 gate (sequential - 1 implementer)

#### Task 0.7: Phase 0 quality gate
**File:** none (verification only)
**Test:** entire suite
**Depends:** 0.4, 0.5, 0.6
**Domain:** general

Run the full quality gate to confirm Phase 0 is internally consistent before opening Phase 1.

```sh
bun run check
```

If this fails, fix in place and re-run. Do NOT proceed to Phase 1 until green.

**Verify:** zero failures from `bun run check`
**Commit:** none (Phase 0 already committed in tasks 0.4-0.6; this is a gate, not a code change)

---

## Phase 1: Make designs and plans shareable (parallel within batches)

### Batch 1a: shared-doc plumbing (parallel - 3 implementers)

#### Task 1.1: Tier `.gitignore` so designs and plans are shareable
**File:** `.gitignore`
**Test:** `tests/integration/gitignore-shared-docs.test.ts` (new)
**Depends:** none
**Domain:** general

Replace the single `thoughts/` rule with a tiered block. Tier 1 stays gitignored (personal session state); Tier 2 (designs and plans) becomes shareable. Existing committed history is unaffected because nothing under `thoughts/shared/` was ever committed under the old rule.

Test first:

```typescript
// tests/integration/gitignore-shared-docs.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const PROJECT_ROOT = process.cwd();

describe("gitignore tiered policy", () => {
  it("ignores thoughts/ledgers/CONTINUITY*.md", async () => {
    const probe = "thoughts/ledgers/CONTINUITY_test_probe.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).toBe(0);
  });

  it("does NOT ignore thoughts/shared/designs/*.md", async () => {
    const probe = "thoughts/shared/designs/2099-01-01-probe-design.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });

  it("does NOT ignore thoughts/shared/plans/*.md", async () => {
    const probe = "thoughts/shared/plans/2099-01-01-probe.md";
    const result = await $`git -C ${PROJECT_ROOT} check-ignore -q ${probe}`.nothrow().quiet();
    expect(result.exitCode).not.toBe(0);
  });
});
```

Implementation: replace the `thoughts/` line in `.gitignore` with:

```
# Tier 1: completely local (personal session state)
thoughts/ledgers/
thoughts/brainstorms/
thoughts/octto/
thoughts/lifecycle/

# Tier 2: shareable (cross-developer artifacts)
# thoughts/shared/designs/**/*.md and thoughts/shared/plans/**/*.md ship in git.
```

**Verify:** `bun test tests/integration/gitignore-shared-docs.test.ts`
**Commit:** `feat(repo): tier .gitignore so shared designs and plans ship in git`

#### Task 1.2: Test that `artifact-auto-index` recognizes design files
**File:** `tests/hooks/artifact-auto-index.test.ts` (extend if exists; create otherwise)
**Test:** itself
**Depends:** none
**Domain:** general

If the file already exists, append the design test inside the existing `describe`. If it does not exist, create with the imports below. Skeleton:

```typescript
// tests/hooks/artifact-auto-index.test.ts (or extend existing)
import { describe, expect, it } from "bun:test";

import { parseLedger } from "@/hooks/artifact-auto-index";

const DESIGN_PATTERN = /thoughts\/shared\/designs\/(.+)\.md$/;

describe("artifact-auto-index design recognition", () => {
  it("matches a design path under thoughts/shared/designs", () => {
    const sample = "thoughts/shared/designs/2026-04-28-feature-x-design.md";
    const match = sample.match(DESIGN_PATTERN);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("2026-04-28-feature-x-design");
  });

  it("does not match a design under a non-shared path", () => {
    const sample = "thoughts/lifecycle/something-design.md";
    expect(sample.match(DESIGN_PATTERN)).toBeNull();
  });

  // parseLedger import is just to confirm the module loads cleanly post-change.
  it("keeps existing ledger parser intact", () => {
    expect(typeof parseLedger).toBe("function");
  });
});
```

The first two tests pass without code changes (they test the regex shape). They serve as a guardrail so that Task 1.3's regex update keeps matching behaviour explicit.

**Verify:** `bun test tests/hooks/artifact-auto-index.test.ts`
**Commit:** `test(hooks): add design path recognition guards for auto-index`

#### Task 1.3: Add `designPattern` and `parseDesign` to `artifact-auto-index`
**File:** `src/hooks/artifact-auto-index.ts`
**Test:** `tests/hooks/artifact-auto-index.test.ts` (Task 1.2)
**Depends:** 1.2
**Domain:** general

Add a `DESIGN_PATH_PATTERN`, a `parseDesign` helper that extracts title and overview (mirroring `parsePlan`), and a third `if` block in the hook handler that calls `index.indexPlan(record)` for designs (we reuse the plan index because designs are shaped identically: title + overview + approach). If `getArtifactIndex` does not yet have a dedicated design path, indexing under the plan index is acceptable; this is the design's stated intent ("Index designs the same way plans are indexed today").

```typescript
// src/hooks/artifact-auto-index.ts (deltas only - keep existing code)

const DESIGN_PATH_PATTERN = /thoughts\/shared\/designs\/(.+)\.md$/;

function parseDesign(
  content: string,
  filePath: string,
  fileName: string,
): {
  id: string;
  title: string;
  filePath: string;
  overview: string;
  approach: string;
} {
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch?.[1] || fileName;

  const overviewMatch = content.match(/## (?:Overview|Problem Statement)\n\n([\s\S]*?)(?=\n## |$)/);
  const overview = overviewMatch?.[1]?.trim() || "";

  const approachMatch = content.match(/## Approach\n\n([\s\S]*?)(?=\n## |$)/);
  const approach = approachMatch?.[1]?.trim() || "";

  return {
    id: `design-${fileName}`,
    title,
    filePath,
    overview,
    approach,
  };
}

// Inside the tool.execute.after handler, after the planMatch block:
const designMatch = filePath.match(DESIGN_PATH_PATTERN);
if (designMatch) {
  const content = readFileSync(filePath, "utf-8");
  const index = await getArtifactIndex();
  const record = parseDesign(content, filePath, designMatch[1]);
  await index.indexPlan(record);
  return;
}
```

**Verify:** `bun test tests/hooks/artifact-auto-index.test.ts && bun run typecheck`
**Commit:** `feat(hooks): index design files alongside plans`

### Batch 1b: agent prompt updates (parallel - 3 implementers)

#### Task 1.4: Brainstormer prompt: prefer `lifecycle_commit` when active lifecycle exists
**File:** `src/agents/brainstormer.ts`
**Test:** none (prompt content; covered by integration in wrap-up)
**Depends:** none (Phase 0 must be live for the rule to actually work, but the prompt edit itself does not depend on it)
**Domain:** general

In `<phase name="finalizing" trigger="after presenting design">`, replace the existing single-line rule with a two-step guidance.

```typescript
// src/agents/brainstormer.ts: replace the single <action> line at ~199 with:

  <action>Write validated design to thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md</action>
  <action>Try lifecycle_current to discover the active issue. If kind=resolved, call lifecycle_commit(issue_number, scope, summary) to commit and auto-push the design. If kind=none, fall back to plain `git add` + `git commit -m "docs(design): ..."`. If git add fails because the file is gitignored, skip silently — NEVER force-add ignored files. If kind=ambiguous, surface the candidates to the user and stop.</action>
  <action>IMMEDIATELY spawn planner - do NOT ask "Ready for planner?"</action>
```

(Replace the original single `<action>` "Commit the design document to git ..." with these three lines, keeping the spawn block below intact.)

**Verify:** `bun run typecheck` (prompt is a TypeScript string so typecheck is sufficient)
**Commit:** `feat(brainstormer): commit designs through lifecycle_commit when active`

#### Task 1.5: Planner prompt: drop "Do NOT commit", commit plans through lifecycle when active
**File:** `src/agents/planner.ts`
**Test:** none (prompt content)
**Depends:** none
**Domain:** general

In `<phase name="output">` replace the existing two `<action>` lines with three:

```typescript
// src/agents/planner.ts: ~lines 176-179, replace the <phase name="output"> body with:

<phase name="output">
  <action>Write plan to thoughts/shared/plans/YYYY-MM-DD-{topic}.md (and contract file if cross-domain)</action>
  <action>Call lifecycle_current. If kind=resolved, call lifecycle_commit(issue_number, scope, summary) to commit and auto-push the plan. If kind=none, leave the plan uncommitted (a plan without an active lifecycle is likely a design-only flow; the user will commit when ready). If kind=ambiguous, surface candidates and stop.</action>
  <action>Do NOT run git commands directly except as the explicit fallback above</action>
</phase>
```

Also update the existing `<forbidden>NEVER run git commands ...</forbidden>` (line ~505) to:

```
<forbidden>NEVER run git commands except the documented fallback in the output phase</forbidden>
```

**Verify:** `bun run typecheck`
**Commit:** `feat(planner): commit plans through lifecycle_commit when active`

#### Task 1.6: Executor prompt verification (no edit expected)
**File:** `src/agents/executor.ts`
**Test:** none (verification only)
**Depends:** none
**Domain:** general

Read the executor's lifecycle integration block (around lines 230-250). Verify it already:

1. Skips `lifecycle_commit` when issue is absent (quick mode).
2. Calls `lifecycle_commit(issue_number, scope, summary)` exactly once after all batches go green.
3. Includes failure note in the final report on commit failure.

If any of those is missing, surface as a blocker and add the rule. If all three are present (expected), no edit. Either way, this task is closed by reading and explicitly stating "verified, no edit needed" in the commit message.

**Verify:** manual read; document in commit body
**Commit:** `chore(executor): verify lifecycle_commit phase is intact post Phase 0`

---

## Phase 2: Resolver-first active lifecycle (parallel within batches)

### Batch 2a: tests first (parallel - 4 implementers)

#### Task 2.1: Test `store.listOpen()` returns only non-terminal records
**File:** `tests/lifecycle/store.test.ts`
**Test:** itself (extends existing)
**Depends:** none
**Domain:** general

Extend the existing store test file with new `it(...)` cases inside the `describe("createLifecycleStore", ...)` block. Save three records: one `IN_PROGRESS`, one `CLOSED`, one `ABORTED`. Assert `listOpen()` returns the issue number for `IN_PROGRESS` only. Use a tmp dir per `beforeEach` (the existing tests should already do this; mirror their pattern).

```typescript
it("listOpen returns only records whose state is not terminal", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "lifecycle-store-"));
  const store = createLifecycleStore({ baseDir });

  await store.save({ ...baseRecord(7), state: LIFECYCLE_STATES.IN_PROGRESS });
  await store.save({ ...baseRecord(8), state: LIFECYCLE_STATES.CLOSED });
  await store.save({ ...baseRecord(9), state: LIFECYCLE_STATES.ABORTED });

  const open = await store.listOpen();
  expect(open).toEqual([7]);
  rmSync(baseDir, { recursive: true, force: true });
});
```

`baseRecord(n)` is a small helper returning a valid `LifecycleRecord` with `issueNumber: n`, empty artifacts, empty notes, `updatedAt: 0`. If the existing test file already has such a helper, reuse it.

**Verify:** `bun test tests/lifecycle/store.test.ts` (expect failure: `listOpen` does not exist yet)
**Commit:** `test(lifecycle): assert store.listOpen filters terminal states`

#### Task 2.2: Test resolver `current()` across the four branches
**File:** `tests/lifecycle/resolver.test.ts` (new)
**Test:** itself
**Depends:** none
**Domain:** general

Cover the four cases from the design: branch matches `^issue/(\d+)-` and store hits → `resolved`; branch matches but store misses (cross-machine case) → falls through; branch does not match and `listOpen()` returns 1 → `resolved`; returns 0 → `none`; returns 2+ → `ambiguous`. Use a fake runner that returns canned `git rev-parse --abbrev-ref HEAD` stdout, and a fake store with `listOpen` and `load` methods.

Skeleton (full code in implementer's hands):

```typescript
import { describe, expect, it } from "bun:test";
import { createResolver } from "@/lifecycle/resolver";
// fake runner + fake store helpers

describe("createResolver.current", () => {
  it("resolves from branch when store hits", async () => { /* ... */ });
  it("falls through when branch matches but store misses", async () => { /* ... */ });
  it("resolves from listOpen when exactly one is open", async () => { /* ... */ });
  it("returns none when listOpen is empty and branch does not match", async () => { /* ... */ });
  it("returns ambiguous when listOpen returns multiple", async () => { /* ... */ });
});
```

**Verify:** `bun test tests/lifecycle/resolver.test.ts` (expect failures; module does not exist)
**Commit:** `test(lifecycle): cover resolver.current branches`

#### Task 2.3: Test resolver `resume()` happy path and error paths
**File:** `tests/lifecycle/resolver.test.ts` (same file as 2.2)
**Test:** itself
**Depends:** none (combined with 2.2 in one file)
**Domain:** general

Append a `describe("createResolver.resume", ...)` block. Cases: store hit short-circuits (no gh call); store miss + valid issue body reconstructs and saves; issue not found (`gh issue view` exits non-zero) → throws; issue body without managed markers → throws "not a lifecycle issue".

Use the marker constants from `src/lifecycle/issue-body-markers.ts` to build a synthetic body that `parseIssueBody` will accept.

**Verify:** `bun test tests/lifecycle/resolver.test.ts`
**Commit:** `test(lifecycle): cover resolver.resume happy and error paths`

#### Task 2.4: Test that lifecycle types export `TERMINAL_STATES`
**File:** `tests/lifecycle/types.test.ts`
**Test:** itself
**Depends:** none
**Domain:** general

One additional `it(...)` asserting that `TERMINAL_STATES` is exported as a `readonly` tuple containing exactly `closed`, `cleaned`, `aborted`. This locks the contract `store.listOpen()` relies on.

```typescript
it("exposes TERMINAL_STATES tuple for resolver filtering", () => {
  // import TERMINAL_STATES from "@/lifecycle/types"
  expect([...TERMINAL_STATES].sort()).toEqual(["aborted", "cleaned", "closed"]);
});
```

**Verify:** `bun test tests/lifecycle/types.test.ts`
**Commit:** `test(lifecycle): assert TERMINAL_STATES export`

### Batch 2b: production code (parallel - 4 implementers)

#### Task 2.5: Add `TERMINAL_STATES` and `store.listOpen()`
**File:** `src/lifecycle/store.ts` (and `src/lifecycle/types.ts` for the constant)
**Test:** `tests/lifecycle/store.test.ts` (Task 2.1), `tests/lifecycle/types.test.ts` (Task 2.4)
**Depends:** 2.1, 2.4
**Domain:** general

This task touches two files but they are atomically coupled (the constant and the consumer). The store is small and the constant export is one line; treat as one logical unit.

In `src/lifecycle/types.ts`, append:

```typescript
export const TERMINAL_STATES = [LIFECYCLE_STATES.CLOSED, LIFECYCLE_STATES.CLEANED, LIFECYCLE_STATES.ABORTED] as const;
export type TerminalState = (typeof TERMINAL_STATES)[number];
```

In `src/lifecycle/store.ts`, extend the `LifecycleStore` interface and the factory return value:

```typescript
import { TERMINAL_STATES } from "@/lifecycle/types";
// ...

export interface LifecycleStore {
  readonly save: (record: LifecycleRecord) => Promise<void>;
  readonly load: (issueNumber: number) => Promise<LifecycleRecord | null>;
  readonly delete: (issueNumber: number) => Promise<void>;
  readonly list: () => Promise<readonly number[]>;
  readonly listOpen: () => Promise<readonly number[]>;
}

const isTerminalState = (state: string): boolean => (TERMINAL_STATES as readonly string[]).includes(state);

// In createLifecycleStore returned object, add:
async listOpen(): Promise<readonly number[]> {
  const all = await this.list();
  const open: number[] = [];
  for (const issueNumber of all) {
    const record = await this.load(issueNumber);
    if (record === null) continue;
    if (isTerminalState(record.state)) continue;
    open.push(issueNumber);
  }
  return open;
},
```

Note: `this.list` inside an object literal needs a small refactor — extract `list` and `load` first then reference by name. Implementer is free to choose the cleanest local form.

**Verify:** `bun test tests/lifecycle/store.test.ts tests/lifecycle/types.test.ts`
**Commit:** `feat(lifecycle): expose TERMINAL_STATES and store.listOpen`

#### Task 2.6: Implement `createResolver` (`current` + `resume`)
**File:** `src/lifecycle/resolver.ts` (new)
**Test:** `tests/lifecycle/resolver.test.ts` (Tasks 2.2, 2.3)
**Depends:** 2.2, 2.3, 2.5
**Domain:** general

Pure-function module, no side effects beyond what `runner` and `store` provide.

```typescript
import { LifecycleRecordSchema } from "@/lifecycle/schemas";
import * as v from "valibot";

import { parseIssueBody } from "./issue-body";
import type { LifecycleRunner } from "./runner";
import type { LifecycleStore } from "./store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "./types";

export type ResolverResult =
  | { readonly kind: "resolved"; readonly record: LifecycleRecord }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly number[] };

export interface ResolverDeps {
  readonly runner: LifecycleRunner;
  readonly store: LifecycleStore;
  readonly cwd: string;
}

export interface Resolver {
  readonly current: () => Promise<ResolverResult>;
  readonly resume: (issueNumber: number) => Promise<LifecycleRecord>;
}

const BRANCH_PATTERN = /^issue\/(\d+)-/;
const OK_EXIT_CODE = 0;
const DECIMAL_RADIX = 10;
const NOT_LIFECYCLE_ISSUE = "not_a_lifecycle_issue";
const ISSUE_NOT_FOUND = "issue_not_found";

const readBranch = async (deps: ResolverDeps): Promise<string | null> => {
  const run = await deps.runner.git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: deps.cwd });
  if (run.exitCode !== OK_EXIT_CODE) return null;
  const branch = run.stdout.trim();
  return branch.length > 0 ? branch : null;
};

const readWorktree = async (deps: ResolverDeps): Promise<string> => {
  const run = await deps.runner.git(["rev-parse", "--show-toplevel"], { cwd: deps.cwd });
  if (run.exitCode !== OK_EXIT_CODE) return deps.cwd;
  const top = run.stdout.trim();
  return top.length > 0 ? top : deps.cwd;
};

const matchBranchIssue = (branch: string): number | null => {
  const match = BRANCH_PATTERN.exec(branch);
  const raw = match?.[1];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return null;
};

const reconstructFromBody = async (
  deps: ResolverDeps,
  issueNumber: number,
  body: string,
): Promise<LifecycleRecord> => {
  const parsed = parseIssueBody(body);
  const hasMarkers = parsed.state !== undefined || parsed.artifacts !== undefined;
  if (!hasMarkers) throw new Error(`${NOT_LIFECYCLE_ISSUE}: #${issueNumber}`);

  const branch = (await readBranch(deps)) ?? `issue/${issueNumber}`;
  const worktree = await readWorktree(deps);
  const candidate: LifecycleRecord = {
    issueNumber,
    issueUrl: "",
    branch,
    worktree,
    state: parsed.state ?? LIFECYCLE_STATES.IN_PROGRESS,
    artifacts: parsed.artifacts ?? {
      [ARTIFACT_KINDS.DESIGN]: [],
      [ARTIFACT_KINDS.PLAN]: [],
      [ARTIFACT_KINDS.LEDGER]: [],
      [ARTIFACT_KINDS.COMMIT]: [],
      [ARTIFACT_KINDS.PR]: [],
      [ARTIFACT_KINDS.WORKTREE]: [],
    },
    notes: [],
    updatedAt: Date.now(),
  };

  const validated = v.safeParse(LifecycleRecordSchema, candidate);
  if (!validated.success) throw new Error(`${NOT_LIFECYCLE_ISSUE}: schema_invalid #${issueNumber}`);
  return validated.output;
};

export function createResolver(deps: ResolverDeps): Resolver {
  return {
    async current(): Promise<ResolverResult> {
      const branch = await readBranch(deps);
      if (branch !== null) {
        const issueNumber = matchBranchIssue(branch);
        if (issueNumber !== null) {
          const record = await deps.store.load(issueNumber);
          if (record !== null) return { kind: "resolved", record };
        }
      }

      const open = await deps.store.listOpen();
      if (open.length === 0) return { kind: "none" };
      if (open.length === 1) {
        const record = await deps.store.load(open[0]);
        if (record === null) return { kind: "none" };
        return { kind: "resolved", record };
      }
      return { kind: "ambiguous", candidates: open };
    },

    async resume(issueNumber: number): Promise<LifecycleRecord> {
      const local = await deps.store.load(issueNumber);
      if (local) return local;

      const view = await deps.runner.gh(["issue", "view", String(issueNumber), "--json", "body"], { cwd: deps.cwd });
      if (view.exitCode !== OK_EXIT_CODE) throw new Error(`${ISSUE_NOT_FOUND}: #${issueNumber}`);

      let body = "";
      try {
        const parsed: unknown = JSON.parse(view.stdout);
        if (parsed && typeof parsed === "object" && "body" in parsed) {
          const candidate = (parsed as { body?: unknown }).body;
          body = typeof candidate === "string" ? candidate : "";
        }
      } catch {
        // Older gh emits plain text; fall back to raw stdout.
        body = view.stdout;
      }

      const record = await reconstructFromBody(deps, issueNumber, body);
      await deps.store.save(record);
      return record;
    },
  };
}
```

**Verify:** `bun test tests/lifecycle/resolver.test.ts`
**Commit:** `feat(lifecycle): add resolver.current and resolver.resume`

#### Task 2.7: `lifecycle_current` tool wrapper
**File:** `src/tools/lifecycle/current.ts` (new)
**Test:** `tests/tools/lifecycle/current.test.ts` (new — co-located with this task per project pattern; ship together as one file unit since it's a thin wrapper)
**Depends:** 2.6
**Domain:** general

```typescript
// src/tools/lifecycle/current.ts
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { Resolver, ResolverResult } from "@/lifecycle/resolver";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Resolve the active lifecycle for the current branch / worktree.

Returns kind=resolved with issue number, branch, worktree, state when an active lifecycle is detected.
Returns kind=none when no lifecycle is active for the current branch.
Returns kind=ambiguous with the candidate list when multiple open lifecycles exist and the branch is non-lifecycle.`;

const RESOLVED_HEADER = "## Active lifecycle";
const NONE_HEADER = "## No active lifecycle";
const AMBIGUOUS_HEADER = "## Ambiguous active lifecycle";
const FAILURE_HEADER = "## lifecycle_current failed";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatResolved = (result: Extract<ResolverResult, { kind: "resolved" }>): string => {
  const r = result.record;
  const row = `| ${r.issueNumber} | \`${r.branch}\` | \`${r.worktree}\` | \`${r.state}\` |`;
  return `${RESOLVED_HEADER}${DOUBLE_LINE_BREAK}${[TABLE_HEADER, TABLE_SEPARATOR, row].join(LINE_BREAK)}`;
};

const formatAmbiguous = (result: Extract<ResolverResult, { kind: "ambiguous" }>): string => {
  const candidates = result.candidates.map((n) => `- #${n}`).join(LINE_BREAK);
  return `${AMBIGUOUS_HEADER}${DOUBLE_LINE_BREAK}${candidates}${DOUBLE_LINE_BREAK}Pass issue_number explicitly or run lifecycle_resume first.`;
};

const formatResult = (result: ResolverResult): string => {
  if (result.kind === "resolved") return formatResolved(result);
  if (result.kind === "ambiguous") return formatAmbiguous(result);
  return `${NONE_HEADER}${DOUBLE_LINE_BREAK}No issue/<N>-* branch is checked out and no open lifecycle records are present.`;
};

export type ResolverHandle = Pick<Resolver, "current">;

export function createLifecycleCurrentTool(resolver: ResolverHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {},
    execute: async () => {
      try {
        return formatResult(await resolver.current());
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
```

Test:

```typescript
// tests/tools/lifecycle/current.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";
import type { ResolverResult } from "@/lifecycle/resolver";
import { LIFECYCLE_STATES, ARTIFACT_KINDS } from "@/lifecycle/types";

const mkRecord = () => ({
  issueNumber: 6,
  issueUrl: "",
  branch: "issue/6-redesign",
  worktree: "/tmp/wt",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: 0,
});

describe("lifecycle_current tool", () => {
  it("renders resolved markdown with the issue row", async () => {
    const tool = createLifecycleCurrentTool({ current: async () => ({ kind: "resolved", record: mkRecord() }) });
    const out = await tool.execute({}, {} as never);
    expect(out).toContain("## Active lifecycle");
    expect(out).toContain("| 6 |");
  });

  it("renders none when nothing is active", async () => {
    const tool = createLifecycleCurrentTool({ current: async () => ({ kind: "none" }) });
    const out = await tool.execute({}, {} as never);
    expect(out).toContain("## No active lifecycle");
  });

  it("renders ambiguous with candidates", async () => {
    const tool = createLifecycleCurrentTool({ current: async () => ({ kind: "ambiguous", candidates: [3, 9] }) });
    const out = await tool.execute({}, {} as never);
    expect(out).toContain("## Ambiguous");
    expect(out).toContain("- #3");
    expect(out).toContain("- #9");
  });
});
```

**Verify:** `bun test tests/tools/lifecycle/current.test.ts`
**Commit:** `feat(tools): add lifecycle_current tool`

#### Task 2.8: `lifecycle_resume` tool wrapper
**File:** `src/tools/lifecycle/resume.ts` (new)
**Test:** `tests/tools/lifecycle/resume.test.ts` (new)
**Depends:** 2.6
**Domain:** general

Mirrors `current.ts` but takes one required `issue_number` arg, calls `resolver.resume`, and renders the same one-row table.

```typescript
// src/tools/lifecycle/resume.ts
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { Resolver } from "@/lifecycle/resolver";
import type { LifecycleRecord } from "@/lifecycle/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Reconstruct a local lifecycle record from the GitHub issue body.

Use when starting a new conversation or working on a fresh clone where thoughts/lifecycle/<N>.json is missing.
Hard-errors if the issue does not exist on GitHub or was not created by lifecycle_start_request.`;

const SUCCESS_HEADER = "## Lifecycle resumed";
const FAILURE_HEADER = "## lifecycle_resume failed";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatRecord = (record: LifecycleRecord): string => {
  const row = `| ${record.issueNumber} | \`${record.branch}\` | \`${record.worktree}\` | \`${record.state}\` |`;
  return `${SUCCESS_HEADER}${DOUBLE_LINE_BREAK}${[TABLE_HEADER, TABLE_SEPARATOR, row].join(LINE_BREAK)}`;
};

export type ResumeHandle = Pick<Resolver, "resume">;

export function createLifecycleResumeTool(resolver: ResumeHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number to reconstruct"),
    },
    execute: async ({ issue_number }) => {
      try {
        return formatRecord(await resolver.resume(issue_number));
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
```

Test mirrors `current.test.ts`: success case (returns formatted table), error case (throws → returns failure header with extracted message).

**Verify:** `bun test tests/tools/lifecycle/resume.test.ts`
**Commit:** `feat(tools): add lifecycle_resume tool`

### Batch 2c: wire-up (sequential - 1 implementer)

#### Task 2.9: Register `lifecycle_current` and `lifecycle_resume` with the plugin
**File:** `src/tools/lifecycle/index.ts` AND `src/index.ts`
**Test:** `tests/tools/lifecycle/index.test.ts` (extend the existing one)
**Depends:** 2.7, 2.8
**Domain:** general

`src/tools/lifecycle/index.ts` deltas:

```typescript
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleCurrentTool } from "./current";
import { createLifecycleResumeTool } from "./resume";

export interface LifecycleTools {
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
  readonly lifecycle_current: ToolDefinition;
  readonly lifecycle_resume: ToolDefinition;
}

export function createLifecycleTools(handle: LifecycleHandle, resolver: Resolver): LifecycleTools {
  return {
    lifecycle_start_request: createLifecycleStartRequestTool(handle),
    lifecycle_record_artifact: createLifecycleRecordArtifactTool(handle),
    lifecycle_commit: createLifecycleCommitTool(handle),
    lifecycle_finish: createLifecycleFinishTool(handle),
    lifecycle_current: createLifecycleCurrentTool(resolver),
    lifecycle_resume: createLifecycleResumeTool(resolver),
  };
}
```

`src/index.ts` deltas (around line 374): construct the resolver alongside the handle and pass both into `createLifecycleTools`.

```typescript
import { createResolver } from "@/lifecycle/resolver";
import { createLifecycleStore as createLifecycleJsonStore } from "@/lifecycle/store"; // for resolver
// (the existing import of createLifecycleStore from "@/lifecycle" stays)

const lifecycleHandle = createLifecycleStore({
  runner: createLifecycleRunner(),
  worktreesRoot: dirname(ctx.directory),
  cwd: ctx.directory,
});
const lifecycleResolver = createResolver({
  runner: createLifecycleRunner(),
  store: createLifecycleJsonStore({ baseDir: join(ctx.directory, config.lifecycle.lifecycleDir) }),
  cwd: ctx.directory,
});
const lifecycleTools = createLifecycleTools(lifecycleHandle, lifecycleResolver);
```

Update `tests/tools/lifecycle/index.test.ts` to expect six tool names and to pass a fake resolver. Implementer must update the helper `createHandle` and add `createResolverFake`.

**Verify:** `bun test tests/tools/lifecycle/index.test.ts && bun run check`
**Commit:** `feat(plugin): register lifecycle_current and lifecycle_resume`

---

## Phase 3: Progress as first-class events (parallel within batches)

### Batch 3a: tests first (parallel - 3 implementers)

#### Task 3.1: Test `progress.log()` and `progress.context()`
**File:** `tests/lifecycle/progress.test.ts` (new)
**Test:** itself
**Depends:** none
**Domain:** general

Cover: `log()` resolves issue from explicit input; `log()` falls back to resolver when input omitted; hard errors when resolver returns `none`/`ambiguous`; comment body contains the hidden marker `<!-- micode:lifecycle:progress kind=KIND -->` and a deterministic timestamp from injected `now`; `context()` parses `gh issue view --json body,comments`, filters comments by marker, returns last 10 in chronological order; works with zero progress comments (returns empty `recentProgress`); works without local record (only needs `gh`).

**Verify:** `bun test tests/lifecycle/progress.test.ts` (expect failures; module does not exist)
**Commit:** `test(lifecycle): cover progress.log and progress.context`

#### Task 3.2: Test that auto-emit is best-effort
**File:** `tests/lifecycle/progress-auto-emit.test.ts` (new)
**Test:** itself
**Depends:** none
**Domain:** general

Construct a lifecycle handle with a fake runner whose `gh issue comment` always fails. Call `handle.commit(...)` (or `handle.recordArtifact(...)`) on a record that exists. Assert: the primary outcome (commit SHA, artifact appended) is correct, AND the failure of the progress emit does NOT throw and does NOT roll back the primary op.

```typescript
it("auto-emit failure does not break commit", async () => {
  // runner.gh always fails for "issue comment"; succeeds for everything else
  // ... build handle, run handle.commit, assert sha returned and artifact appended
});
```

**Verify:** `bun test tests/lifecycle/progress-auto-emit.test.ts`
**Commit:** `test(lifecycle): assert auto-emit progress failure is best-effort`

#### Task 3.3: Test the new tool wrappers
**File:** `tests/tools/lifecycle/log-progress.test.ts` (new), `tests/tools/lifecycle/context.test.ts` (new)
**Test:** themselves
**Depends:** none
**Domain:** general

Mirror the shape of `current.test.ts`/`resume.test.ts`. Inject a fake `progress` handle; assert success and failure markdown.

**Verify:** `bun test tests/tools/lifecycle/log-progress.test.ts tests/tools/lifecycle/context.test.ts`
**Commit:** `test(tools): cover lifecycle_log_progress and lifecycle_context`

### Batch 3b: production code (parallel - 4 implementers)

#### Task 3.4: Implement `createProgressLogger`
**File:** `src/lifecycle/progress.ts` (new)
**Test:** `tests/lifecycle/progress.test.ts` (Task 3.1)
**Depends:** 3.1
**Domain:** general

```typescript
import type { LifecycleRunner } from "./runner";
import type { Resolver } from "./resolver";

export const PROGRESS_KINDS = {
  DECISION: "decision",
  BLOCKER: "blocker",
  DISCOVERY: "discovery",
  STATUS: "status",
  HANDOFF: "handoff",
} as const;

export type ProgressKind = (typeof PROGRESS_KINDS)[keyof typeof PROGRESS_KINDS];

const PROGRESS_MARKER_PREFIX = "<!-- micode:lifecycle:progress";
const RECENT_PROGRESS_LIMIT = 10;
const OK_EXIT_CODE = 0;

export interface ProgressInput {
  readonly issueNumber?: number;
  readonly kind: ProgressKind;
  readonly summary: string;
  readonly details?: string;
}

export interface ProgressOutcome {
  readonly issueNumber: number;
  readonly kind: ProgressKind;
  readonly commentUrl: string | null;
}

export interface ProgressEntry {
  readonly kind: ProgressKind;
  readonly summary: string;
  readonly createdAt: string;
  readonly url: string | null;
}

export interface ContextSnapshot {
  readonly issueNumber: number;
  readonly body: string;
  readonly recentProgress: readonly ProgressEntry[];
}

export interface ProgressLoggerDeps {
  readonly runner: LifecycleRunner;
  readonly resolver: Resolver;
  readonly cwd: string;
  readonly now?: () => Date;
}

export interface ProgressLogger {
  readonly log: (input: ProgressInput) => Promise<ProgressOutcome>;
  readonly context: (input?: { issueNumber?: number }) => Promise<ContextSnapshot>;
}

const formatBody = (kind: ProgressKind, summary: string, details: string | undefined, when: Date): string => {
  const isoStamp = when.toISOString();
  const detailsBlock = details ? `\n\n<details>\n${details}\n</details>` : "";
  return `${PROGRESS_MARKER_PREFIX} kind=${kind} at=${isoStamp} -->\n## ${kind.toUpperCase()} — ${isoStamp}\n\n${summary}${detailsBlock}`;
};

const resolveIssueNumber = async (deps: ProgressLoggerDeps, explicit?: number): Promise<number> => {
  if (typeof explicit === "number") return explicit;
  const result = await deps.resolver.current();
  if (result.kind === "resolved") return result.record.issueNumber;
  if (result.kind === "none") {
    throw new Error("no_active_lifecycle: pass issue_number explicitly or run lifecycle_resume first");
  }
  throw new Error(`ambiguous_active_lifecycle: candidates=${result.candidates.join(",")}`);
};

const parseCommentsJson = (stdout: string): { body: string; comments: { body: string; createdAt: string; url: string }[] } => {
  try {
    const raw: unknown = JSON.parse(stdout);
    if (raw && typeof raw === "object") {
      const obj = raw as { body?: unknown; comments?: unknown };
      const body = typeof obj.body === "string" ? obj.body : "";
      const comments = Array.isArray(obj.comments)
        ? obj.comments.flatMap((c) => {
            if (!c || typeof c !== "object") return [];
            const cObj = c as { body?: unknown; createdAt?: unknown; url?: unknown };
            if (typeof cObj.body !== "string") return [];
            return [
              {
                body: cObj.body,
                createdAt: typeof cObj.createdAt === "string" ? cObj.createdAt : "",
                url: typeof cObj.url === "string" ? cObj.url : "",
              },
            ];
          })
        : [];
      return { body, comments };
    }
  } catch {
    // gh older versions emit plain text
  }
  return { body: stdout, comments: [] };
};

const KIND_PATTERN = /kind=([a-z]+)/;

const extractEntry = (
  comment: { body: string; createdAt: string; url: string },
): ProgressEntry | null => {
  if (!comment.body.startsWith(PROGRESS_MARKER_PREFIX)) return null;
  const kindMatch = KIND_PATTERN.exec(comment.body);
  const kind = kindMatch?.[1] as ProgressKind | undefined;
  if (!kind) return null;

  const summaryLine = comment.body.split("\n").find((line) => line.length > 0 && !line.startsWith("<!--") && !line.startsWith("##"));
  return {
    kind,
    summary: summaryLine?.trim() ?? "",
    createdAt: comment.createdAt,
    url: comment.url || null,
  };
};

export function createProgressLogger(deps: ProgressLoggerDeps): ProgressLogger {
  const now = deps.now ?? (() => new Date());

  return {
    async log(input: ProgressInput): Promise<ProgressOutcome> {
      const issueNumber = await resolveIssueNumber(deps, input.issueNumber);
      const body = formatBody(input.kind, input.summary, input.details, now());
      const run = await deps.runner.gh(["issue", "comment", String(issueNumber), "--body", body], { cwd: deps.cwd });
      const url = run.exitCode === OK_EXIT_CODE ? run.stdout.trim() || null : null;
      return { issueNumber, kind: input.kind, commentUrl: url };
    },

    async context(input): Promise<ContextSnapshot> {
      const issueNumber = await resolveIssueNumber(deps, input?.issueNumber);
      const view = await deps.runner.gh(
        ["issue", "view", String(issueNumber), "--json", "body,comments"],
        { cwd: deps.cwd },
      );
      const parsed = parseCommentsJson(view.stdout);
      const entries: ProgressEntry[] = [];
      for (const comment of parsed.comments) {
        const entry = extractEntry(comment);
        if (entry) entries.push(entry);
      }
      const recent = entries.slice(-RECENT_PROGRESS_LIMIT);
      return { issueNumber, body: parsed.body, recentProgress: recent };
    },
  };
}
```

**Verify:** `bun test tests/lifecycle/progress.test.ts`
**Commit:** `feat(lifecycle): add progress logger (log + context)`

#### Task 3.5: Auto-emit progress from existing handle methods
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/progress-auto-emit.test.ts` (Task 3.2)
**Depends:** 3.2, 3.4
**Domain:** general

Inject an optional `progress` dependency into the handle context. Wrap each emit call in `try/catch`; never let progress failures throw out of the primary handle method.

Add to `LifecycleStoreInput`:

```typescript
export interface LifecycleStoreInput {
  readonly runner: LifecycleRunner;
  readonly worktreesRoot: string;
  readonly cwd: string;
  readonly baseDir?: string;
  readonly progress?: { readonly log: (input: { issueNumber: number; kind: "status"; summary: string }) => Promise<unknown> };
}
```

In each of `createStart`, `createArtifactRecorder`, `createCommitter`, `createFinisher`, after the existing happy-path return, before returning, fire-and-forget:

```typescript
const safeEmit = async (issueNumber: number, summary: string): Promise<void> => {
  if (!context.progress) return;
  if (!config.lifecycle.autoEmitProgress) return;
  try {
    await context.progress.log({ issueNumber, kind: "status", summary });
  } catch (error) {
    log.warn("lifecycle.progress", `auto-emit failed: ${extractErrorMessage(error)}`);
  }
};

// inside createStart, after saveAndSync(context, ready):
await safeEmit(ready.issueNumber, `Lifecycle started: branch=${ready.branch}, worktree=${ready.worktree}`);

// inside createArtifactRecorder, after saveAndSync(...):
await safeEmit(issueNumber, `Recorded ${kind}: ${pointer}`);

// inside createCommitter, after saveAndSync(...):
const pushed = outcome.pushed ? "true" : "false";
await safeEmit(issueNumber, `Committed ${outcome.sha ?? "(no-op)"}, pushed=${pushed}`);

// inside createFinisher, after saveAndSync(...):
await safeEmit(issueNumber, `Finished: merged=${outcome.merged}, prUrl=${outcome.prUrl ?? "(none)"}`);
```

Add `autoEmitProgress: true` to `config.lifecycle` in `src/utils/config.ts` (or the equivalent location housing `config.lifecycle`). If that file does not exist by that exact name, the implementer follows the existing `config.lifecycle.autoPush` pattern verbatim.

**Verify:** `bun test tests/lifecycle/progress-auto-emit.test.ts && bun run typecheck`
**Commit:** `feat(lifecycle): auto-emit progress events on start/artifact/commit/finish`

#### Task 3.6: `lifecycle_log_progress` tool wrapper
**File:** `src/tools/lifecycle/log-progress.ts` (new)
**Test:** `tests/tools/lifecycle/log-progress.test.ts` (Task 3.3)
**Depends:** 3.3, 3.4
**Domain:** general

```typescript
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { ProgressLogger } from "@/lifecycle/progress";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Append a progress entry to the active lifecycle issue as a GitHub comment.

kind: decision | blocker | discovery | status | handoff
summary: short one-line summary
details: optional longer detail block (collapsed under <details> in the comment)
issue_number: optional override; when omitted the active lifecycle is resolved from current branch`;

const SUCCESS_HEADER = "## Progress logged";
const FAILURE_HEADER = "## lifecycle_log_progress failed";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const KIND_VALUES = ["decision", "blocker", "discovery", "status", "handoff"] as const;

export type LogProgressHandle = Pick<ProgressLogger, "log">;

export function createLifecycleLogProgressTool(progress: LogProgressHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      kind: tool.schema.string().describe(`One of: ${KIND_VALUES.join(", ")}`),
      summary: tool.schema.string().describe("One-line summary"),
      details: tool.schema.string().optional().describe("Optional longer detail block"),
      issue_number: tool.schema.number().optional().describe("Optional explicit issue number"),
    },
    execute: async (args) => {
      const kind = args.kind as (typeof KIND_VALUES)[number];
      if (!KIND_VALUES.includes(kind)) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}invalid kind: ${args.kind}. Allowed: ${KIND_VALUES.join(", ")}`;
      }
      try {
        const outcome = await progress.log({
          kind,
          summary: args.summary,
          details: args.details,
          issueNumber: args.issue_number,
        });
        return `${SUCCESS_HEADER}${DOUBLE_LINE_BREAK}issue=#${outcome.issueNumber}, kind=${outcome.kind}${outcome.commentUrl ? `, url=${outcome.commentUrl}` : ""}`;
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
```

**Verify:** `bun test tests/tools/lifecycle/log-progress.test.ts`
**Commit:** `feat(tools): add lifecycle_log_progress tool`

#### Task 3.7: `lifecycle_context` tool wrapper
**File:** `src/tools/lifecycle/context.ts` (new)
**Test:** `tests/tools/lifecycle/context.test.ts` (Task 3.3)
**Depends:** 3.3, 3.4
**Domain:** general

```typescript
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { ProgressLogger, ProgressEntry } from "@/lifecycle/progress";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Return the GitHub issue body and the last 10 lifecycle progress comments.

Use this when starting a new conversation to onboard the active lifecycle without re-deriving from chat history.`;

const HEADER = "## Lifecycle context";
const FAILURE_HEADER = "## lifecycle_context failed";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatProgress = (entries: readonly ProgressEntry[]): string => {
  if (entries.length === 0) return "_no progress entries yet_";
  return entries
    .map((e) => `- **${e.kind}** (${e.createdAt || "?"}): ${e.summary}${e.url ? ` — ${e.url}` : ""}`)
    .join(LINE_BREAK);
};

export type ContextHandle = Pick<ProgressLogger, "context">;

export function createLifecycleContextTool(progress: ContextHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().optional().describe("Optional explicit issue number"),
    },
    execute: async (args) => {
      try {
        const snap = await progress.context({ issueNumber: args.issue_number });
        return [
          `${HEADER} (issue #${snap.issueNumber})`,
          "",
          "### Issue body",
          snap.body || "_(empty)_",
          "",
          "### Recent progress",
          formatProgress(snap.recentProgress),
        ].join(LINE_BREAK);
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
```

**Verify:** `bun test tests/tools/lifecycle/context.test.ts`
**Commit:** `feat(tools): add lifecycle_context tool`

### Batch 3c: wire-up (sequential - 1 implementer)

#### Task 3.8: Register progress tools and wire `progress` into the handle
**File:** `src/tools/lifecycle/index.ts` AND `src/index.ts`
**Test:** `tests/tools/lifecycle/index.test.ts` (extend)
**Depends:** 3.6, 3.7
**Domain:** general

Update `LifecycleTools` to add `lifecycle_log_progress` and `lifecycle_context`, threading the `ProgressLogger` instance:

```typescript
export interface LifecycleTools {
  readonly lifecycle_start_request: ToolDefinition;
  readonly lifecycle_record_artifact: ToolDefinition;
  readonly lifecycle_commit: ToolDefinition;
  readonly lifecycle_finish: ToolDefinition;
  readonly lifecycle_current: ToolDefinition;
  readonly lifecycle_resume: ToolDefinition;
  readonly lifecycle_log_progress: ToolDefinition;
  readonly lifecycle_context: ToolDefinition;
}

export function createLifecycleTools(
  handle: LifecycleHandle,
  resolver: Resolver,
  progress: ProgressLogger,
): LifecycleTools { /* ... */ }
```

In `src/index.ts`:

```typescript
const lifecycleProgress = createProgressLogger({
  runner: createLifecycleRunner(),
  resolver: lifecycleResolver,
  cwd: ctx.directory,
});

// And re-create lifecycleHandle with progress:
const lifecycleHandle = createLifecycleStore({
  runner: createLifecycleRunner(),
  worktreesRoot: dirname(ctx.directory),
  cwd: ctx.directory,
  progress: lifecycleProgress,
});

const lifecycleTools = createLifecycleTools(lifecycleHandle, lifecycleResolver, lifecycleProgress);
```

Update `tests/tools/lifecycle/index.test.ts` to expect 8 tool keys and pass fakes for resolver and progress.

**Verify:** `bun test tests/tools/lifecycle/index.test.ts && bun run check`
**Commit:** `feat(plugin): register lifecycle_log_progress and lifecycle_context`

### Batch 3d: agent prompt triggers (parallel - 3 implementers)

#### Task 3.9: Brainstormer progress triggers
**File:** `src/agents/brainstormer.ts`
**Test:** none (prompt content)
**Depends:** none (3.8 must land before runtime restart but prompt edit can ship in parallel)
**Domain:** general

Add a new `<phase name="progress-triggers" priority="HIGH">` block (or extend an existing rules block):

```
<phase name="progress-triggers" priority="HIGH">
  <rule>When the user picks one of multiple proposed approaches, call lifecycle_log_progress(kind=decision, summary="picked X over Y because Z")</rule>
  <rule>Before spawning planner (handoff), call lifecycle_log_progress(kind=handoff, summary="design complete; planner picks up at thoughts/shared/designs/...")</rule>
  <rule>Best-effort: if no active lifecycle, skip the call silently (do not block the design phase)</rule>
</phase>
```

**Verify:** `bun run typecheck`
**Commit:** `feat(brainstormer): add lifecycle progress triggers (decision, handoff)`

#### Task 3.10: Planner progress triggers
**File:** `src/agents/planner.ts`
**Test:** none
**Depends:** none
**Domain:** general

Add similar phase block:

```
<phase name="progress-triggers" priority="HIGH">
  <rule>When a key dependency or constraint is discovered mid-planning, call lifecycle_log_progress(kind=discovery, summary="...")</rule>
  <rule>When the plan is complete, call lifecycle_log_progress(kind=status, summary="plan complete: N batches, M tasks") followed by lifecycle_log_progress(kind=handoff, summary="ready for executor at thoughts/shared/plans/...")</rule>
  <rule>Best-effort: if no active lifecycle, skip silently</rule>
</phase>
```

**Verify:** `bun run typecheck`
**Commit:** `feat(planner): add lifecycle progress triggers (discovery, status, handoff)`

#### Task 3.11: Executor progress triggers
**File:** `src/agents/executor.ts`
**Test:** none
**Depends:** none
**Domain:** general

```
<phase name="progress-triggers" priority="HIGH">
  <rule>When a batch completes (all tasks green), call lifecycle_log_progress(kind=status, summary="batch N complete: T tasks")</rule>
  <rule>When a task is BLOCKED, call lifecycle_log_progress(kind=blocker, summary="task N.M blocked: reason")</rule>
  <rule>When all batches are done and lifecycle_commit has run, call lifecycle_log_progress(kind=handoff, summary="implementation complete; ready for finish")</rule>
  <rule>Best-effort: if no active lifecycle, skip silently</rule>
</phase>
```

**Verify:** `bun run typecheck`
**Commit:** `feat(executor): add lifecycle progress triggers (status, blocker, handoff)`

---

## Wrap-up: quality gate, build, runtime sync, restart block, post-restart smoke

### Task 4.1: Final quality gate, build, dist sync, BLOCK for restart, post-restart validation
**File:** none (operational task)
**Test:** entire suite via `bun run check`; live smoke after user restart
**Depends:** ALL prior tasks (0.1 through 3.11)
**Domain:** general

This task is operational and has FIVE sequential steps. Do NOT run them in parallel.

**Step 1: Quality gate.**

```sh
bun run check
```

Must finish with zero failures. If any check fails, fix in place and re-run before proceeding.

**Step 2: Build.**

```sh
bun run build
```

Must produce `/root/CODE/micode/dist/index.js`. Confirm the file exists and has a recent mtime.

**Step 3: Sync `dist/` to live runtime.**

The runtime path on this server is `/root/.micode/`. `package.json` points `main` and `module` at `dist/index.js`, so we only need to sync `dist/`, nothing else.

```sh
mkdir -p /root/.micode/dist
rsync -a --delete /root/CODE/micode/dist/ /root/.micode/dist/
```

(If `rsync` is unavailable, use `cp -a /root/CODE/micode/dist/. /root/.micode/dist/` after a `rm -rf /root/.micode/dist/*` cleanup.)

Confirm `/root/.micode/dist/index.js` exists and matches the just-built bundle (e.g. `cmp /root/CODE/micode/dist/index.js /root/.micode/dist/index.js` returns 0).

**Step 4: BLOCK for manual OpenCode restart.**

Emit a clear, blunt message to the user and STOP. Do not proceed to Step 5 yourself. Example wording:

> Phase 0-3 complete. Build is synced to `/root/.micode/dist/`. The live OpenCode plugin is still running the old bundle. **Please restart OpenCode manually** so the new lifecycle tools (`lifecycle_current`, `lifecycle_resume`, `lifecycle_log_progress`, `lifecycle_context`) and the Phase 0 fixes load. After you have restarted, run `lifecycle_current` and confirm it resolves to issue #6 from the current branch. I will not auto-restart per `runtime-core.md`.

**Step 5: Post-restart smoke (only after user confirms restart).**

Once the user has restarted OpenCode and asks the agent to validate, the agent calls `lifecycle_current` (no args). Expected output: a markdown table with `## Active lifecycle`, issue `6`, branch matching `issue/6-...` if a worktree is checked out, OR `## No active lifecycle` if work happened on `main` (which is the case this redesign).

If the work happened on `main` (no `issue/6-*` branch), `lifecycle_current` returns `kind: none` (no open lifecycles since #6 will not have a `thoughts/lifecycle/6.json` from the broken `start_request`). To validate the resume path, the agent then runs `lifecycle_resume(6)` which must:

1. Read issue #6's body via `gh`.
2. (Possibly) hard-error with `not_a_lifecycle_issue` because issue #6 was created manually as a tracking issue, not by `lifecycle_start_request`. **This is the correct, expected behaviour and it validates the resolver's hard-error path.**

If `lifecycle_resume(6)` returns `not_a_lifecycle_issue`, document this in the wrap-up commit message. The validation goal is "the new tools load and execute correctly," not "the running session is itself a fully-resumed lifecycle."

The agent then runs `lifecycle_log_progress(kind=status, summary="redesign Phase 0-3 shipped", issue_number=6)` to post a final status comment to issue #6. This is the user's chosen end-state-marker for the manual workflow.

**Verify:** `bun run check` exit 0, `bun run build` produces `dist/index.js`, `cmp` of dist files returns 0, user-confirmed restart, `lifecycle_current` and `lifecycle_resume(6)` execute without crashing.

**Commit:** `chore(lifecycle): wrap-up Phase 0-3, sync dist runtime, validate post-restart`

(Also: this is the single push the user agreed to. After the wrap-up commit, the agent runs `git push origin main` per the user's prior agreement. Per `AGENTS.md` repository-ownership pre-flight rules, the agent first verifies `origin` points to `Wuxie233/micode` (fork) before pushing. If it points to upstream `vtemian/micode`, the agent STOPS and asks.)

---

## Backwards-compatibility notes

- **FlyBuild record (`thoughts/lifecycle/34.json`)** continues to load: no schema changes; `LifecycleRecordSchema` accepts the existing shape unchanged. The new `progress` dependency on the handle is optional; old records without progress comments work with `lifecycle_context` (returns empty `recentProgress`).
- **`store.list()` is unchanged.** `listOpen()` is added; existing callers do not need to switch.
- **`runner.gh` signature change is additive:** the new `options` parameter is optional. Callers that pass no options keep working.
- **`STAGE_ARGS` change** is observable: any developer relying on `git add --update` semantics in a lifecycle commit must update their mental model. This is documented in the commit message and the design doc.
- **Auto-emit kill switch:** `config.lifecycle.autoEmitProgress` defaults `true`. Set to `false` if a downstream environment makes `gh issue comment` flaky.

## Test invariants

- `bun run check` must pass after every batch.
- No new floating promises, no `any`, no `as` assertions outside Valibot-narrowed boundaries.
- All new files have named exports, no defaults.
- All new tests use `bun:test` (`describe`, `it`, `expect`) and clean up `/tmp` paths in `afterEach`.

