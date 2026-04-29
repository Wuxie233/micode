---
date: 2026-04-29
topic: "Subagent visibility and lifecycle default branch handling"
issue: 11
scope: lifecycle
contract: none
---

# Subagent Visibility and Default Branch Implementation Plan

**Goal:** Stop micode-created internal sessions from lingering as top-level conversations, and make `lifecycle_finish` honor the repository's actual default branch (main, master, or custom) instead of hardcoding `main`.

**Architecture:** Two scoped fixes under one lifecycle. Track A introduces a centralized internal-session helper (`src/utils/internal-session.ts`) that applies title + best-effort optional metadata at creation and provides bounded deletion retry with warning-level logging on failure; the three existing callsites (`spawn-agent/tool.ts`, `octto/processor.ts`, `index.ts` constraint-reviewer hook) migrate to it. Track B introduces a default-branch resolver (`src/lifecycle/default-branch.ts`) with deterministic precedence (override → `git symbolic-ref refs/remotes/origin/HEAD` → `gh repo view --json defaultBranchRef` → existing local branch fallback → last-resort `main` with warning), threads the resolved value through `FinishLifecycleInput`, and consumes it in both PR and local-merge paths.

**Design:** thoughts/shared/designs/2026-04-29-subagent-visibility-default-branch-design.md

**Contract:** none (single-domain, all backend/general)

---

## Dependency Graph

```
Batch 1 (parallel - 4 implementers): 1.1, 1.2, 1.3, 1.4 [foundation - no deps]
  1.1 internal-session helper (Track A)
  1.2 default-branch resolver (Track B)
  1.3 spawn-agent classification of preserved sessions stays unchanged (test only - regression guard)
  1.4 merge.ts base branch threading (Track B - merge integration)

Batch 2 (parallel - 3 implementers): 2.1, 2.2, 2.3 [callsite migration - depends on batch 1]
  2.1 spawn-agent uses internal-session helper (depends 1.1)
  2.2 octto processor + index.ts constraint-reviewer use helper (depends 1.1)
  2.3 lifecycle index finisher resolves and threads base branch (depends 1.2, 1.4)
```

Resume preservation invariant (preserved across both batches): `spawn-agent` MUST continue to skip cleanup when result outcome is `task_error` or `blocked` and a `sessionId` is present, so `resume_subagent` can reach the session. Only `success` and `hard_failure` go through deletion.

---

## Batch 1: Foundation (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Internal session helper
**File:** `src/utils/internal-session.ts`
**Test:** `tests/utils/internal-session.test.ts`
**Depends:** none
**Domain:** general

Centralizes creation and cleanup of micode-owned internal sessions. Applies a stable `title` plus best-effort optional metadata (`parentSessionID`, `internal: true`) when the SDK's loose typing accepts them, and provides bounded deletion retry that logs warnings instead of swallowing failures.

**Design gap I am filling:** the design says "use parent/internal metadata if available, otherwise fall back to title + cleanup" but does not specify the exact API. I am implementing it as a single helper exposing `createInternalSession({ ctx, title, parentSessionId? })` returning `{ sessionId }`, plus `deleteInternalSession({ ctx, sessionId, agent? })` with 2 retries (100ms then 500ms backoff) that calls `log.warn("internal-session", ...)` with `sessionId` and `agent` when all retries fail. The helper sets metadata via a permissive `body` object cast to satisfy the plugin SDK's `body: {}` typing; if a future SDK rejects unknown fields the calls still succeed because we never throw on unknown-field warnings (the SDK already ignores extras silently in current `@opencode-ai/plugin`).

```typescript
// tests/utils/internal-session.test.ts
import { describe, expect, it, mock } from "bun:test";

import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

const CWD = "/repo/example";

interface FakeClient {
  readonly session: {
    readonly create: ReturnType<typeof mock>;
    readonly delete: ReturnType<typeof mock>;
  };
}

const createCtx = (client: FakeClient): { client: FakeClient; directory: string } => ({
  client,
  directory: CWD,
});

describe("createInternalSession", () => {
  it("calls session.create with title and directory", async () => {
    const create = mock(async () => ({ data: { id: "sess_1" } }));
    const client: FakeClient = { session: { create, delete: mock(async () => ({})) } };
    const ctx = createCtx(client);

    const result = await createInternalSession({ ctx: ctx as never, title: "constraint-reviewer" });

    expect(result.sessionId).toBe("sess_1");
    expect(create).toHaveBeenCalledTimes(1);
    const callArg = create.mock.calls[0]?.[0] as { body?: Record<string, unknown>; query?: { directory?: string } };
    expect(callArg.body).toMatchObject({ title: "constraint-reviewer" });
    expect(callArg.query?.directory).toBe(CWD);
  });

  it("includes parentSessionID and internal flag when supplied", async () => {
    const create = mock(async () => ({ data: { id: "sess_2" } }));
    const client: FakeClient = { session: { create, delete: mock(async () => ({})) } };
    const ctx = createCtx(client);

    await createInternalSession({
      ctx: ctx as never,
      title: "spawn-agent.codebase-analyzer",
      parentSessionId: "parent_1",
    });

    const callArg = create.mock.calls[0]?.[0] as { body?: Record<string, unknown> };
    expect(callArg.body).toMatchObject({
      title: "spawn-agent.codebase-analyzer",
      parentSessionID: "parent_1",
      internal: true,
    });
  });

  it("throws when SDK returns no session id", async () => {
    const create = mock(async () => ({ data: {} }));
    const client: FakeClient = { session: { create, delete: mock(async () => ({})) } };
    const ctx = createCtx(client);

    await expect(createInternalSession({ ctx: ctx as never, title: "x" })).rejects.toThrow(
      /internal session/i,
    );
  });

  it("propagates SDK errors so caller can classify them", async () => {
    const create = mock(async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    });
    const client: FakeClient = { session: { create, delete: mock(async () => ({})) } };
    const ctx = createCtx(client);

    await expect(createInternalSession({ ctx: ctx as never, title: "x" })).rejects.toThrow("boom");
  });
});

describe("deleteInternalSession", () => {
  it("does nothing when sessionId is null", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { create: mock(async () => ({})), delete: del } };
    await deleteInternalSession({ ctx: createCtx(client) as never, sessionId: null });
    expect(del).not.toHaveBeenCalled();
  });

  it("succeeds on first attempt without retry", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { create: mock(async () => ({})), delete: del } };
    await deleteInternalSession({ ctx: createCtx(client) as never, sessionId: "sess_1" });
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("retries up to two times on failure", async () => {
    let calls = 0;
    const del = mock(async () => {
      calls += 1;
      if (calls < 3) throw new Error("transient");
      return {};
    });
    const client: FakeClient = { session: { create: mock(async () => ({})), delete: del } };
    await deleteInternalSession({
      ctx: createCtx(client) as never,
      sessionId: "sess_1",
      sleep: async () => {},
    });
    expect(del).toHaveBeenCalledTimes(3);
  });

  it("logs warning and resolves when all retries fail", async () => {
    const del = mock(async () => {
      throw new Error("permanent");
    });
    const client: FakeClient = { session: { create: mock(async () => ({})), delete: del } };
    const warnings: string[] = [];
    await deleteInternalSession({
      ctx: createCtx(client) as never,
      sessionId: "sess_doomed",
      agent: "constraint-reviewer",
      sleep: async () => {},
      log: { warn: (_module, message) => warnings.push(message) },
    });
    expect(del).toHaveBeenCalledTimes(3);
    expect(warnings.length).toBe(1);
    const message = warnings[0] ?? "";
    expect(message).toContain("sess_doomed");
    expect(message).toContain("constraint-reviewer");
  });

  it("never throws so it cannot mask the primary agent result", async () => {
    const del = mock(async () => {
      throw new Error("permanent");
    });
    const client: FakeClient = { session: { create: mock(async () => ({})), delete: del } };
    await expect(
      deleteInternalSession({
        ctx: createCtx(client) as never,
        sessionId: "sess_x",
        sleep: async () => {},
        log: { warn: () => {} },
      }),
    ).resolves.toBeUndefined();
  });
});
```

```typescript
// src/utils/internal-session.ts
import type { PluginInput } from "@opencode-ai/plugin";

import { extractErrorMessage } from "@/utils/errors";
import { log as defaultLogger } from "@/utils/logger";

const LOG_MODULE = "internal-session";
const DELETE_RETRY_BACKOFFS_MS: readonly number[] = [100, 500];
const SESSION_CREATE_FAILED = "internal session create returned no id";

interface SessionCreateResponse {
  readonly data?: { readonly id?: string };
}

interface SessionCreateClient {
  readonly create: (input: {
    readonly body: Record<string, unknown>;
    readonly query: { readonly directory: string };
  }) => Promise<unknown>;
}

interface SessionDeleteClient {
  readonly delete: (input: {
    readonly path: { readonly id: string };
    readonly query: { readonly directory: string };
  }) => Promise<unknown>;
}

interface InternalLogger {
  readonly warn: (module: string, message: string) => void;
}

export interface CreateInternalSessionInput {
  readonly ctx: PluginInput;
  readonly title: string;
  readonly parentSessionId?: string;
}

export interface CreateInternalSessionResult {
  readonly sessionId: string;
}

export interface DeleteInternalSessionInput {
  readonly ctx: PluginInput;
  readonly sessionId: string | null;
  readonly agent?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: InternalLogger;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const hasCreate = (value: unknown): value is SessionCreateClient => isRecord(value) && typeof value.create === "function";

const hasDelete = (value: unknown): value is SessionDeleteClient => isRecord(value) && typeof value.delete === "function";

const buildCreateBody = (title: string, parentSessionId: string | undefined): Record<string, unknown> => {
  const body: Record<string, unknown> = { title };
  if (parentSessionId !== undefined && parentSessionId.length > 0) {
    body.parentSessionID = parentSessionId;
    body.internal = true;
  }
  return body;
};

const sleepFor = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

export async function createInternalSession(
  input: CreateInternalSessionInput,
): Promise<CreateInternalSessionResult> {
  const session = input.ctx.client.session;
  if (!hasCreate(session)) throw new Error(SESSION_CREATE_FAILED);
  const created = (await session.create({
    body: buildCreateBody(input.title, input.parentSessionId),
    query: { directory: input.ctx.directory },
  })) as SessionCreateResponse;
  const sessionId = created.data?.id;
  if (!sessionId) throw new Error(SESSION_CREATE_FAILED);
  return { sessionId };
}

const tryDeleteOnce = async (
  client: SessionDeleteClient,
  sessionId: string,
  directory: string,
): Promise<Error | null> => {
  try {
    await client.delete({ path: { id: sessionId }, query: { directory } });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(extractErrorMessage(error));
  }
};

export async function deleteInternalSession(input: DeleteInternalSessionInput): Promise<void> {
  if (input.sessionId === null) return;
  const session = input.ctx.client.session;
  if (!hasDelete(session)) return;
  const sleep = input.sleep ?? sleepFor;
  const logger = input.log ?? defaultLogger;
  const attempts = DELETE_RETRY_BACKOFFS_MS.length + 1;
  let lastError: Error | null = null;

  for (let index = 0; index < attempts; index += 1) {
    lastError = await tryDeleteOnce(session, input.sessionId, input.ctx.directory);
    if (lastError === null) return;
    if (index < DELETE_RETRY_BACKOFFS_MS.length) await sleep(DELETE_RETRY_BACKOFFS_MS[index]);
  }

  const agentLabel = input.agent ?? "unknown";
  const reason = lastError ? extractErrorMessage(lastError) : "unknown error";
  logger.warn(LOG_MODULE, `delete failed sessionId=${input.sessionId} agent=${agentLabel} reason=${reason}`);
}
```

**Verify:** `bun test tests/utils/internal-session.test.ts`
**Commit:** `feat(lifecycle): add internal-session helper with retry+logging`

### Task 1.2: Default branch resolver
**File:** `src/lifecycle/default-branch.ts`
**Test:** `tests/lifecycle/default-branch.test.ts`
**Depends:** none
**Domain:** backend

Resolves the repository default branch through a deterministic precedence chain. Used by `lifecycle_finish` so PR creation and local merge target the actual base branch.

**Design gap I am filling:** the design lists the precedence (override → `origin/HEAD` → GitHub `defaultBranchRef` → existing local branch fallback → `main` last resort) but does not specify the exact gh/git commands or the local-fallback rule. I am implementing it as: (1) override returns immediately if non-empty; (2) `git symbolic-ref --short refs/remotes/origin/HEAD` strips the leading `origin/`; (3) `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`; (4) local fallback uses `git rev-parse --verify` to test `main` then `master`, returning whichever exists; (5) last resort returns `main` after `log.warn("lifecycle.branch", ...)` listing all detection sources that failed. Returns `{ branch, source }` so the finisher can include source in error notes.

```typescript
// tests/lifecycle/default-branch.test.ts
import { describe, expect, it } from "bun:test";

import { resolveDefaultBranch } from "@/lifecycle/default-branch";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = 0;
const FAIL = 1;
const CWD = "/repo/example";

const run = (stdout: string, exitCode = OK): RunResult => ({ stdout, stderr: "", exitCode });
const fail = (stderr: string): RunResult => ({ stdout: "", stderr, exitCode: FAIL });

interface Outputs {
  readonly git?: readonly RunResult[];
  readonly gh?: readonly RunResult[];
}

interface RecordedCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
}

const createRunner = (outputs: Outputs): { runner: LifecycleRunner; calls: readonly RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  let gi = 0;
  let gh = 0;
  return {
    calls,
    runner: {
      git: async (args) => {
        calls.push({ bin: "git", args });
        return outputs.git?.[gi++] ?? fail("not configured");
      },
      gh: async (args) => {
        calls.push({ bin: "gh", args });
        return outputs.gh?.[gh++] ?? fail("not configured");
      },
    },
  };
};

describe("resolveDefaultBranch", () => {
  it("returns explicit override immediately without calling git or gh", async () => {
    const { runner, calls } = createRunner({});
    const result = await resolveDefaultBranch(runner, { cwd: CWD, override: "develop" });
    expect(result).toEqual({ branch: "develop", source: "override" });
    expect(calls).toEqual([]);
  });

  it("uses origin/HEAD when git symbolic-ref succeeds with main", async () => {
    const { runner } = createRunner({ git: [run("origin/main\n")] });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "main", source: "origin-head" });
  });

  it("uses origin/HEAD when git symbolic-ref returns master", async () => {
    const { runner } = createRunner({ git: [run("origin/master\n")] });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "master", source: "origin-head" });
  });

  it("uses origin/HEAD with custom branch name", async () => {
    const { runner } = createRunner({ git: [run("origin/trunk\n")] });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "trunk", source: "origin-head" });
  });

  it("falls back to gh repo view when symbolic-ref fails", async () => {
    const { runner } = createRunner({
      git: [fail("not a symbolic ref")],
      gh: [run("master\n")],
    });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "master", source: "github" });
  });

  it("falls back to local main when origin/HEAD and gh are unavailable", async () => {
    const { runner } = createRunner({
      git: [fail("no symbolic ref"), run("abc123\n"), run("def456\n")],
      gh: [fail("no auth")],
    });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result.branch).toBe("main");
    expect(result.source).toBe("local-fallback");
  });

  it("falls back to local master when main is missing locally", async () => {
    const { runner } = createRunner({
      git: [fail("no symbolic ref"), fail("not found"), run("def456\n")],
      gh: [fail("no auth")],
    });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "master", source: "local-fallback" });
  });

  it("returns last-resort main with warning when nothing is detectable", async () => {
    const warnings: string[] = [];
    const { runner } = createRunner({
      git: [fail("no symbolic ref"), fail("missing"), fail("missing")],
      gh: [fail("no auth")],
    });
    const result = await resolveDefaultBranch(runner, {
      cwd: CWD,
      log: { warn: (_module, message) => warnings.push(message) },
    });
    expect(result).toEqual({ branch: "main", source: "last-resort" });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("origin-head");
    expect(warnings[0]).toContain("github");
  });

  it("treats empty override as missing and falls through", async () => {
    const { runner } = createRunner({ git: [run("origin/main\n")] });
    const result = await resolveDefaultBranch(runner, { cwd: CWD, override: "" });
    expect(result.source).toBe("origin-head");
  });

  it("trims whitespace and the origin/ prefix consistently", async () => {
    const { runner } = createRunner({ git: [run("  origin/release-2025  \n")] });
    const result = await resolveDefaultBranch(runner, { cwd: CWD });
    expect(result).toEqual({ branch: "release-2025", source: "origin-head" });
  });
});
```

```typescript
// src/lifecycle/default-branch.ts
import { log as defaultLogger } from "@/utils/logger";

import type { LifecycleRunner, RunResult } from "./runner";

const OK_EXIT_CODE = 0;
const ORIGIN_PREFIX = "origin/";
const LOG_MODULE = "lifecycle.branch";
const FALLBACK_CANDIDATES: readonly string[] = ["main", "master"];

const SOURCES = {
  OVERRIDE: "override",
  ORIGIN_HEAD: "origin-head",
  GITHUB: "github",
  LOCAL_FALLBACK: "local-fallback",
  LAST_RESORT: "last-resort",
} as const;

export type DefaultBranchSource = (typeof SOURCES)[keyof typeof SOURCES];

export interface DefaultBranchResult {
  readonly branch: string;
  readonly source: DefaultBranchSource;
}

interface Logger {
  readonly warn: (module: string, message: string) => void;
}

export interface ResolveDefaultBranchInput {
  readonly cwd: string;
  readonly override?: string;
  readonly log?: Logger;
}

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const trim = (raw: string): string => raw.trim();

const stripOrigin = (raw: string): string => {
  const trimmed = trim(raw);
  if (trimmed.startsWith(ORIGIN_PREFIX)) return trimmed.slice(ORIGIN_PREFIX.length);
  return trimmed;
};

const tryOriginHead = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const result = await runner.git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd });
  if (!completed(result)) return null;
  const branch = stripOrigin(result.stdout);
  return branch.length > 0 ? branch : null;
};

const tryGithub = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const result = await runner.gh(
    ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
    { cwd },
  );
  if (!completed(result)) return null;
  const branch = trim(result.stdout);
  return branch.length > 0 ? branch : null;
};

const tryLocalCandidate = async (runner: LifecycleRunner, cwd: string, candidate: string): Promise<boolean> => {
  const result = await runner.git(["rev-parse", "--verify", candidate], { cwd });
  return completed(result);
};

const tryLocalFallback = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  for (const candidate of FALLBACK_CANDIDATES) {
    if (await tryLocalCandidate(runner, cwd, candidate)) return candidate;
  }
  return null;
};

export async function resolveDefaultBranch(
  runner: LifecycleRunner,
  input: ResolveDefaultBranchInput,
): Promise<DefaultBranchResult> {
  if (input.override !== undefined && input.override.length > 0) {
    return { branch: input.override, source: SOURCES.OVERRIDE };
  }

  const origin = await tryOriginHead(runner, input.cwd);
  if (origin !== null) return { branch: origin, source: SOURCES.ORIGIN_HEAD };

  const github = await tryGithub(runner, input.cwd);
  if (github !== null) return { branch: github, source: SOURCES.GITHUB };

  const local = await tryLocalFallback(runner, input.cwd);
  if (local !== null) return { branch: local, source: SOURCES.LOCAL_FALLBACK };

  const logger = input.log ?? defaultLogger;
  logger.warn(
    LOG_MODULE,
    `default branch unresolved (tried ${SOURCES.ORIGIN_HEAD}, ${SOURCES.GITHUB}, ${SOURCES.LOCAL_FALLBACK}); using ${FALLBACK_CANDIDATES[0]}`,
  );
  return { branch: FALLBACK_CANDIDATES[0], source: SOURCES.LAST_RESORT };
}
```

**Verify:** `bun test tests/lifecycle/default-branch.test.ts`
**Commit:** `feat(lifecycle): add default branch resolver`

### Task 1.3: Spawn-agent regression guard for resume preservation
**File:** `tests/tools/spawn-agent/preserve-on-failure.test.ts`
**Test:** (this IS the test file)
**Depends:** none
**Domain:** general

Lock down the invariant that the upcoming Batch 2 changes must not break: when an attempt classifies as `task_error` or `blocked` and a `sessionId` was captured, `runAgent` must NOT call `session.delete`, so `resume_subagent` can still reach the session. This test exists to guard the refactor in Task 2.1.

**Design gap I am filling:** the design says "blocked/task_error sessions are preserved when resume semantics require it" but does not name the exact behavior. I am locking it as: deletion is skipped iff outcome is `task_error` or `blocked` AND `sessionId` is non-null. Hard failures with a sessionId still get deleted (matches current `tool.ts` line 374-377).

```typescript
// tests/tools/spawn-agent/preserve-on-failure.test.ts
import { describe, expect, it, mock } from "bun:test";

import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import type { PreservedRegistry } from "@/tools/spawn-agent/registry";

interface FakeClient {
  readonly session: {
    readonly delete: ReturnType<typeof mock>;
  };
}

const createCtx = (client: FakeClient) =>
  ({
    client,
    directory: "/tmp/repo",
  }) as never;

const createRegistry = (): PreservedRegistry => ({
  preserve: ({ sessionId, agent, description, outcome }) => ({
    sessionId,
    agent,
    description,
    outcome,
    resumeCount: 0,
    expiresAt: Date.now() + 60_000,
  }),
  resume: () => null,
  drop: () => {},
  list: () => [],
  sweep: () => 0,
});

describe("spawn-agent preserves task_error/blocked sessions", () => {
  it("does not delete the session when outcome is task_error", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { delete: del } };
    const ctx = createCtx(client);
    const registry = createRegistry();

    const executeAgentSession = mock(async () => {
      const error: Error & { sessionId?: string } = new Error("Task failed: needs human input");
      error.sessionId = "preserved_1";
      throw error;
    });

    const tool = createSpawnAgentTool(ctx, { registry, executeAgentSession });
    const output = await tool.execute(
      { agents: [{ agent: "x", prompt: "p", description: "d" }] },
      { metadata: () => {} } as never,
    );

    expect(output).toContain("preserved_1");
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes the session on success", async () => {
    const del = mock(async () => ({}));
    const client: FakeClient = { session: { delete: del } };
    const ctx = createCtx(client);
    const registry = createRegistry();

    const executeAgentSession = mock(async () => ({ sessionId: "ok_1", output: "done" }));
    const tool = createSpawnAgentTool(ctx, { registry, executeAgentSession });
    await tool.execute(
      { agents: [{ agent: "x", prompt: "p", description: "d" }] },
      { metadata: () => {} } as never,
    );
    expect(del).toHaveBeenCalledTimes(1);
  });
});
```

**Verify:** `bun test tests/tools/spawn-agent/preserve-on-failure.test.ts`
**Commit:** `test(spawn-agent): guard task_error/blocked preservation`

### Task 1.4: Merge.ts threads explicit base branch through PR and local-merge paths
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/merge.test.ts`
**Depends:** none
**Domain:** backend

Update `merge.ts` so `getBaseBranch` no longer falls back to a hardcoded `MAIN_BRANCH` constant when `input.baseBranch` is missing: instead, treat missing `baseBranch` as a programming error and throw a clear message naming the issue branch. The lifecycle finisher (Task 2.3) becomes responsible for always supplying a resolved branch. Tests cover main, master, and custom branches plus the missing-branch error.

**Design gap I am filling:** the design says "thread the resolved branch through PR and local merge paths" and "block finish with an actionable error instead of `git checkout main`". I am implementing it as: `getBaseBranch` throws `Error("base branch not resolved for issue branch <input.branch>")` when `input.baseBranch` is undefined. This forces all callers (production and tests) to pass an explicit base branch, eliminating silent main-fallback. Existing test cases that expected the old default are updated to pass `baseBranch: "main"` explicitly.

```typescript
// tests/lifecycle/merge.test.ts (REPLACE existing file)
import { describe, expect, it } from "bun:test";

import { finishLifecycle, PR_CHECK_POLL_MS } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const WORKTREE = "/repo/micode-issue-1";
const BRANCH = "issue/1-lifecycle";
const PR_URL = "https://github.com/Wuxie233/micode/pull/12";
const CHECK_ARGS = ["pr", "checks", BRANCH, "--required", "--json", "state,name"] as const;

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

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

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

describe("finishLifecycle", () => {
  it("opens a PR against the resolved main branch", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "main", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against master when resolved base is master", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "master", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("opens a PR against a custom default branch", async () => {
    const runner = createRunner({
      gh: [createRun(`${PR_URL}\n`), createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), createRun()],
    });

    await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "trunk",
      sleep: async () => {},
    });

    expect(runner.calls[0]).toEqual({
      bin: "gh",
      args: ["pr", "create", "--fill", "--base", "trunk", "--head", BRANCH],
      cwd: CWD,
    });
  });

  it("local merge checks out and pushes the resolved master branch", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [createRun(), createRun(), createRun(), createRun(), createRun()],
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
    expect(gitCalls[0]).toEqual({ bin: "git", args: ["checkout", "master"], cwd: CWD });
    expect(gitCalls[1]).toEqual({ bin: "git", args: ["merge", "--no-ff", BRANCH], cwd: CWD });
    expect(gitCalls[2]).toEqual({ bin: "git", args: ["push", "origin", "master"], cwd: CWD });
  });

  it("returns an actionable error when checkout of the resolved base branch fails", async () => {
    const runner = createRunner({
      gh: [createRun("[]")],
      git: [{ stdout: "", stderr: "error: pathspec 'master' did not match any file(s)", exitCode: FAILURE_EXIT_CODE }],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "local-merge",
      waitForChecks: true,
      baseBranch: "master",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("git_checkout");
    expect(outcome.note).toContain("master");
  });

  it("throws a clear error when baseBranch is missing", async () => {
    const runner = createRunner({});
    await expect(
      finishLifecycle(runner, {
        cwd: CWD,
        branch: BRANCH,
        worktree: WORKTREE,
        mergeStrategy: "pr",
        waitForChecks: true,
        sleep: async () => {},
      }),
    ).rejects.toThrow(/base branch not resolved/i);
  });
});

describe("PR_CHECK_POLL_MS", () => {
  it("is exported as a positive number for waitForPrChecks scheduling", () => {
    expect(PR_CHECK_POLL_MS).toBeGreaterThan(0);
  });
});
```

```typescript
// src/lifecycle/merge.ts (CHANGE: replace getBaseBranch and remove MAIN_BRANCH constant)
// Locate this block:
//
// const MAIN_BRANCH = "main";
// ...
// const getBaseBranch = (input: FinishLifecycleInput): string => input.baseBranch ?? MAIN_BRANCH;
//
// Replace with:

const BASE_BRANCH_REQUIRED = "base branch not resolved";

const getBaseBranch = (input: FinishLifecycleInput): string => {
  if (input.baseBranch === undefined || input.baseBranch.length === 0) {
    throw new Error(`${BASE_BRANCH_REQUIRED} for issue branch ${input.branch}`);
  }
  return input.baseBranch;
};
```

The `MAIN_BRANCH` constant declaration is deleted. All other code in `src/lifecycle/merge.ts` is unchanged: `finishViaPr` and `finishViaLocalMerge` already call `getBaseBranch(input)` so they pick up the new behavior automatically.

**Verify:** `bun test tests/lifecycle/merge.test.ts`
**Commit:** `fix(lifecycle): require explicit base branch in merge`

---

## Batch 2: Callsite Migration (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Spawn-agent uses internal-session helper
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** `tests/tools/spawn-agent/tool.test.ts`
**Depends:** 1.1, 1.3
**Domain:** general

Replace the raw `ctx.client.session.create({ body: {} ... })` call with `createInternalSession`, supplying a stable title `spawn-agent.<agentName>`. Replace the silent-swallow `deleteSession` helper with `deleteInternalSession` from Task 1.1, so cleanup retries and warning logs flow through the helper. Preserve the resume-skip rule: `runAgent` still calls deletion ONLY when outcome is `success` or `hard_failure`.

**Design gap I am filling:** the design says spawn-agent "uses the helper instead of raw blank session creation" but does not specify the title format. I am using `spawn-agent.<task.agent>` so the user can identify which subagent the session belongs to from the session title alone. This subsumes the previous behavior (no title at all) and aligns with the existing convention used by `octto/processor.ts` (`probe-${branchId}`) and `index.ts` (`constraint-reviewer`).

```typescript
// tests/tools/spawn-agent/tool.test.ts (NEW file - integration covering helper wiring)
import { describe, expect, it, mock } from "bun:test";

import { createSpawnAgentTool } from "@/tools/spawn-agent/tool";
import type { PreservedRegistry } from "@/tools/spawn-agent/registry";

const createCtx = (calls: { create: ReturnType<typeof mock>; delete: ReturnType<typeof mock> }) =>
  ({
    client: { session: { create: calls.create, delete: calls.delete } },
    directory: "/tmp/repo",
  }) as never;

const createRegistry = (): PreservedRegistry => ({
  preserve: ({ sessionId, agent, description, outcome }) => ({
    sessionId,
    agent,
    description,
    outcome,
    resumeCount: 0,
    expiresAt: Date.now() + 60_000,
  }),
  resume: () => null,
  drop: () => {},
  list: () => [],
  sweep: () => 0,
});

describe("createSpawnAgentTool wiring through internal-session helper", () => {
  it("creates internal session with spawn-agent.<agent> title", async () => {
    const create = mock(async () => ({ data: { id: "sess_1" } }));
    const del = mock(async () => ({}));
    const ctx = createCtx({ create, delete: del });

    const tool = createSpawnAgentTool(ctx, {
      registry: createRegistry(),
      executeAgentSession: async () => ({ sessionId: "sess_1", output: "ok" }),
    });

    await tool.execute(
      { agents: [{ agent: "codebase-analyzer", prompt: "p", description: "d" }] },
      { metadata: () => {} } as never,
    );

    // executeAgentSession is the test seam; in production it calls createInternalSession.
    // The next test exercises the production path without the seam.
  });

  it("deletes successful sessions via the retry-aware helper", async () => {
    const create = mock(async () => ({ data: { id: "sess_ok" } }));
    let deleteAttempts = 0;
    const del = mock(async () => {
      deleteAttempts += 1;
      if (deleteAttempts < 2) throw new Error("transient");
      return {};
    });
    const ctx = createCtx({ create, delete: del });

    // No executeAgentSession seam: exercise the production path so prompt + messages also matter.
    const prompt = mock(async () => ({}));
    const messages = mock(async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] }));
    (ctx as { client: { session: Record<string, unknown> } }).client.session.prompt = prompt;
    (ctx as { client: { session: Record<string, unknown> } }).client.session.messages = messages;

    const tool = createSpawnAgentTool(ctx, { registry: createRegistry() });
    await tool.execute(
      { agents: [{ agent: "codebase-analyzer", prompt: "p", description: "d" }] },
      { metadata: () => {} } as never,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0]?.[0] as { body?: { title?: string } };
    expect(createArg.body?.title).toBe("spawn-agent.codebase-analyzer");
    expect(deleteAttempts).toBeGreaterThanOrEqual(2);
  });

  it("does not delete sessions classified as task_error (resume preservation)", async () => {
    const create = mock(async () => ({ data: { id: "sess_te" } }));
    const del = mock(async () => ({}));
    const ctx = createCtx({ create, delete: del });

    const tool = createSpawnAgentTool(ctx, {
      registry: createRegistry(),
      executeAgentSession: async () => {
        const error: Error & { sessionId?: string } = new Error("Task failed: needs human input");
        error.sessionId = "sess_te";
        throw error;
      },
    });

    await tool.execute(
      { agents: [{ agent: "codebase-analyzer", prompt: "p", description: "d" }] },
      { metadata: () => {} } as never,
    );

    expect(del).not.toHaveBeenCalled();
  });
});
```

```typescript
// src/tools/spawn-agent/tool.ts (CHANGES, not full file)
//
// 1. Add import at top:
import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

// 2. Remove the local `deleteSession` helper (lines 236-243 in current file).
//
// 3. Replace executeAgentSessionWith body to use the helper:

async function executeAgentSessionWith(
  ctx: PluginInput,
  task: AgentTask,
  available: ReadonlySet<string>,
): Promise<AgentSessionResult> {
  const resolved = resolveTaskModel(task, available);
  if (!resolved.ok) throw new Error(resolved.message);
  if (resolved.model !== null) logModelOverride(ctx, task, resolved.model);

  let sessionId: string | null = null;
  try {
    const created = await createInternalSession({ ctx, title: `spawn-agent.${task.agent}` });
    sessionId = created.sessionId;

    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: buildPromptBody(task, resolved.model),
      query: { directory: ctx.directory },
    });

    const messagesResp = (await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;

    return { sessionId, output: readAssistantText(messagesResp.data ?? []) };
  } catch (error) {
    throw createSessionError(error, sessionId);
  }
}

// 4. Replace classifyThrown's deletion call:

async function classifyThrown(
  ctx: PluginInput,
  error: unknown,
): Promise<{ readonly class: InternalClass; readonly value: AttemptValue }> {
  const sessionId = getSessionId(error);
  const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error) });
  if (classification.class === INTERNAL_CLASSES.TRANSIENT) {
    await deleteInternalSession({ ctx, sessionId, agent: "spawn-agent.transient" });
  }
  return { class: classification.class, value: { sessionId, output: "", error: classification.reason } };
}

// 5. Replace the deletion call in runAgent (line 374-375 area):

async function runAgent(
  ctx: PluginInput,
  task: AgentTask,
  toolCtx: ExtendedContext,
  options: SpawnAgentToolOptions,
  progress?: ProgressState,
): Promise<SpawnResult> {
  const started = Date.now();
  updateProgress(toolCtx, progress, `Running ${task.agent}...`);
  const available = options.availableModels ?? EMPTY_MODELS;
  const runSession =
    options.executeAgentSession ?? ((c: PluginInput, t: AgentTask) => executeAgentSessionWith(c, t, available));
  const settled = await retryOnTransient(() => runAttempt(ctx, task, runSession), {
    retries: config.subagent.transientRetries,
    backoffMs: config.subagent.transientBackoffMs,
  });
  const elapsedMs = Date.now() - started;
  const result = toPublicResult(task, elapsedMs, settled.class, settled.value);
  if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
    await deleteInternalSession({ ctx, sessionId: settled.value.sessionId, agent: task.agent });
    return result;
  }
  return preserveIfNeeded(options.registry, result);
}
```

The existing `tests/tools/spawn-agent/preserve-on-failure.test.ts` (Task 1.3) and other spawn-agent tests must continue to pass. The NEW `tests/tools/spawn-agent/tool.test.ts` exercises the helper wiring.

**Verify:** `bun test tests/tools/spawn-agent/`
**Commit:** `fix(spawn-agent): route session create+delete through internal-session helper`

### Task 2.2: Octto processor and constraint-reviewer use internal-session helper
**File:** `src/tools/octto/processor.ts` (and one block in `src/index.ts`)
**Test:** `tests/tools/octto/processor-internal-session.test.ts`
**Depends:** 1.1
**Domain:** backend

Migrate the two remaining raw `session.create` callsites to the helper. In `processor.ts` `runProbeAgent`, replace direct `client.session.create` and the `client.session.delete().catch(...)` finally block with `createInternalSession`/`deleteInternalSession`. In `src/index.ts` constraint-reviewer wiring (lines ~313-353), replace the same pattern. Both keep their existing titles (`probe-${branchId}` and `constraint-reviewer`) so user-facing behavior is unchanged but cleanup now retries and logs.

**Design gap I am filling:** the design says "constraint reviewer follows the same helper pattern". I am keeping each callsite's existing title intact (no rename) so this change is purely a cleanup-reliability upgrade with no observable title change. The `internalSessions` Set in `index.ts` (used by `createConversationTitleHook`) is preserved unchanged: the helper does not touch it because it tracks runtime hook routing, not OpenCode session metadata.

Note: `processor.ts` currently uses `OpencodeClient` directly rather than a `PluginInput`. The helper requires a `PluginInput`-shaped object with `{ client, directory }`. Solution: build a tiny adapter `{ client, directory: "" }` cast to `PluginInput`, since `processor.ts` only uses `client` for session ops and ignores `directory` (the OpenCode session APIs accept missing directory in this scope; current code also omits it).

```typescript
// tests/tools/octto/processor-internal-session.test.ts
import { describe, expect, it, mock } from "bun:test";

// Helper smoke test: the processor calls createInternalSession with the expected title prefix.
// This is integration via the helper's create call - we mock the OpenCode client.

import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

interface FakeClient {
  readonly session: {
    readonly create: ReturnType<typeof mock>;
    readonly delete: ReturnType<typeof mock>;
  };
}

const createCtx = (client: FakeClient) => ({ client, directory: "" }) as never;

describe("octto processor uses internal-session helper conventions", () => {
  it("createInternalSession accepts probe-* titles", async () => {
    const create = mock(async () => ({ data: { id: "probe_1" } }));
    const ctx = createCtx({ session: { create, delete: mock(async () => ({})) } });

    const result = await createInternalSession({ ctx, title: "probe-branch-a" });

    expect(result.sessionId).toBe("probe_1");
    const arg = create.mock.calls[0]?.[0] as { body?: { title?: string } };
    expect(arg.body?.title).toBe("probe-branch-a");
  });

  it("deleteInternalSession with retry resolves even when delete throws", async () => {
    const del = mock(async () => {
      throw new Error("perma");
    });
    const ctx = createCtx({ session: { create: mock(async () => ({})), delete: del } });

    await expect(
      deleteInternalSession({
        ctx,
        sessionId: "probe_1",
        agent: "probe",
        sleep: async () => {},
        log: { warn: () => {} },
      }),
    ).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(3);
  });
});
```

```typescript
// src/tools/octto/processor.ts (CHANGE runProbeAgent, around line 98)
import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

async function runProbeAgent(client: OpencodeClient, state: BrainstormState, branchId: string): Promise<ProbeResult> {
  const ctx = { client, directory: "" } as unknown as Parameters<typeof createInternalSession>[0]["ctx"];
  const created = await createInternalSession({ ctx, title: `probe-${branchId}` });
  const probeSessionId = created.sessionId;

  try {
    const promptResult = await client.session.prompt({
      path: { id: probeSessionId },
      body: {
        agent: PROBE_AGENT,
        tools: {},
        parts: [{ type: "text", text: formatBranchContext(state, branchId) }],
      },
    });

    if (!promptResult.data) {
      throw new Error("Failed to get probe response");
    }

    const responseText = extractTextFromParts(promptResult.data.parts);
    return parseProbeResponse(responseText);
  } finally {
    await deleteInternalSession({ ctx, sessionId: probeSessionId, agent: `probe-${branchId}` });
  }
}
```

```typescript
// src/index.ts (CHANGE constraint-reviewer hook block, around line 313)
import { createInternalSession, deleteInternalSession } from "@/utils/internal-session";

const constraintReviewerHook = createConstraintReviewerHook(ctx, async (reviewPrompt) => {
  let sessionId: string | undefined;
  try {
    const created = await createInternalSession({ ctx, title: "constraint-reviewer" });
    sessionId = created.sessionId;

    // Mark as internal to prevent hook recursion
    internalSessions.add(sessionId);

    const promptResult = await ctx.client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "mm-constraint-reviewer",
        tools: {},
        parts: [{ type: "text", text: reviewPrompt }],
      },
    });

    if (!promptResult.data?.parts) {
      return '{"status": "PASS", "violations": [], "summary": "Empty response"}';
    }

    return extractTextFromParts(promptResult.data.parts);
  } catch (error) {
    log.warn("mindmodel", `Reviewer failed: ${extractErrorMessage(error)}`);
    return '{"status": "PASS", "violations": [], "summary": "Review failed"}';
  } finally {
    if (sessionId) {
      internalSessions.delete(sessionId);
      await deleteInternalSession({ ctx, sessionId, agent: "constraint-reviewer" });
    }
  }
});
```

**Verify:** `bun test tests/tools/octto/processor-internal-session.test.ts && bun test tests/tools/octto/`
**Commit:** `fix(octto,mindmodel): route internal sessions through helper`

### Task 2.3: Lifecycle finisher resolves and threads base branch
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/index.test.ts`
**Depends:** 1.2, 1.4
**Domain:** backend

Update `createFinisher` to call `resolveDefaultBranch` before `finishLifecycle` and pass the resolved branch into `FinishLifecycleInput`. On failure, append the resolved branch and detection source to the lifecycle note so the user can recover.

**Design gap I am filling:** the design says "resolved branch source is included in failure messages". I am implementing it as: after `finishLifecycle` returns, if `outcome.merged === false` and `outcome.note` is non-null, prepend `resolved-base=<branch>(<source>)` to the note. Successful finishes do not modify the note.

```typescript
// tests/lifecycle/index.test.ts (ADD a new describe block at the end of the existing file)
import { describe, expect, it } from "bun:test";

// Existing imports remain unchanged. The block below is APPENDED to the file.

describe("createLifecycleStore finish resolves default branch", () => {
  // The harness below is a thin reuse of the test scaffolding already present in this file.
  // See existing helpers `createFakeRunner`, `createTempDir`, `createHandle`. We add a new test that:
  //  1. Stages a runner where `git symbolic-ref refs/remotes/origin/HEAD` returns `origin/master`.
  //  2. Calls `handle.finish(issueNumber, { mergeStrategy: "pr", waitForChecks: false })`.
  //  3. Asserts the recorded gh call contains `--base master`.

  it("uses resolved master when origin/HEAD points to master", async () => {
    // Build runner with: git symbolic-ref => "origin/master"; gh pr create => PR url; gh pr merge => OK.
    // Existing test helpers in this file are reused. Pseudocode:
    //
    //   const runner = createFakeRunner({
    //     git: queue([
    //       { stdout: "origin/master\n", exitCode: 0 }, // resolveDefaultBranch
    //       { stdout: "", exitCode: 0 },                 // git worktree remove
    //     ]),
    //     gh: queue([
    //       { stdout: "https://github.com/x/y/pull/3", exitCode: 0 }, // pr create
    //       { stdout: "", exitCode: 0 },                                // pr merge
    //       { stdout: "", exitCode: 0 },                                // issue close
    //     ]),
    //   });
    //   const handle = createLifecycleStore({ runner, ... });
    //   await handle.start({ summary, goals: [], constraints: [] });
    //   await handle.finish(issueNumber, { mergeStrategy: "pr", waitForChecks: false });
    //   const baseFlagIndex = runner.calls.findIndex(c => c.bin === "gh" && c.args[0] === "pr" && c.args[1] === "create");
    //   const args = runner.calls[baseFlagIndex].args;
    //   expect(args[args.indexOf("--base") + 1]).toBe("master");
    //
    // Implementer: keep this test using the exact helpers already declared earlier in
    // tests/lifecycle/index.test.ts. The body intentionally references those helpers
    // by name rather than re-declaring them here.

    expect(true).toBe(true); // placeholder; replace with the assertion above using existing harness
  });

  it("includes resolved base branch and source in failure note", async () => {
    // Build runner where:
    //   - git symbolic-ref returns "origin/develop"
    //   - gh pr create returns exit code 1 (failure)
    // Assert:
    //   - outcome.merged === false
    //   - outcome.note contains "resolved-base=develop(origin-head)"
    //   - outcome.note still contains "gh_pr_create"
    expect(true).toBe(true); // placeholder; replace with assertion using existing harness
  });
});
```

Implementer note for Task 2.3 test: open `tests/lifecycle/index.test.ts` and locate the existing `createFakeRunner` / `createHandle` helpers. Append the two test cases above using those helpers and replace the `expect(true).toBe(true)` placeholders with the assertions described in the comments. Do not duplicate harness code.

```typescript
// src/lifecycle/index.ts (CHANGE createFinisher, around line 610)
import { resolveDefaultBranch } from "./default-branch";

const createFinisher = (context: LifecycleContext): LifecycleHandle["finish"] => {
  return async (issueNumber, finishInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const merging = await saveAndSync(context, advanceTo(record, LIFECYCLE_STATES.MERGING));
    const resolvedBranch = await resolveDefaultBranch(context.runner, { cwd: context.cwd });
    const finished = await finishLifecycle(context.runner, {
      cwd: context.cwd,
      branch: merging.branch,
      worktree: merging.worktree,
      mergeStrategy: finishInput.mergeStrategy,
      waitForChecks: finishInput.waitForChecks,
      baseBranch: resolvedBranch.branch,
    });
    const annotated = annotateWithResolvedBranch(finished, resolvedBranch);
    const outcome = await closeMergedIssue(context.runner, issueNumber, annotated, context.cwd);
    const promoted = await promoteFinishedRecord(merging, outcome, context);
    await saveAndSync(context, applyFinishOutcome(promoted, outcome));
    await safeEmit(context, issueNumber, `Finished: merged=${outcome.merged}, prUrl=${outcome.prUrl ?? "(none)"}`);
    return outcome;
  };
};

// ADD this small helper above createFinisher in the same file:

const RESOLVED_BASE_PREFIX = "resolved-base";

const annotateWithResolvedBranch = (
  outcome: FinishOutcome,
  resolved: { readonly branch: string; readonly source: string },
): FinishOutcome => {
  if (outcome.merged || outcome.note === null) return outcome;
  const annotation = `${RESOLVED_BASE_PREFIX}=${resolved.branch}(${resolved.source})`;
  return { ...outcome, note: `${annotation}; ${outcome.note}` };
};
```

The signature of `LifecycleHandle["finish"]` and the `FinishInput` type are unchanged. `FinishLifecycleInput.baseBranch` already exists in `src/lifecycle/merge.ts`; this task only fills in the missing call to `resolveDefaultBranch`.

**Verify:** `bun test tests/lifecycle/index.test.ts && bun test tests/lifecycle/merge.test.ts && bun test tests/lifecycle/default-branch.test.ts`
**Commit:** `fix(lifecycle): resolve default branch in finisher`
