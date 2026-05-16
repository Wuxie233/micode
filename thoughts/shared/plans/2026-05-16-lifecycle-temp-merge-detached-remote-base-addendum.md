---
date: 2026-05-16
topic: "lifecycle-temp-merge-detached-remote-base-addendum"
issue: 85
scope: lifecycle
contract: none
---

# Issue #85 Addendum: Detached Remote Base Temp Merge Worktree

**Goal:** Fix the finish-time blocker where `lifecycle_finish(issue #85, local-merge)` cannot create a temp merge worktree when local `main` is already checked out elsewhere.

**Architecture:** Keep local-merge semantics but move temp base creation away from the checked-out local branch. The temp merge worktree is created from freshly fetched `origin/<baseBranch>` in detached mode, issue branch is no-ff merged into that detached remote base, then the resulting `HEAD` is pushed to `origin <baseBranch>` with a non-force refspec.

**Design:** Addendum to `/root/CODE/issue-85-lifecycle/thoughts/shared/designs/2026-05-16-lifecycle-conflict-resolver-response-ux-design.md` and existing plan `/root/CODE/issue-85-lifecycle/thoughts/shared/plans/2026-05-16-lifecycle-conflict-resolver-response-ux.md`.

**Contract:** none — lifecycle internal Git workflow only.

**Reviewer coverage:** mandatory for every task. This touches lifecycle finish safety and Git command sequencing; no reviewer skip.

---

## 行为承诺映射

| Blocker / Behavior | Covered by tasks | Reviewer policy |
| --- | --- | --- |
| `git worktree add <tmp> main` must not fail just because local `main` is already checked out | 1.1, 2.1, 3.1 | mandatory: finish-time blocker |
| Temp merge worktree represents latest `origin/<baseBranch>` before merging issue branch | 1.1, 2.1 | mandatory: local-merge contract |
| Push remains non-force and does not use reset hard, no-verify, deletion, or restart | 2.1, 3.1, 3.2 | mandatory: hard safety |
| Existing local merge cleanup/conflict behavior remains intact | 2.1, 3.1, 3.2 | mandatory: regression surface |

---

## Dependency Graph

```
Batch 1 (parallel): 1.1 [foundation helper - no deps]
Batch 2 (parallel): 2.1 [core local-merge integration - depends on 1.1]
Batch 3 (parallel): 3.1, 3.2 [test expectation alignment and safety regression - depends on 2.1]
```

---

## Batch 1: Foundation Helper (parallel - 1 implementer)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1

### Task 1.1: Detached Remote Base Worktree Helper
**File:** `src/lifecycle/recovery/temp-worktree.ts`
**Test:** `tests/lifecycle/recovery/temp-worktree.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "@/lifecycle/recovery/temp-worktree";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
}

const recorder = (results: readonly RunResult[]): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  let i = 0;
  const runner: LifecycleRunner = {
    git: async (args) => {
      calls.push({ bin: "git", args });
      const r = results[i] ?? ok();
      i += 1;
      return r;
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      return ok();
    },
  };
  return { runner, calls };
};

describe("computeTempWorktreePath", () => {
  it("uses /tmp/<repo>-merge-issue-<N> shape", () => {
    const path = computeTempWorktreePath({ repoRoot: "/home/user/CODE/micode", issueNumber: 67, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/micode-merge-issue-67");
  });

  it("falls back to repo basename when path has trailing slash", () => {
    const path = computeTempWorktreePath({ repoRoot: "/x/y/repo/", issueNumber: 5, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/repo-merge-issue-5");
  });
});

describe("createTempMergeWorktree", () => {
  it("fetches remote base then creates a detached worktree from origin/base", async () => {
    const { runner, calls } = recorder([ok(), ok()]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });

    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("type narrow");
    expect(result.path).toBe("/tmp/micode-merge-issue-67");
    expect(calls.map((call) => call.args)).toEqual([
      ["fetch", "origin", "main"],
      ["worktree", "add", "--detach", "/tmp/micode-merge-issue-67", "origin/main"],
    ]);
  });

  it("does not pass the short local base branch to git worktree add", async () => {
    const { runner, calls } = recorder([ok(), ok()]);
    await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });

    const add = calls.find((call) => call.args[0] === "worktree" && call.args[1] === "add");
    expect(add?.args).not.toEqual(["worktree", "add", "/tmp/micode-merge-issue-67", "main"]);
    expect(add?.args).toContain("--detach");
    expect(add?.args.at(-1)).toBe("origin/main");
  });

  it("returns failed when fetch of remote base fails", async () => {
    const { runner, calls } = recorder([fail("could not fetch origin/main")]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") throw new Error("type narrow");
    expect(result.reason).toContain("could not fetch origin/main");
    expect(calls.map((call) => call.args.join(" "))).not.toContain("worktree add --detach /tmp/micode-merge-issue-67 origin/main");
  });

  it("returns failed when detached git worktree add fails", async () => {
    const { runner } = recorder([ok(), fail("path exists")]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("failed");
  });
});

describe("readMergeConflicts", () => {
  it("returns conflict files from git status --porcelain UU/AA/DD lines", async () => {
    const { runner } = recorder([ok("UU src/a.ts\nAA src/b.ts\n M src/c.ts\nDD src/d.ts\n?? untracked.ts\n")]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/d.ts"]);
  });

  it("returns empty list when git status fails (caller decides what to do)", async () => {
    const { runner } = recorder([fail()]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual([]);
  });
});

describe("removeTempMergeWorktree", () => {
  it("issues `git worktree remove --force <path>` from repo root", async () => {
    const { runner, calls } = recorder([ok()]);
    await removeTempMergeWorktree(runner, { repoRoot: "/r/micode", path: "/tmp/micode-merge-issue-67" });
    expect(calls[0]?.args).toEqual(["worktree", "remove", "--force", "/tmp/micode-merge-issue-67"]);
  });
});
```

```typescript
import { basename } from "node:path";

import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

export interface TempWorktreePathInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly tmpDir: string;
}

export function computeTempWorktreePath(input: TempWorktreePathInput): string {
  const stripped = input.repoRoot.replace(/\/+$/, "");
  const repo = basename(stripped);
  return `${input.tmpDir.replace(/\/+$/, "")}/${repo}-merge-issue-${input.issueNumber}`;
}

export interface CreateTempInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly tmpDir: string;
}

export type CreateTempResult =
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly reason: string };

const OK = 0;
const GIT_STATUS_PATH_OFFSET = 3;
const CONFLICT_PREFIXES: readonly string[] = ["UU", "AA", "DD", "AU", "UA", "DU", "UD"];

const formatFailure = (result: RunResult): string => `${result.stderr}\n${result.stdout}`.trim();

export async function createTempMergeWorktree(
  runner: LifecycleRunner,
  input: CreateTempInput,
): Promise<CreateTempResult> {
  const path = computeTempWorktreePath({
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    tmpDir: input.tmpDir,
  });

  const fetch = await runner.git(["fetch", "origin", input.baseBranch], { cwd: input.repoRoot });
  if (fetch.exitCode !== OK) return { kind: "failed", path, reason: formatFailure(fetch) };

  const remoteBaseRef = `origin/${input.baseBranch}`;
  const result = await runner.git(["worktree", "add", "--detach", path, remoteBaseRef], { cwd: input.repoRoot });
  if (result.exitCode === OK) return { kind: "created", path };
  return { kind: "failed", path, reason: formatFailure(result) };
}

export async function readMergeConflicts(runner: LifecycleRunner, worktreePath: string): Promise<readonly string[]> {
  const status = await runner.git(["status", "--porcelain"], { cwd: worktreePath });
  if (status.exitCode !== OK) return [];
  return status.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length >= GIT_STATUS_PATH_OFFSET)
    .filter((line) => CONFLICT_PREFIXES.some((p) => line.startsWith(p)))
    .map((line) => line.slice(GIT_STATUS_PATH_OFFSET).trim())
    .filter((p) => p.length > 0);
}

export interface RemoveTempInput {
  readonly repoRoot: string;
  readonly path: string;
}

export async function removeTempMergeWorktree(runner: LifecycleRunner, input: RemoveTempInput): Promise<RunResult> {
  return runner.git(["worktree", "remove", "--force", input.path], { cwd: input.repoRoot });
}
```

**Implementation notes:** Design requires latest remote base and local-main-safe temp worktree creation. Implementing this by moving `git fetch origin <baseBranch>` into `createTempMergeWorktree`, then running `git worktree add --detach <tmp> origin/<baseBranch>` because detached worktrees are not blocked by an already checked-out local branch.

**Verify:** `bun test tests/lifecycle/recovery/temp-worktree.test.ts`
**Commit:** `fix(lifecycle): create temp merge worktree from detached remote base`

---

## Batch 2: Core Local-Merge Integration (parallel - 1 implementer)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1

### Task 2.1: Local Merge Detached Base Sequencing
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/merge-temp-worktree.test.ts`
**Depends:** 1.1 (uses detached remote-base temp worktree helper)
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

const recorder = (queue: Map<string, RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ bin: "git", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      return r ?? OK();
    },
    gh: async (args, opts) => {
      calls.push({ bin: "gh", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      // Default: no remote CI so resolveStrategy stays in local-merge mode.
      return r ?? OK("[]");
    },
  };
  return { runner, calls };
};

const commandStrings = (calls: readonly Call[]): readonly string[] => calls.map((call) => call.args.join(" "));

describe("finishViaLocalMerge with temp worktree", () => {
  it("creates /tmp/<repo>-merge-issue-<N> from detached origin/base, merges inside it, pushes base, then removes it", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]"), OK("[]")]);
    queue.set("fetch origin main", [OK()]);
    queue.set("worktree add --detach /tmp/micode-merge-issue-67 origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [OK()]);
    queue.set("push origin HEAD:main", [OK()]);
    queue.set("worktree remove --force /tmp/micode-merge-issue-67", [OK()]);
    queue.set("worktree list --porcelain", [OK("worktree /r/micode-issue-67\n")]);
    queue.set("worktree remove /r/micode-issue-67", [OK()]);
    queue.set("status --porcelain", [OK()]);
    queue.set("ls-files --others --exclude-standard", [OK()]);
    queue.set("branch -d issue/67-x", [OK()]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.recoveryHint).toBeUndefined();

    const cwds = calls.map((c) => `${c.args.join(" ")}@${c.cwd}`);
    expect(cwds).toEqual(
      expect.arrayContaining([
        "fetch origin main@/r/micode",
        "worktree add --detach /tmp/micode-merge-issue-67 origin/main@/r/micode",
        "merge --no-ff issue/67-x@/tmp/micode-merge-issue-67",
        "push origin HEAD:main@/tmp/micode-merge-issue-67",
      ]),
    );
    expect(cwds.indexOf("fetch origin main@/r/micode")).toBeLessThan(
      cwds.indexOf("worktree add --detach /tmp/micode-merge-issue-67 origin/main@/r/micode"),
    );
    expect(cwds.indexOf("worktree add --detach /tmp/micode-merge-issue-67 origin/main@/r/micode")).toBeLessThan(
      cwds.indexOf("merge --no-ff issue/67-x@/tmp/micode-merge-issue-67"),
    );
    expect(commandStrings(calls)).not.toContain("worktree add /tmp/micode-merge-issue-67 main");
    expect(commandStrings(calls)).not.toContain("merge --ff-only origin/main");
    expect(cwds.some((s) => s.startsWith("checkout main@/r/micode"))).toBe(false);
  });

  it("on merge conflict, keeps tmp worktree, returns merge_conflict hint with conflict_files", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("fetch origin main", [OK()]);
    queue.set("worktree add --detach /tmp/micode-merge-issue-67 origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [FAIL("CONFLICT")]);
    queue.set("status --porcelain", [OK("UU src/a.ts\nAA src/b.ts\n")]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.recoveryHint?.conflictFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(outcome.recoveryHint?.worktree).toBe("/tmp/micode-merge-issue-67");
    expect(calls.some((c) => c.args.join(" ") === "worktree remove --force /tmp/micode-merge-issue-67")).toBe(false);
  });

  it("on push failure, removes tmp worktree before returning retryable push_failed hint", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("fetch origin main", [OK()]);
    queue.set("worktree add --detach /tmp/micode-merge-issue-67 origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [OK()]);
    queue.set("push origin HEAD:main", [FAIL("rejected")]);
    queue.set("worktree remove --force /tmp/micode-merge-issue-67", [OK()]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("push_failed");
    expect(outcome.recoveryHint?.safeToRetry).toBe(true);
    expect(outcome.recoveryHint?.worktree).toBe("/tmp/micode-merge-issue-67");
    const pushIndex = calls.findIndex((c) => c.args.join(" ") === "push origin HEAD:main");
    const removeIndex = calls.findIndex(
      (c) => c.args.join(" ") === "worktree remove --force /tmp/micode-merge-issue-67",
    );
    expect(removeIndex).toBeGreaterThan(pushIndex);
  });

  it("safety: never executes unsafe recovery commands against the main worktree", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("fetch origin main", [OK()]);
    queue.set("worktree add --detach /tmp/micode-merge-issue-67 origin/main", [FAIL("path exists")]);

    const { runner, calls } = recorder(queue);
    await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    const commands = commandStrings(calls);
    expect(commands.some((command) => command.startsWith("reset --hard"))).toBe(false);
    expect(commands.some((command) => command.includes("--force-with-lease"))).toBe(false);
    expect(commands.some((command) => command.startsWith("push --force"))).toBe(false);
    expect(commands.some((command) => command.includes("--no-verify"))).toBe(false);
    expect(commands.some((command) => command.startsWith("checkout "))).toBe(false);
  });
});
```

```typescript
// Modify existing `src/lifecycle/merge.ts` only; do not rewrite unrelated PR flow.
// 1. In `prepareTempMergeWorktree`, remove the post-create `fetch origin <baseBranch>` and
//    `merge --ff-only origin/<baseBranch>` steps. Task 1.1 makes `createTempMergeWorktree`
//    already fetch `origin/<baseBranch>` and create the temp worktree detached at that remote ref.
//
// 2. Keep `mergeIssueBranchIntoBase` as `git merge --no-ff <issueBranch>` in the temp worktree.
//    This preserves local merge semantics: latest remote base + no-ff issue branch merge.
//
// 3. Change `pushMergedBaseBranch` from:
//      git push origin <baseBranch>
//    to:
//      git push origin HEAD:<baseBranch>
//    because the temp worktree is detached and has no checked-out local base branch.
//    This is a plain non-force push; do not add `--force`, `--force-with-lease`, or `+HEAD:<baseBranch>`.
//
// 4. Keep failure handling unchanged: on push failure, remove temp worktree and return `push_failed`
//    with `safeToRetry` based on cleanup success; on merge conflict, keep temp worktree for resolver.
//
// 5. Keep `createTempWorktreeFailureOutcome` shape unchanged so existing recovery hints still parse.
//
// 6. Search and update tests that hard-code the old command sequence:
//    - `worktree add <tmp> main` becomes `fetch origin main` + `worktree add --detach <tmp> origin/main`
//    - `merge --ff-only origin/main` is no longer expected
//    - `push origin main` becomes `push origin HEAD:main`
```

**Implementation notes:** Design requires latest origin/base then issue no-ff merge then plain push. Implementing the detached case with `HEAD:<baseBranch>` is necessary because a detached worktree has no local `main` branch to push by name.

**Verify:** `bun test tests/lifecycle/merge-temp-worktree.test.ts tests/lifecycle/merge.test.ts`
**Commit:** `fix(lifecycle): push detached temp merge head to base`

---

## Batch 3: Regression Test Alignment (parallel - 2 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2

### Task 3.1: Lifecycle Merge Test Expectation Alignment
**File:** `tests/lifecycle/merge.test.ts`
**Test:** `tests/lifecycle/merge.test.ts`
**Depends:** 2.1
**Domain:** general
**Atlas-impact:** none

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const WORKTREE = "/repo/micode-issue-1";
const BRANCH = "issue/1-lifecycle";
const PR_URL = "https://github.com/Wuxie233/micode/pull/12";
const PR_NUMBER = 12;
const REVIEW_SUMMARY = "## AI Review Summary\n- Looks safe";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

interface RunnerOutputs {
  readonly git?: readonly RunResult[];
  readonly gh?: readonly RunResult[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({ stdout, stderr: EMPTY_OUTPUT, exitCode });
const createFailure = (stderr = "failed"): RunResult => ({ stdout: EMPTY_OUTPUT, stderr, exitCode: FAILURE_EXIT_CODE });
const createPrView = (body = EMPTY_OUTPUT): RunResult => createRun(JSON.stringify({ number: PR_NUMBER, url: PR_URL, body }));

const createRunner = (outputs: RunnerOutputs): FakeRunner => {
  const calls: RunnerCall[] = [];
  let gitIndex = 0;
  let ghIndex = 0;
  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const result = outputs.git?.[gitIndex] ?? createRun();
      gitIndex += 1;
      return result;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const result = outputs.gh?.[ghIndex] ?? createRun();
      ghIndex += 1;
      return result;
    },
  };
};

// Keep all existing tests in this file. Update only local-merge expectations to the detached remote-base sequence below.
describe("finishLifecycle", () => {
  it("local merge uses a detached temp worktree from remote base and pushes the resolved master branch", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [createRun(), createRun(), createRun(), createRun(), createRun(), createRun(), createRun(), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    const gitCalls = runner.calls.filter((call) => call.bin === "git");
    expect(gitCalls[0]).toEqual({ bin: "git", args: ["fetch", "origin", "master"], cwd: CWD });
    expect(gitCalls[1]).toEqual({
      bin: "git",
      args: ["worktree", "add", "--detach", "/tmp/micode-merge-issue-1", "origin/master"],
      cwd: CWD,
    });
    expect(gitCalls[2]).toEqual({ bin: "git", args: ["merge", "--no-ff", BRANCH], cwd: "/tmp/micode-merge-issue-1" });
    expect(gitCalls[3]).toEqual({ bin: "git", args: ["push", "origin", "HEAD:master"], cwd: "/tmp/micode-merge-issue-1" });
    expect(gitCalls.some((call) => call.args.join(" ") === "worktree add /tmp/micode-merge-issue-1 master")).toBe(false);
    expect(gitCalls.some((call) => call.args.join(" ") === "merge --ff-only origin/master")).toBe(false);
  });
});

describe("PR_CHECK_POLL_MS", () => {
  it("is exported as a positive number for waitForPrChecks scheduling", () => {
    expect(PR_CHECK_POLL_MS).toBeGreaterThan(0);
  });
});

describe("finishLifecycle autonomy-first cleanup", () => {
  const createExistingWorktree = (): string => mkdtempSync(join(tmpdir(), "micode-issue-1-"));
  const removeFixture = (path: string): void => rmSync(path, { recursive: true, force: true });
  const createWorktreePorcelain = (worktree: string): RunResult => createRun(`worktree ${worktree}\nbranch refs/heads/${BRANCH}\n`);
  const gitCall = (runner: FakeRunner, args: readonly string[]): RunnerCall | undefined =>
    runner.calls.find((call) => call.bin === "git" && call.args.join(" ") === args.join(" "));
  const gitCalls = (runner: FakeRunner, args: readonly string[]): readonly RunnerCall[] =>
    runner.calls.filter((call) => call.bin === "git" && call.args.join(" ") === args.join(" "));

  it("routes local-merge cleanup through cleanup-policy and skips git branch -d when cleanup is blocked", async () => {
    const worktree = createExistingWorktree();
    try {
      const runner = createRunner({
        git: [
          createRun(),
          createRun(),
          createRun(),
          createRun(),
          createRun(),
          createWorktreePorcelain(worktree),
          createRun(" M src/foo.ts\n"),
          createRun(),
        ],
      });

      const outcome = await finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree,
        mergeStrategy: "local-merge",
        waitForChecks: false,
        baseBranch: "main",
      });

      expect(outcome.merged).toBe(true);
      expect(outcome.cleanupOutcome.kind).toBe("blocked-dirty");
      expect(outcome.worktreeRemoved).toBe(false);
      expect(gitCall(runner, ["worktree", "list", "--porcelain"])).toEqual({
        bin: "git",
        args: ["worktree", "list", "--porcelain"],
        cwd: CWD,
      });
      expect(gitCalls(runner, ["branch", "-d", BRANCH])).toHaveLength(0);
    } finally {
      removeFixture(worktree);
    }
  });
});
```

```typescript
// Modify existing `tests/lifecycle/merge.test.ts` only; do not replace unrelated PR/cleanup tests.
// Update local-merge command expectations:
// - first git command is `fetch origin <baseBranch>` in the repo root
// - second git command is `worktree add --detach /tmp/<repo>-merge-issue-N origin/<baseBranch>` in the repo root
// - remove expectations for `merge --ff-only origin/<baseBranch>`
// - push command is `push origin HEAD:<baseBranch>` from the temp worktree
// - keep assertions that PR path, cleanup policy, and branch deletion behavior stay unchanged
```

**Verify:** `bun test tests/lifecycle/merge.test.ts`
**Commit:** `test(lifecycle): align local merge tests with detached remote base`

### Task 3.2: Safety Boundary Detached Base Regression
**File:** `tests/lifecycle/recovery-safety-boundary.test.ts`
**Test:** `tests/lifecycle/recovery-safety-boundary.test.ts`
**Depends:** 2.1
**Domain:** general
**Atlas-impact:** none

```typescript
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { runCleanup } from "@/lifecycle/cleanup-policy";
import { commitAndPush } from "@/lifecycle/commits";
import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface RecordedCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRecordingRunner = (
  responses: ReadonlyMap<string, readonly RunResult[]> = new Map(),
): { readonly runner: LifecycleRunner; readonly calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  const cursors = new Map<string, number>();
  const next = (args: readonly string[]): RunResult => {
    const key = args.join(" ");
    const list = responses.get(key);
    const index = cursors.get(key) ?? 0;
    cursors.set(key, index + 1);
    return list?.[Math.min(index, list.length - 1)] ?? OK();
  };
  return {
    calls,
    runner: {
      git: async (args, options) => {
        calls.push({ bin: "git", args, cwd: options?.cwd });
        return next(args);
      },
      gh: async (args, options) => {
        calls.push({ bin: "gh", args, cwd: options?.cwd });
        return next(args);
      },
    },
  };
};

const joinedArgs = (calls: readonly RecordedCall[]): readonly string[] => calls.map((call) => call.args.join(" "));

const expectNoUnsafeRecoveryCommands = (calls: readonly RecordedCall[]): void => {
  const commands = joinedArgs(calls);
  expect(commands.some((command) => command.startsWith("push --force"))).toBe(false);
  expect(commands.some((command) => command.includes("--force-with-lease"))).toBe(false);
  expect(commands.some((command) => command.includes("--no-verify"))).toBe(false);
  expect(commands.some((command) => command.startsWith("reset --hard"))).toBe(false);
  expect(commands.some((command) => command === "rm" || command.startsWith("rm "))).toBe(false);
  expect(commands.some((command) => command.includes("restart"))).toBe(false);
};

describe("lifecycle recovery safety boundary", () => {
  let sleep: ReturnType<typeof spyOn>;

  beforeEach(() => {
    sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    sleep.mockRestore();
  });

  it("finishLifecycle recovery paths use detached remote-base temp worktree and never checkout local main", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/67-safety --required --json state,name", [OK("[]")]],
      ["fetch origin main", [OK()]],
      ["worktree add --detach /tmp/micode-merge-issue-67 origin/main", [OK()]],
      ["merge --no-ff issue/67-safety", [FAIL("CONFLICT")]],
      ["status --porcelain", [OK("UU src/conflict.ts\n")]],
    ]);
    const { runner, calls } = createRecordingRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/67-safety",
      worktree: "/repo/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expectNoUnsafeRecoveryCommands(calls);
    expect(calls.some((call) => call.args.join(" ") === "checkout main" && call.cwd === "/repo/micode")).toBe(false);
    expect(calls.some((call) => call.args.join(" ").startsWith("checkout "))).toBe(false);
    expect(calls).toContainEqual({
      bin: "git",
      args: ["worktree", "add", "--detach", "/tmp/micode-merge-issue-67", "origin/main"],
      cwd: "/repo/micode",
    });
    expect(calls).toContainEqual({
      bin: "git",
      args: ["merge", "--no-ff", "issue/67-safety"],
      cwd: "/tmp/micode-merge-issue-67",
    });
    expect(joinedArgs(calls)).not.toContain("worktree add /tmp/micode-merge-issue-67 main");
    expect(joinedArgs(calls)).not.toContain("merge --ff-only origin/main");
  });

  it("commitAndPush retry path never force-pushes and never bypasses hooks", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["add --all", [OK()]],
      ["commit -m feat(lifecycle): safety\n\nRefs #67", [OK()]],
      ["rev-parse HEAD", [OK("abc123\n")]],
      ["push --set-upstream origin issue/67-safety", [FAIL("network"), FAIL("still down")]],
    ]);
    const { runner, calls } = createRecordingRunner(responses);

    const outcome = await commitAndPush(runner, {
      cwd: "/repo/micode-issue-67",
      issueNumber: 67,
      branch: "issue/67-safety",
      type: "feat",
      scope: "lifecycle",
      summary: "safety",
      push: true,
    });

    expect(outcome.committed).toBe(true);
    expectNoUnsafeRecoveryCommands(calls);
  });
});
```

```typescript
// Modify existing `tests/lifecycle/recovery-safety-boundary.test.ts` only.
// Keep existing cleanup-policy and commitAndPush tests. Update the finishLifecycle safety test to assert:
// - `fetch origin main` happens in repo root
// - `worktree add --detach <tmp> origin/main` happens in repo root
// - no `worktree add <tmp> main`, no `merge --ff-only origin/main`, no checkout, no reset hard
// - merge conflict still preserves temp worktree and returns `merge_conflict`
```

**Verify:** `bun test tests/lifecycle/recovery-safety-boundary.test.ts`
**Commit:** `test(lifecycle): guard detached base local merge safety`
