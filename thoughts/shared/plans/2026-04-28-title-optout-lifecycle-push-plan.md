---
date: 2026-04-28
topic: "Fix conversation-title opt-out false positive and lifecycle_commit upstream push"
issue: 8
scope: lifecycle
contract: none
---

# Title Opt-out & Lifecycle Push Implementation Plan

**Goal:** Fix two workflow bugs: (1) conversation-title hook treating an OpenCode automatic initial title as a user-authored opt-out, and (2) `lifecycle_commit` first push failing because upstream tracking is not set on the issue branch.

**Architecture:** Two narrow fixes inside existing modules. Part A introduces a "system title confirmation" gate inside `src/utils/conversation-title/state.ts` so that opt-out only fires after micode has observed its own write reflected back. Part B threads the lifecycle record's `branch` into `commitAndPush` and switches the push command to `git push --set-upstream origin <branch>`. No public API surface changes.

**Design:** [thoughts/shared/designs/2026-04-28-title-optout-lifecycle-push-design.md](../designs/2026-04-28-title-optout-lifecycle-push-design.md)

**Contract:** none (single-process internal fix, no cross-domain interface)

---

## Scope Boundaries

In scope:
- Title state registry: distinguish "pending" vs "confirmed" system titles to avoid early-race opt-out.
- Title hook: keep existing flow; the registry change is invisible to the hook.
- `commitAndPush`: accept and use the issue branch; switch to explicit `--set-upstream origin <branch>` on push.
- Lifecycle committer wiring: pass `record.branch` into the commit input.
- Tests for both changes; preserve existing retained-commit behavior on push failures.

Out of scope:
- Title source classifier rules (no string heuristics for "OpenCode auto title").
- Lifecycle pre-flight, finish, or worktree paths.
- Any host Git config (`push.autoSetupRemote`, etc.).
- Conversation-title hook handler shape, registration, or hook config.

---

## Gap-Fill Decisions (confirmed by senior judgment)

These are choices the design left implicit; documenting them so the executor does not stall.

1. **"System title confirmation" mechanism.** The state record gains two fields: `pendingTitle: string | null` (set whenever decide() returns a write) and `systemTitleConfirmed: boolean` (set true the first time a subsequent decide() call's `currentTitle` equals `pendingTitle`). Opt-out triggers only when `systemTitleConfirmed === true` AND `currentTitle !== lastTitle` AND `currentTitle` is non-empty.
2. **Empty-title handling.** A `currentTitle` of `null` or `""` never triggers opt-out (existing behavior preserved via `isUserAuthoredTitle`).
3. **Already-opted-out wins.** If `record.optedOut === true`, we keep returning `skip("opted-out")` regardless of confirmation state. No "un-opt-out" path.
4. **Confirmation is observation-only.** Reading `currentTitle === pendingTitle` flips `systemTitleConfirmed` to true even when the decision ends up being throttled or done-frozen. Confirmation is independent of whether we write again.
5. **Push args ordering.** Use `["push", "--set-upstream", "origin", <branch>]` on every push when a branch is provided. Both the first push and the retry use the same args. Setting upstream on a branch that already has upstream is a no-op in Git, so the retry stays safe.
6. **Branch threading.** `CommitAndPushInput` gains `readonly branch: string`. Lifecycle committer at `src/lifecycle/index.ts:524-531` passes `branch: record.branch`. Tests construct inputs with the branch field.
7. **Backward compatibility for `commitAndPush`.** No callers outside lifecycle; `branch` is required, not optional. This forces the call site to be explicit, which is the design's intent.
8. **Test runner shape.** Existing `tests/lifecycle/commits.test.ts` already uses a `FakeRunner` with call capture. We extend the same pattern; no spies on implementation.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2 [implementation - depends on batch 1]
Batch 3 (sequential): 3.1 [integration - depends on batch 2]
```

Batch 1 lands the failing tests for both fixes (TDD red).
Batch 2 implements the two production changes against those tests (TDD green).
Batch 3 wires the lifecycle committer to the new `commitAndPush` signature and updates the existing commits test fixture.

---

## Batch 1: Failing Tests (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Title state registry tests for system-confirmation gate
**File:** `tests/utils/conversation-title/state.test.ts`
**Test:** same file (this IS the test file)
**Depends:** none
**Domain:** general

Append two new `it(...)` blocks to the existing `describe("title state registry", ...)` block. Do NOT modify existing tests.

```typescript
// Add at the end of the existing describe block, before the closing `});`

  it("does not opt out when an early host title differs before system title is confirmed", () => {
    const registry = createTitleStateRegistry();
    const HOST_AUTO_TITLE = "New Conversation";

    // First decide: registry writes a system title. lastTitle gets set.
    const first = decide(registry);
    const systemTitle = writtenTitle(first);

    // Before micode ever observes its own title back, an OpenCode automatic
    // initial title shows up as currentTitle. This must NOT be treated as a
    // user opt-out: the system title has not been confirmed yet.
    const earlyMismatch = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: HOST_AUTO_TITLE,
      now: NEXT_NOW,
    });

    expect(earlyMismatch.kind).toBe("write");
    expect(registry.isOptedOut(SESSION)).toBe(false);
    // Sanity: the previously written systemTitle exists; we just didn't see it
    // yet on the read path.
    expect(systemTitle.length).toBeGreaterThan(0);
  });

  it("opts out when a mismatch happens after the system title has been confirmed", () => {
    const registry = createTitleStateRegistry();
    const first = decide(registry);
    const systemTitle = writtenTitle(first);

    // A later decision observes the previously-written system title back.
    // This confirms that micode's writes are being read back. Throttled is OK;
    // confirmation should still happen.
    const confirmed = decide(registry, {
      currentTitle: systemTitle,
      now: THROTTLED_NOW,
    });
    expect(skippedReason(confirmed)).toBe("throttled");
    expect(registry.isOptedOut(SESSION)).toBe(false);

    // Now a mismatch arrives. Because the system title was confirmed at least
    // once, this is a real user edit and must opt out.
    const userEdit = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: MANUAL_TITLE,
      now: NEXT_NOW,
    });
    expect(skippedReason(userEdit)).toBe("opted-out");
    expect(registry.isOptedOut(SESSION)).toBe(true);
  });
```

**Verify (red):** `bun test tests/utils/conversation-title/state.test.ts` — the two new tests must FAIL with the current `state.ts` (the early-mismatch case will currently opt out because confirmation gate does not exist).
**Commit:** `test(conversation-title): add system-title confirmation gate tests`

---

### Task 1.2: commitAndPush tests for explicit upstream push
**File:** `tests/lifecycle/commits.test.ts`
**Test:** same file (this IS the test file)
**Depends:** none
**Domain:** backend

Modify the file to (a) add a `BRANCH` constant and `branch: BRANCH` field on the `INPUT` fixture, (b) update the `PUSH_ARGS` constant and ALL existing assertions that compare against `PUSH_ARGS`, (c) add one new test for the upstream-set behavior on first push.

Replace the constants block at the top of the file (lines roughly 7-19) so it reads:

```typescript
const CWD = "/workspace/micode";
const ISSUE_NUMBER = 42;
const BRANCH = "issue/42-add-commit-flow";
const SHA = "abc123def456";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const CLEAN_OUTPUT = "On branch issue/42\nnothing to commit, working tree clean\n";
const PUSH_FAILURE = "remote rejected push";
const MESSAGE = "feat(lifecycle): add commit flow (#42)";
const STAGE_ARGS = ["add", "--all"] as const;
const COMMIT_ARGS = ["commit", "-m", MESSAGE] as const;
const SHA_ARGS = ["rev-parse", "HEAD"] as const;
const PUSH_ARGS = ["push", "--set-upstream", "origin", BRANCH] as const;
```

Update the `INPUT` fixture (lines roughly 30-37) to:

```typescript
const INPUT: CommitAndPushInput = {
  cwd: CWD,
  issueNumber: ISSUE_NUMBER,
  branch: BRANCH,
  type: "feat",
  scope: "lifecycle",
  summary: "add commit flow",
  push: true,
};
```

The existing tests `it("commits and pushes changes", ...)`, `it("retries push once after a failure", ...)`, and `it("keeps the local commit when push retry fails", ...)` already compare against `PUSH_ARGS`; with the constant updated, those assertions now require the new explicit args. No further changes to those test bodies are needed.

Add one NEW test inside the same `describe("commitAndPush", ...)` block, after the existing tests, before the closing `});`:

```typescript
  it("pushes with explicit origin and --set-upstream on first push", async () => {
    const runner = createRunner([createRun(), createRun(), createRun(`${SHA}\n`), createRun()]);

    const outcome = await commitAndPush(runner, INPUT);

    expect(outcome.committed).toBe(true);
    expect(outcome.pushed).toBe(true);
    const pushCalls = runner.calls.filter((c) => c.args[0] === "push");
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]).toEqual({
      args: ["push", "--set-upstream", "origin", BRANCH],
      cwd: CWD,
    });
  });
```

**Verify (red):** `bun test tests/lifecycle/commits.test.ts` — all tests that reference `PUSH_ARGS` plus the new explicit-upstream test must FAIL against the current `commits.ts` (which still pushes with bare `["push"]` and has no `branch` field on the input).
**Commit:** `test(lifecycle): assert explicit upstream push on commitAndPush`

---

## Batch 2: Production Implementation (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing (the new tests must exist and fail).
Tasks: 2.1, 2.2

### Task 2.1: Add system-title confirmation gate to title state registry
**File:** `src/utils/conversation-title/state.ts`
**Test:** `tests/utils/conversation-title/state.test.ts` (extended in Task 1.1; existing scenario test in `tests/hooks/conversation-title.scenario.test.ts` must continue to pass)
**Depends:** 1.1 (tests must exist first)
**Domain:** general

The change is limited to `SessionRecord`, `newRecord`, and `decideForRecord`. Public API (`TitleStateRegistry`, `DecisionInput`, `TitleDecision`) does not change.

```typescript
// src/utils/conversation-title/state.ts
import { buildTopicTitle, CONCLUSIVE_STATUSES, type TitleStatus } from "./format";
import { compareConfidence, type TitleSource } from "./source";

const TITLE_THROTTLE_MS = 1000;
const DONE_FREEZE_MS = 60_000;

export const DECISION_KIND = {
  WRITE: "write",
  SKIP: "skip",
} as const;

export type DecisionKind = (typeof DECISION_KIND)[keyof typeof DECISION_KIND];

export interface DecisionInput {
  readonly sessionID: string;
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
  readonly currentTitle: string | null;
  readonly now: number;
  readonly maxLength?: number;
}

export interface SessionTopic {
  readonly topic: string | null;
  readonly source: TitleSource | null;
}

export type TitleDecision =
  | { readonly kind: typeof DECISION_KIND.WRITE; readonly title: string }
  | { readonly kind: typeof DECISION_KIND.SKIP; readonly reason: string };

interface SessionRecord {
  lastTitle: string | null;
  lastUpdateAt: number;
  doneAt: number | null;
  optedOut: boolean;
  systemTitleConfirmed: boolean;
  topic: string | null;
  topicSource: TitleSource | null;
}

export interface TitleStateRegistry {
  decide(input: DecisionInput): TitleDecision;
  getTopic(sessionID: string): SessionTopic;
  forget(sessionID: string): void;
  isOptedOut(sessionID: string): boolean;
  size(): number;
}

const skip = (reason: string): TitleDecision => ({ kind: DECISION_KIND.SKIP, reason });

const isUserAuthoredTitle = (current: string | null, lastWritten: string | null): boolean => {
  if (current === null || current === "") return false;
  if (lastWritten === null) return true;
  return current !== lastWritten;
};

const observeCurrentTitle = (record: SessionRecord, current: string | null): void => {
  if (record.systemTitleConfirmed) return;
  if (record.lastTitle === null) return;
  if (current === null || current === "") return;
  if (current === record.lastTitle) {
    record.systemTitleConfirmed = true;
  }
};

const detectOptOut = (record: SessionRecord, current: string | null): boolean => {
  if (record.optedOut) return true;
  if (record.lastTitle === null) return false;
  if (!record.systemTitleConfirmed) return false;
  return isUserAuthoredTitle(current, record.lastTitle);
};

const isDoneFrozen = (record: SessionRecord, now: number): boolean => {
  if (record.doneAt === null) return false;
  return now - record.doneAt < DONE_FREEZE_MS;
};

const isThrottled = (record: SessionRecord, candidate: string, now: number): boolean => {
  if (record.lastTitle !== candidate) return false;
  return now - record.lastUpdateAt < TITLE_THROTTLE_MS;
};

const canReplaceTopic = (record: SessionRecord, source: TitleSource, allowEqualConfidence: boolean): boolean => {
  if (record.topic === null) return true;
  if (record.topicSource === null) return true;
  const confidence = compareConfidence(source, record.topicSource);
  if (confidence > 0) return true;
  return allowEqualConfidence && confidence === 0;
};

const applyTopic = (record: SessionRecord, input: DecisionInput, allowEqualConfidence: boolean): boolean => {
  const incomingTopic = input.summary;
  if (incomingTopic === null || incomingTopic === "") return false;
  if (!canReplaceTopic(record, input.source, allowEqualConfidence)) return false;
  record.topic = incomingTopic;
  record.topicSource = input.source;
  return true;
};

const isDoneExpired = (record: SessionRecord, now: number): boolean => {
  if (record.doneAt === null) return false;
  return now - record.doneAt >= DONE_FREEZE_MS;
};

const updateDoneAt = (record: SessionRecord, status: TitleStatus, now: number, replacedTopic: boolean): void => {
  if (CONCLUSIVE_STATUSES.includes(status)) {
    record.doneAt = now;
    return;
  }
  if (replacedTopic && isDoneExpired(record, now)) record.doneAt = null;
};

const updateRecord = (
  record: SessionRecord,
  title: string,
  status: TitleStatus,
  now: number,
  replacedTopic: boolean,
): void => {
  record.lastTitle = title;
  record.lastUpdateAt = now;
  updateDoneAt(record, status, now, replacedTopic);
};

const newRecord = (): SessionRecord => ({
  lastTitle: null,
  lastUpdateAt: 0,
  doneAt: null,
  optedOut: false,
  systemTitleConfirmed: false,
  topic: null,
  topicSource: null,
});

const readTopic = (record: SessionRecord | undefined): SessionTopic => ({
  topic: record?.topic ?? null,
  source: record?.topicSource ?? null,
});

const getOrCreate = (records: Map<string, SessionRecord>, sessionID: string): SessionRecord => {
  let record = records.get(sessionID);
  if (!record) {
    record = newRecord();
    records.set(sessionID, record);
  }
  return record;
};

const decideForRecord = (record: SessionRecord, input: DecisionInput): TitleDecision => {
  observeCurrentTitle(record, input.currentTitle);

  if (detectOptOut(record, input.currentTitle)) {
    record.optedOut = true;
    return skip("opted-out");
  }

  if (isDoneFrozen(record, input.now)) {
    return skip("done-frozen");
  }

  const doneExpired = isDoneExpired(record, input.now);
  const replacedTopic = applyTopic(record, input, doneExpired);
  const title = buildTopicTitle({ topic: record.topic ?? "", status: input.status }, input.maxLength);

  if (isThrottled(record, title, input.now)) {
    return skip("throttled");
  }

  updateRecord(record, title, input.status, input.now, replacedTopic);
  return { kind: DECISION_KIND.WRITE, title };
};

export function createTitleStateRegistry(): TitleStateRegistry {
  const records = new Map<string, SessionRecord>();

  return {
    decide(input) {
      return decideForRecord(getOrCreate(records, input.sessionID), input);
    },

    getTopic(sessionID) {
      return readTopic(records.get(sessionID));
    },

    forget(sessionID) {
      records.delete(sessionID);
    },

    isOptedOut(sessionID) {
      return records.get(sessionID)?.optedOut ?? false;
    },

    size() {
      return records.size;
    },
  };
}
```

Why this satisfies the design:

- `observeCurrentTitle` is the "system title confirmation" channel. It only flips `systemTitleConfirmed` to true when `currentTitle` equals the previously-written `lastTitle`. Until that observation, mismatches are not user edits.
- `detectOptOut` now requires `systemTitleConfirmed === true` before treating a mismatch as a user opt-out. Once `optedOut === true`, the early-return preserves the existing "opted-out is sticky" behavior.
- All other decision paths (throttle, done-frozen, topic confidence) are unchanged.
- The existing `tests/utils/conversation-title/state.test.ts` test "opts out of further writes when the user manually edits the title" passes a `currentTitle: MANUAL_TITLE` AFTER a successful first write; the second decide observes `MANUAL_TITLE !== lastTitle`, but confirmation has not happened — so under the new rule it would NOT opt out. This is a behavior change required by the design. The Task 1.1 replacement test "opts out when a mismatch happens after the system title has been confirmed" replaces it semantically. The original test must be removed in this task.

Replace the original "opts out of further writes when the user manually edits the title" test in `tests/utils/conversation-title/state.test.ts` (lines roughly 211-233) with the Task 1.1 confirmed-then-mismatch test. Effectively, Task 1.1 adds two new tests; this task DELETES the old strict opt-out test that would now contradict the design.

**Verify (green):** `bun test tests/utils/conversation-title/state.test.ts tests/hooks/conversation-title.scenario.test.ts tests/hooks/conversation-title.test.ts` — all pass.
**Commit:** `fix(conversation-title): gate opt-out on system title confirmation`

---

### Task 2.2: Push with explicit origin and upstream tracking
**File:** `src/lifecycle/commits.ts`
**Test:** `tests/lifecycle/commits.test.ts` (extended in Task 1.2)
**Depends:** 1.2 (tests must exist first)
**Domain:** backend

Add `branch` to `CommitAndPushInput` and switch `PUSH_ARGS` to a function that produces explicit args.

```typescript
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

import { buildLifecycleCommitMessage, type CommitMessageInput } from "./commit-message";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CommitOutcome } from "./types";

export interface CommitAndPushInput {
  readonly cwd: string;
  readonly issueNumber: number;
  readonly branch: string;
  readonly type: CommitMessageInput["type"];
  readonly scope: string;
  readonly summary: string;
  readonly push: boolean;
}

const SUCCESS_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const NOTHING_TO_COMMIT_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const NOTHING_TO_COMMIT_PATTERN = /nothing to commit/i;
const STAGE_ARGS = ["add", "--all"] as const;
const SHA_ARGS = ["rev-parse", "HEAD"] as const;
const COMMIT_COMMAND = "commit";
const MESSAGE_FLAG = "-m";
const PUSH_COMMAND = "push";
const SET_UPSTREAM_FLAG = "--set-upstream";
const ORIGIN_REMOTE = "origin";
const STAGING_FAILED_NOTE = "Staging failed";
const COMMIT_FAILED_NOTE = "Commit failed";
const SHA_FAILED_NOTE = "Commit SHA lookup failed";
const PUSH_FAILED_NOTE = "Push failed after retry";

const buildPushArgs = (branch: string): readonly string[] => [PUSH_COMMAND, SET_UPSTREAM_FLAG, ORIGIN_REMOTE, branch];

const uncommittedOutcome = (): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note: null,
});

const failureOutcome = (note: string): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note,
});

const completedOutcome = (sha: string, pushed: boolean, retried: boolean): CommitOutcome => ({
  committed: true,
  sha,
  pushed,
  retried,
  note: null,
});

const retainedOutcome = (sha: string | null, retried: boolean, note: string): CommitOutcome => ({
  committed: true,
  sha,
  pushed: false,
  retried,
  note,
});

const succeeded = (run: RunResult): boolean => run.exitCode === SUCCESS_EXIT_CODE;

const output = (run: RunResult): string => `${run.stdout}\n${run.stderr}`.trim();

const noteFor = (prefix: string, run: RunResult): string => {
  const message = output(run);
  if (message.length === 0) return prefix;
  return `${prefix}: ${message}`;
};

const isNothingToCommit = (run: RunResult): boolean => {
  return run.exitCode === NOTHING_TO_COMMIT_EXIT_CODE && NOTHING_TO_COMMIT_PATTERN.test(output(run));
};

const runGit = async (runner: LifecycleRunner, args: readonly string[], cwd: string): Promise<RunResult> => {
  try {
    return await runner.git(args, { cwd });
  } catch (error) {
    return { stdout: EMPTY_OUTPUT, stderr: extractErrorMessage(error), exitCode: FAILURE_EXIT_CODE };
  }
};

const readSha = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const run = await runGit(runner, SHA_ARGS, cwd);
  if (!succeeded(run)) return null;

  const sha = run.stdout.trim();
  if (sha.length === 0) return null;
  return sha;
};

const pushWithRetry = async (
  runner: LifecycleRunner,
  cwd: string,
  branch: string,
  sha: string,
): Promise<CommitOutcome> => {
  const pushArgs = buildPushArgs(branch);
  const pushed = await runGit(runner, pushArgs, cwd);
  if (succeeded(pushed)) return completedOutcome(sha, true, false);

  await Bun.sleep(config.lifecycle.pushRetryBackoffMs);

  const retried = await runGit(runner, pushArgs, cwd);
  if (succeeded(retried)) return completedOutcome(sha, true, true);
  return retainedOutcome(sha, true, noteFor(PUSH_FAILED_NOTE, retried));
};

export async function commitAndPush(runner: LifecycleRunner, input: CommitAndPushInput): Promise<CommitOutcome> {
  let message: string;
  try {
    message = buildLifecycleCommitMessage(input);
  } catch (error) {
    return failureOutcome(extractErrorMessage(error));
  }

  const staged = await runGit(runner, STAGE_ARGS, input.cwd);
  if (!succeeded(staged)) return failureOutcome(noteFor(STAGING_FAILED_NOTE, staged));

  const committed = await runGit(runner, [COMMIT_COMMAND, MESSAGE_FLAG, message], input.cwd);
  if (isNothingToCommit(committed)) return uncommittedOutcome();
  if (!succeeded(committed)) return failureOutcome(noteFor(COMMIT_FAILED_NOTE, committed));

  const sha = await readSha(runner, input.cwd);
  if (sha === null) return retainedOutcome(null, false, SHA_FAILED_NOTE);
  if (!input.push) return completedOutcome(sha, false, false);
  return pushWithRetry(runner, input.cwd, input.branch, sha);
}
```

Why this satisfies the design:

- The push command is now `git push --set-upstream origin <branch>` on EVERY push (first try and retry). This sets upstream tracking on the first push, which is the bug fix; on subsequent pushes the flag is a no-op because upstream is already set.
- The branch comes from the lifecycle record (Task 3.1 wires it), so we never ask Git to infer the branch from local config or upstream.
- All existing outcome shapes (`completedOutcome`, `retainedOutcome`, `failureOutcome`, `uncommittedOutcome`) and notes are preserved; push-failure tests continue to assert the same structure.

**Verify (green):** `bun test tests/lifecycle/commits.test.ts` — all tests pass, including the new explicit-upstream test from Task 1.2 and the existing retain-on-failure tests.
**Commit:** `fix(lifecycle): push with explicit origin and upstream tracking`

---

## Batch 3: Wiring & Existing Test Fixture Update (sequential - 1 implementer)

Depends on Batch 2.
Tasks: 3.1

### Task 3.1: Wire lifecycle committer to pass branch through
**File:** `src/lifecycle/index.ts`
**Test:** none directly (covered by Task 1.2 and existing `tests/lifecycle/index.test.ts`)
**Depends:** 2.2
**Domain:** backend

Modify the `createCommitter` function (around lines 521-537) to pass `branch: record.branch` into the `commitAndPush` call. This is the only change in this file.

Locate this block:

```typescript
const createCommitter = (context: LifecycleContext): LifecycleHandle["commit"] => {
  return async (issueNumber, commitInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const outcome = await commitAndPush(context.runner, {
      cwd: record.worktree,
      issueNumber,
      type: DEFAULT_COMMIT_TYPE,
      scope: commitInput.scope,
      summary: commitInput.summary,
      push: commitInput.push,
    });
    await saveAndSync(context, applyCommitOutcome(record, outcome));
    const pushed = outcome.pushed ? "true" : "false";
    await safeEmit(context, issueNumber, `Committed ${outcome.sha ?? "(no-op)"}, pushed=${pushed}`);
    return outcome;
  };
};
```

Replace it with:

```typescript
const createCommitter = (context: LifecycleContext): LifecycleHandle["commit"] => {
  return async (issueNumber, commitInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const outcome = await commitAndPush(context.runner, {
      cwd: record.worktree,
      issueNumber,
      branch: record.branch,
      type: DEFAULT_COMMIT_TYPE,
      scope: commitInput.scope,
      summary: commitInput.summary,
      push: commitInput.push,
    });
    await saveAndSync(context, applyCommitOutcome(record, outcome));
    const pushed = outcome.pushed ? "true" : "false";
    await safeEmit(context, issueNumber, `Committed ${outcome.sha ?? "(no-op)"}, pushed=${pushed}`);
    return outcome;
  };
};
```

Why this satisfies the design:

- The lifecycle record already owns branch identity (`record.branch`, set during `lifecycle_start_request` via `branchFor(...)`). Threading that into `commitAndPush` makes the push deterministic and removes the dependency on Git's branch-inference behavior.
- No change to `LifecycleHandle["commit"]` public signature. Callers of the lifecycle handle do not change.

After this task, run the full quality gate:

**Verify (full):**
```
bun test tests/utils/conversation-title/state.test.ts
bun test tests/hooks/conversation-title.test.ts
bun test tests/hooks/conversation-title.scenario.test.ts
bun test tests/lifecycle/commits.test.ts
bun test tests/lifecycle/index.test.ts
bun run check
```
All must pass.

**Commit:** `fix(lifecycle): thread issue branch into commitAndPush`
