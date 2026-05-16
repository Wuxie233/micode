---
date: 2026-05-16
topic: "question-permission-lifecycle-remote-write-safety"
issue: 90
scope: lifecycle
contract: none
---

# Question Permission + Lifecycle Remote-Write Safety Implementation Plan

**Goal:** Re-land the still-useful parts of #71 and #81 on current `main`: built-in `question` is permitted by default, and lifecycle `commit` / `finish` fail closed before any remote write when repository ownership cannot be verified.

**Architecture:** Use two small boundaries: a config-time permission helper for fill-missing `permission.question`, and a lifecycle remote-write guard that reuses `classifyRepo`. Keep current repo-discovery, tool registration, branch cleanup, and restart behavior unchanged.

**Design:** `thoughts/shared/designs/2026-05-16-question-permission-lifecycle-remote-safety-design.md`

**Contract:** none — this is single-domain workflow/tooling work with no frontend/backend API boundary.

**Context brief needs for executor:** pass to every implementer/reviewer: (1) #71/#81 old branches are not to be merged; (2) no custom `question` tool registration; (3) preserve explicit `permission.question`; (4) remote writes include git push, PR create/merge, PR body/comment, issue edit/close; (5) `UNKNOWN` / `UPSTREAM` must fail closed; (6) runtime deploy expected after verification, but do **not** restart OpenCode.

**Knowledge context:** Atlas read: `atlas/00-index.md` highlights `工具注册表`, `Lifecycle 状态机`, behavior `Issue 驱动交付生命周期`, risk `远程 Git 所属误推`; targeted atlas lookup found no existing node for this exact behavior. Mindmodel lookup: unavailable in this worktree. Project Memory lookup: no matching active decisions.

---

## 行为承诺映射

design.md `## Behavior` / `## 承诺清单 / Commitments` 段列出以下行为承诺：

- “micode agents 默认能调用 OpenCode 内置 `question` 工具” → Batch 1 Task 1.1 提供 fill-missing helper；Batch 2 Task 2.1 接入 plugin config；`tests/index-wiring.test.ts` 验证 config 后默认存在 `permission.question`。
- “用户显式配置的 `permission.question` 不被覆盖” → Batch 1 Task 1.1 测试 own-property override；Batch 2 Task 2.1 wiring smoke 覆盖显式 `deny` / object override。
- “插件不会注册自定义 `question` 工具来 shadow OpenCode 内置工具” → Batch 2 Task 2.1 在 `tests/index-wiring.test.ts` 断言 `plugin.tool` 不含 `question`。
- “lifecycle 的 `commit` / `finish` 等远端写路径在写 GitHub 或 push 前重新执行 ownership 检查” → Batch 1 Task 1.2 提供 guard；Batch 2 Task 2.2 在 `src/lifecycle/index.ts` 的 commit/finish 入口调用 guard；`tests/lifecycle/index-remote-write-guard.test.ts` 验证 blocked 时不执行 `git push` / `gh pr create|merge` / `gh issue edit|close`。
- “`UNKNOWN` / `UPSTREAM` remote classification 必须 fail closed” → Batch 1 Task 1.2 helper tests；Batch 2 Task 2.2 integration tests。
- “当前 `main` 已有的新能力不能被旧 #71/#81 分支回退” → 本计划只编辑当前 worktree 文件，不 merge old branches；Batch 3 Task 3.1 regression command includes focused lifecycle/plugin tests plus `bun run typecheck` and `bun run build`.
- “本轮不会自动重启 OpenCode；部署后由用户下次手动重启加载新插件” → Batch 3 Task 3.1 documents verification/deploy command `bun run deploy:runtime` and explicitly forbids restart commands.

**未对应任何 task 的行为**：无。

---

## Review Policy

- **Reviewer mandatory:** all tasks. Reasons: permission surface (`src/index.ts` config), lifecycle remote-write/security surface (`src/lifecycle/**`), fail-closed behavior, runtime deploy expectation.
- **Reviewer-skip eligible:** none. Even helper-only tasks feed security/permission behavior and must be reviewed.
- **Risk observations mapped to tasks:**
  - Old #71/#81 branches are stale and must not be merged → all tasks; reviewers should reject branch-backport artifacts.
  - `question` must remain built-in OpenCode tool, not plugin wrapper → Task 2.1.
  - Remote writes must be guarded before first mutation, including issue edit/close and PR body/comment paths → Task 2.2.
  - `UNKNOWN` / `UPSTREAM` must fail closed with recovery hint and no remote mutation → Tasks 1.2, 2.2.
  - Runtime deploy yes, restart no → Task 3.1.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation helpers - no deps]
Batch 2 (parallel): 2.1, 2.2 [integration - depends on helpers]
Batch 3 (parallel): 3.1 [verification and deploy handoff - depends on batch 2]
```

---

## Batch 1: Foundation Helpers (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Question Permission Fill-Missing Helper
**File:** `src/utils/question-permission.ts`
**Test:** `tests/utils/question-permission.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update
**Review policy:** mandatory — permission surface; helper decides default agent access to built-in `question`.

```typescript
// tests/utils/question-permission.test.ts
import { describe, expect, it } from "bun:test";

import { applyDefaultQuestionPermission } from "@/utils/question-permission";

describe("applyDefaultQuestionPermission", () => {
  it("adds built-in question permission when missing", () => {
    expect(applyDefaultQuestionPermission({ edit: "allow" })).toEqual({ edit: "allow", question: "allow" });
  });

  it("creates a permission map when input is undefined", () => {
    expect(applyDefaultQuestionPermission(undefined)).toEqual({ question: "allow" });
  });

  it("preserves explicit deny override", () => {
    expect(applyDefaultQuestionPermission({ question: "deny", edit: "allow" })).toEqual({
      question: "deny",
      edit: "allow",
    });
  });

  it("preserves explicit ask override", () => {
    expect(applyDefaultQuestionPermission({ question: "ask" })).toEqual({ question: "ask" });
  });

  it("preserves explicit pattern-map/object override", () => {
    const override = { default: "deny", ask_text: "allow" };
    expect(applyDefaultQuestionPermission({ question: override })).toEqual({ question: override });
  });

  it("treats an own question property as explicit even when value is undefined", () => {
    const permission: Record<string, unknown> = { question: undefined };
    expect(Object.hasOwn(applyDefaultQuestionPermission(permission), "question")).toBe(true);
    expect(applyDefaultQuestionPermission(permission).question).toBeUndefined();
  });
});
```

```typescript
// src/utils/question-permission.ts
export type PermissionMap = Record<string, unknown>;

const QUESTION_TOOL_PERMISSION = "question";
const ALLOW_PERMISSION = "allow";

export function applyDefaultQuestionPermission(permission: PermissionMap | undefined): PermissionMap {
  const merged = { ...(permission ?? {}) };
  if (Object.hasOwn(merged, QUESTION_TOOL_PERMISSION)) return merged;
  return { ...merged, [QUESTION_TOOL_PERMISSION]: ALLOW_PERMISSION };
}
```

**Verify:** `bun test tests/utils/question-permission.test.ts`
**Commit:** `feat(lifecycle): add question permission default helper`

### Task 1.2: Lifecycle Remote-Write Guard Helper
**File:** `src/lifecycle/remote-write-guard.ts`
**Test:** `tests/lifecycle/remote-write-guard.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update
**Review policy:** mandatory — lifecycle/security remote-write boundary; UNKNOWN/UPSTREAM fail-closed behavior.

```typescript
// tests/lifecycle/remote-write-guard.test.ts
import { describe, expect, it } from "bun:test";

import { evaluateRemoteWriteGuard, REMOTE_WRITE_BLOCKED_NOTE } from "@/lifecycle/remote-write-guard";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/repo/micode";
const ISSUE_NUMBER = 90;
const BRANCH = "issue/90-question-permission";
const OK = 0;
const FAIL = 1;
const REPO = "Wuxie233/micode";
const ORIGIN = `git@github.com:${REPO}.git`;

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly Call[];
}

const run = (stdout: string, exitCode = OK): RunResult => ({ stdout, stderr: "", exitCode });

const repoView = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    nameWithOwner: REPO,
    isFork: true,
    parent: { name: "micode", owner: { login: "vtemian" } },
    owner: { login: "Wuxie233" },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
    ...overrides,
  });

function createRunner(origin: RunResult, view: RunResult): FakeRunner {
  const calls: Call[] = [];
  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return origin;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return view;
    },
  };
}

describe("evaluateRemoteWriteGuard", () => {
  it("allows fork origins", async () => {
    const runner = createRunner(run(`${ORIGIN}\n`), run(repoView({ isFork: true })));

    const outcome = await evaluateRemoteWriteGuard({ runner, cwd: CWD, operation: "lifecycle_commit", issueNumber: ISSUE_NUMBER, branch: BRANCH });

    expect(outcome.allowed).toBe(true);
    expect(runner.calls.map((call) => call.bin)).toEqual(["git", "gh"]);
  });

  it("allows owned original repositories", async () => {
    const runner = createRunner(run(`${ORIGIN}\n`), run(repoView({ isFork: false, parent: null, viewerPermission: "WRITE" })));

    const outcome = await evaluateRemoteWriteGuard({ runner, cwd: CWD, operation: "lifecycle_finish", issueNumber: ISSUE_NUMBER, branch: BRANCH });

    expect(outcome.allowed).toBe(true);
  });

  it("blocks unknown origins and returns a recovery hint", async () => {
    const runner = createRunner(run("not-a-github-remote\n"), run("", FAIL));

    const outcome = await evaluateRemoteWriteGuard({ runner, cwd: CWD, operation: "lifecycle_commit", issueNumber: ISSUE_NUMBER, branch: BRANCH });

    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) return;
    expect(outcome.note).toContain(REMOTE_WRITE_BLOCKED_NOTE);
    expect(outcome.note).toContain("unknown");
    expect(outcome.recoveryHint.failureKind).toBe("unknown");
    expect(outcome.recoveryHint.recommendedNextAction).toBe("ask_user");
    expect(outcome.recoveryHint.safeToRetry).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
  });

  it("blocks upstream/read-only origins", async () => {
    const runner = createRunner(
      run("git@github.com:vtemian/micode.git\n"),
      run(repoView({ nameWithOwner: "vtemian/micode", isFork: false, parent: null, owner: { login: "vtemian" }, viewerPermission: "READ" })),
    );

    const outcome = await evaluateRemoteWriteGuard({ runner, cwd: CWD, operation: "lifecycle_finish", issueNumber: ISSUE_NUMBER, branch: BRANCH });

    expect(outcome.allowed).toBe(false);
    if (outcome.allowed) return;
    expect(outcome.note).toContain("upstream");
    expect(outcome.note).toContain("vtemian/micode");
  });
});
```

```typescript
// src/lifecycle/remote-write-guard.ts
import { buildHint, type LifecycleRecoveryHint } from "./recovery/hint";
import type { LifecycleRunner } from "./runner";
import { classifyRepo, type PreFlightResult, REPO_KIND } from "./pre-flight";

export const REMOTE_WRITE_BLOCKED_NOTE = "remote_write_blocked";

export type RemoteWriteOperation =
  | "lifecycle_commit"
  | "lifecycle_finish"
  | "lifecycle_finish_pr"
  | "lifecycle_finish_local_merge"
  | "lifecycle_issue_sync"
  | "lifecycle_issue_close";

export interface RemoteWriteGuardInput {
  readonly runner: LifecycleRunner;
  readonly cwd: string;
  readonly operation: RemoteWriteOperation;
  readonly issueNumber?: number;
  readonly branch?: string;
  readonly worktree?: string;
}

export type RemoteWriteGuardOutcome =
  | { readonly allowed: true; readonly preflight: PreFlightResult }
  | { readonly allowed: false; readonly preflight: PreFlightResult; readonly note: string; readonly recoveryHint: LifecycleRecoveryHint };

const isAllowedKind = (kind: PreFlightResult["kind"]): boolean => kind === REPO_KIND.FORK || kind === REPO_KIND.OWN;

const targetFor = (preflight: PreFlightResult): string => preflight.nameWithOwner || preflight.origin || "unknown-origin";

const buildBlockedNote = (operation: RemoteWriteOperation, preflight: PreFlightResult): string =>
  `${REMOTE_WRITE_BLOCKED_NOTE}: ${operation} blocked because origin ownership is ${preflight.kind} (${targetFor(preflight)})`;

export async function evaluateRemoteWriteGuard(input: RemoteWriteGuardInput): Promise<RemoteWriteGuardOutcome> {
  const preflight = await classifyRepo(input.runner, input.cwd);
  if (isAllowedKind(preflight.kind)) return { allowed: true, preflight };

  const note = buildBlockedNote(input.operation, preflight);
  return {
    allowed: false,
    preflight,
    note,
    recoveryHint: buildHint({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      summary: note,
      safeToRetry: false,
      issueNumber: input.issueNumber ?? null,
      branch: input.branch ?? null,
      worktree: input.worktree ?? null,
    }),
  };
}
```

**Verify:** `bun test tests/lifecycle/remote-write-guard.test.ts`
**Commit:** `feat(lifecycle): add remote write ownership guard`

---

## Batch 2: Integration (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Wire Built-In Question Permission Into Plugin Config
**File:** `src/index.ts`
**Test:** `tests/index-wiring.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** layer-update
**Review policy:** mandatory — plugin permission surface and built-in tool shadowing risk.

Implementation details:

1. Add import near existing utility imports:

```typescript
import { applyDefaultQuestionPermission } from "@/utils/question-permission";
```

2. Replace the current `config.permission = { ... }` block inside `config: async (config) => {` with:

```typescript
      // Allow core OpenCode permissions globally. Fill missing built-in `question`
      // permission without overriding an explicit user-provided value.
      config.permission = applyDefaultQuestionPermission({
        ...config.permission,
        edit: "allow",
        bash: "allow",
        webfetch: "allow",
        external_directory: "allow",
      });
```

3. In `tests/index-wiring.test.ts`, add the following cases under `describe("OpenCodeConfigPlugin issue workflow wiring", ...)`:

```typescript
  it("allows the built-in question tool by default without registering a custom question tool", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const pluginConfig = await applyPluginConfig(plugin);

      expect(pluginConfig.permission?.question).toBe("allow");
      expect(Object.keys(plugin.tool ?? {})).not.toContain("question");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("preserves an explicit question permission override", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const reads: string[] = [];
    trackWiringConfig(reads);
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    try {
      const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
      const pluginConfig: PluginConfigStub = { permission: { question: "deny" }, agent: {}, mcp: {}, command: {} };
      await plugin.config?.(pluginConfig as Parameters<NonNullable<typeof plugin.config>>[0]);

      expect(pluginConfig.permission?.question).toBe("deny");
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
```

**Verify:** `bun test tests/utils/question-permission.test.ts tests/index-wiring.test.ts`
**Commit:** `feat(lifecycle): allow built-in question by default`

### Task 2.2: Guard Lifecycle Commit/Finish Before Remote Mutations
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/index-remote-write-guard.test.ts`
**Depends:** 1.2
**Domain:** general
**Atlas-impact:** layer-update
**Review policy:** mandatory — lifecycle/security remote writes, recovery behavior, issue/PR mutation boundary.

Implementation details:

1. Add import:

```typescript
import { evaluateRemoteWriteGuard } from "./remote-write-guard";
```

2. Add helper outcomes near `buildExecutorBlockedOutcome`:

```typescript
const buildRemoteWriteBlockedCommitOutcome = (note: string, recoveryHint: CommitOutcome["recoveryHint"]): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note,
  recoveryHint,
});

const buildRemoteWriteBlockedFinishOutcome = (note: string, recoveryHint: FinishOutcome["recoveryHint"]): FinishOutcome => ({
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  cleanupOutcome: { kind: "failed", reason: "remote write blocked before mutation", retried: false },
  note,
  recoveryHint,
});
```

3. In `createCommitter`, after loading `record` and before `createCommitMarker` / `commitAndPush`, insert:

```typescript
    const guard = await evaluateRemoteWriteGuard({
      runner: context.runner,
      cwd: record.worktree,
      operation: "lifecycle_commit",
      issueNumber,
      branch: record.branch,
      worktree: record.worktree,
    });
    if (!guard.allowed) {
      const outcome = buildRemoteWriteBlockedCommitOutcome(guard.note, guard.recoveryHint);
      await safeEmit(context, issueNumber, guard.note);
      return outcome;
    }
```

Rationale: even `push: false` would still call `saveAndSync` (`gh issue edit`) after local commit, so the guard must run before local commit to avoid any follow-up remote mutation.

4. In `createFinisher`, after loading `record` and before journal blocked handling / `saveAndSync`, insert:

```typescript
    const guard = await evaluateRemoteWriteGuard({
      runner: context.runner,
      cwd: context.cwd,
      operation: "lifecycle_finish",
      issueNumber,
      branch: record.branch,
      worktree: record.worktree,
    });
    if (!guard.allowed) {
      const outcome = buildRemoteWriteBlockedFinishOutcome(guard.note, guard.recoveryHint);
      await safeEmit(context, issueNumber, guard.note);
      return outcome;
    }
```

Rationale: finish can mutate GitHub through PR create/merge, PR body/comment, issue edit/close, and local-merge push. Guarding before the first state sync keeps UNKNOWN/UPSTREAM fail-closed.

5. Create `tests/lifecycle/index-remote-write-guard.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { LifecycleRecord } from "@/lifecycle/types";

const PREFIX = "micode-remote-write-guard-";
const ISSUE_NUMBER = 90;
const BRANCH = "issue/90-question-permission";
const SUMMARY = "question permission remote safety";
const OK = 0;
const FAIL = 1;

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly Call[];
}

const run = (stdout = "", exitCode = OK): RunResult => ({ stdout, stderr: exitCode === OK ? "" : stdout, exitCode });

let root: string;
let baseDir: string;
let worktree: string;

function createRunner(): FakeRunner {
  const calls: Call[] = [];
  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      if (args.join(" ") === "remote get-url origin") return run("not-a-github-remote\n");
      return run();
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return run("should not be called", FAIL);
    },
  };
}

function createRecord(): LifecycleRecord {
  return {
    issueNumber: ISSUE_NUMBER,
    issueUrl: "https://github.com/Wuxie233/micode/issues/90",
    branch: BRANCH,
    worktree,
    state: LIFECYCLE_STATES.BRANCH_READY,
    artifacts: { design: [], plan: [], ledger: [], commit: [], pr: [], worktree: [worktree] },
    notes: [],
    updatedAt: Date.now(),
  };
}

function writeRecord(record: LifecycleRecord): void {
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, `${ISSUE_NUMBER}.json`), JSON.stringify(record, null, 2));
}

describe("lifecycle remote-write guard integration", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function setup(): { readonly runner: FakeRunner; readonly handle: ReturnType<typeof createLifecycleStore> } {
    root = mkdtempSync(join(tmpdir(), PREFIX));
    baseDir = join(root, "lifecycle");
    worktree = join(root, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeRecord(createRecord());
    const runner = createRunner();
    const handle = createLifecycleStore({ runner, worktreesRoot: root, cwd: root, baseDir });
    return { runner, handle };
  }

  it("blocks lifecycle commit before local commit, push, or issue edit when origin is unknown", async () => {
    const { runner, handle } = setup();

    const outcome = await handle.commit(ISSUE_NUMBER, { scope: "lifecycle", summary: SUMMARY, push: true });

    expect(outcome.committed).toBe(false);
    expect(outcome.pushed).toBe(false);
    expect(outcome.note).toContain("remote_write_blocked");
    expect(outcome.recoveryHint?.recommendedNextAction).toBe("ask_user");
    expect(runner.calls.some((call) => call.bin === "git" && call.args[0] === "commit")).toBe(false);
    expect(runner.calls.some((call) => call.bin === "git" && call.args[0] === "push")).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[0] === "issue" && call.args[1] === "edit")).toBe(false);
  });

  it("blocks lifecycle finish before PR/local-merge/issue mutations when origin is unknown", async () => {
    const { runner, handle } = setup();

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "pr", waitForChecks: false });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("remote_write_blocked");
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[0] === "pr")).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh" && call.args[0] === "issue")).toBe(false);
    expect(runner.calls.some((call) => call.bin === "git" && call.args[0] === "push")).toBe(false);
  });
});
```

**Verify:** `bun test tests/lifecycle/remote-write-guard.test.ts tests/lifecycle/index-remote-write-guard.test.ts tests/lifecycle/commit-tool-recovery.test.ts tests/lifecycle/finish-recovery.test.ts`
**Commit:** `feat(lifecycle): gate commit and finish remote writes`

---

## Batch 3: Verification and Runtime Deploy Handoff (parallel - 1 implementer)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Focused Regression Verification and Runtime Deploy Expectation
**File:** `thoughts/shared/plans/2026-05-16-question-permission-lifecycle-remote-write-safety.md`
**Test:** none
**Depends:** 2.1, 2.2
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — lifecycle/security/permissions final acceptance and deploy/no-restart instruction.

Implementation/deploy handoff for executor:

```text
Run these verification commands after Batch 2 passes:

1. bun test tests/utils/question-permission.test.ts tests/index-wiring.test.ts
2. bun test tests/lifecycle/remote-write-guard.test.ts tests/lifecycle/index-remote-write-guard.test.ts
3. bun test tests/lifecycle/pre-flight.test.ts tests/lifecycle/commit-tool-recovery.test.ts tests/lifecycle/finish-recovery.test.ts tests/lifecycle/merge.test.ts
4. bun run typecheck
5. bun run build

Runtime deploy expectation:

6. bun run deploy:runtime

Do not run restart commands. In particular, do not run systemctl restart opencode-web.service,
/usr/local/bin/restart-opencode-detached, or manual opencode web/serve restarts. Final report should tell the
user that the runtime checkout was deployed and a manual future restart is needed to load the new plugin.
```

Acceptance checklist for reviewer:

```text
- plugin config default contains permission.question="allow".
- explicit permission.question is preserved.
- plugin.tool does not contain a custom question key.
- lifecycle commit blocked UNKNOWN/UPSTREAM before git commit, git push, or gh issue edit.
- lifecycle finish blocked UNKNOWN/UPSTREAM before PR create/merge, PR comment/body edit, git push, issue edit/close.
- no old #71/#81 branch merge artifacts appear in diff.
- no task/todowrite/todoread permission expansion appears in diff.
- no branch cleanup automation or remote branch deletion appears in diff.
- deploy command is run only after tests/build pass; no restart command is run.
```

**Verify:** `bun test tests/utils/question-permission.test.ts tests/index-wiring.test.ts && bun test tests/lifecycle/remote-write-guard.test.ts tests/lifecycle/index-remote-write-guard.test.ts tests/lifecycle/pre-flight.test.ts tests/lifecycle/commit-tool-recovery.test.ts tests/lifecycle/finish-recovery.test.ts tests/lifecycle/merge.test.ts && bun run typecheck && bun run build && bun run deploy:runtime`
**Commit:** `chore(lifecycle): verify remote safety rollout`
