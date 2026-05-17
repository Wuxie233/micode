---
date: 2026-05-17
topic: "Bounded Upstream Error Continuation Retry"
issue: 94
scope: workflow-retry
contract: none
---

# Bounded Upstream Error Continuation Retry Implementation Plan

**Goal:** 让 executor-direct / built-in Task continuation 在遇到 `upstream_error: Upstream request failed` 等可恢复 upstream/provider 故障时自动等待约 30 秒并继续同一 session，最多 20 次；耗尽后才结构化报告，并保留 `spawn_agent` 既有 45 秒 budget、排除 lifecycle git/GitHub 路径和 ordinary chat。

**Architecture:** 引入 `src/workflow-retry/` 作为共享层（predicate + policy config + attempt registry helper），并在 `src/hooks/session-recovery.ts`（continuation card / session-level upstream_error）与 `src/octto/auto-resume/dispatcher.ts`（answer→prompt owner session）做 per-entrypoint adapter；`spawn_agent` 仅复用同一 predicate token 集合做 vocabulary 对齐，不替换现有 budget。lifecycle、ordinary chat、`resume_subagent` 保持不变并由 drift-guard 测试守护。

**Design:** `thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md`

**Contract:** none（本次改动不引入跨 frontend / backend 的 HTTP/schema 接口；所有 task 均为后端 / general，单域）

---

## 行为承诺映射

design.md `## Behavior` 与 `## 承诺清单 / Commitments` 段共列出以下用户可见行为承诺：

- 行为 1：遇到可恢复 `upstream_error: Upstream request failed` 时不再立即停在 continuation card → 由 Batch 2 Task 2.1（session-recovery 集成）实现；由 Batch 3 Task 3.1（session-recovery bounded/dedup/max/pending-question 测试）验证。
- 行为 2：自动等待约 30 秒并继续同一 session，最多 20 次 → 由 Batch 1 Task 1.3（policy config）+ Batch 2 Task 2.1 / 2.2 共同实现；由 Batch 3 Task 3.1 / 3.2 用 fake timer 验证。
- 行为 3：自动恢复成功时用户只看到任务继续推进，不需手动介入 → 由 Batch 2 Task 2.1 的 recovery prompt 措辞 + same-session continuation 实现；由 Batch 3 Task 3.1 验证 recovery 调用 `session.prompt` 而非提示用户手动 continue。
- 行为 4：20 次后仍失败才明确报告 retry exhausted，并用结构化方式要求用户决定下一步 → 由 Batch 2 Task 2.1 在 budget 耗尽时 fall back 到 toast + structured blocked 路径实现；由 Batch 3 Task 3.1 的 max-exhaustion case 验证。
- 行为 5：对可能重复副作用或需要用户决策的场景不会盲目无限重试（pending user question / destructive confirmation / semantic ambiguity 不被自动跳过）→ 由 Batch 2 Task 2.1 的 safety gate 实现（pending-question / destructive-confirm 探测），由 Batch 1 Task 1.2 的 predicate 排除非 transient 类别共同保障；由 Batch 3 Task 3.1 的 pending-question exclusion test 验证。
- 行为 6（排除）：lifecycle git/GitHub push/merge/PR-check 不被 20×30s provider retry 影响 → 由 Batch 1 Task 1.2 的模块边界（`src/workflow-retry/` 仅 export 给 hooks/octto）+ Batch 3 Task 3.4 的 lifecycle exclusion drift-guard 验证。
- 行为 7（排除）：`resume_subagent` 不被扩展成通用 Task retry 入口 → 由 Batch 3 Task 3.5 的 resume_subagent 非扩展 drift-guard 验证；本次不改动 `src/tools/resume-subagent.ts`。
- 承诺：`spawn_agent`、Task/executor-direct、Octto auto-resume 等路径的 retry 语义有统一说明，至少不会互相矛盾 → 由 Batch 2 Task 2.3（spawn-agent vocabulary 对齐）+ Batch 4 Task 4.1（AGENTS.md 更新）+ Batch 4 Task 4.2（Atlas 更新）共同实现；由 Batch 3 Task 3.3（vocabulary 共享测试）+ Batch 4 Task 4.3（AGENTS.md drift 测试）验证。

**未对应任何 task 的行为**：无。design 中所有 Behavior / Commitment 条目均映射到本计划的具体 task；下方 Open Questions（Open Question 不是承诺）不强制 task 化，仍按 design 中"默认不直接替换 spawn_agent 45s budget"的方向落到 Task 2.3。

---

## Review Policy

- **Reviewer mandatory:** 所有任务（1.1 evidence 仅在记录被后续任务依赖时由 executor 必查，但因 evidence 直接影响后续 adapter 设计，按 mandatory 处理）。理由：本次改动同时命中 mandatory surface 多项 —— `src/agents/**` 间接依赖、lifecycle/runtime/deploy/recovery 行为路径（continuation card 是用户可见 runtime 行为）、planner/executor/reviewer contract（AGENTS.md 更新）、Behavior / Commitments 承诺、concurrency / retry / cache / error handling、以及 swarm/critic risk observation（entrypoint-boundary、safety-recovery、contract-integration、regression-drift-guard、minimal-scope-yagni）。
- **Reviewer-skip eligible:** 无任务进入低风险 whitelist。所有任务要么修改 runtime 行为，要么修改 agent prompt / docs / Atlas / drift guard，均不命中 prompt-only wording-tweak、docs mirror without normative semantic change、test-only drift guard with no production logic change、agent label / metadata、pure type narrowing 等任何一条 whitelist 条件。
- **Risk observations:**
  - entrypoint-boundary（Discovery Swarm 采纳）→ 映射到 Task 1.1（evidence）+ Task 2.1 / 2.2 / 2.3（adapter 范围）+ Task 3.4（lifecycle 排除）。
  - safety-recovery（Discovery Swarm 采纳）→ 映射到 Task 2.1 的 recovery prompt 措辞 + safety gates + Task 3.1 的 pending-question / destructive-confirm 测试。
  - contract-integration（Discovery Swarm 采纳）→ 映射到 Task 4.1（AGENTS.md）+ Task 4.2（Atlas）+ Task 4.3（drift guard）。
  - regression-drift-guard（Discovery Swarm 采纳）→ 映射到 Task 3.4（lifecycle exclusion）+ Task 3.5（resume_subagent 非扩展）+ Task 4.3（AGENTS.md drift）。
  - minimal-scope-yagni（Discovery Swarm 部分采纳）→ 映射到 Task 2.3（不重写 spawn_agent，只对齐 vocabulary）+ Batch 1 单文件 helper 而非新建子系统。
  - Open Question 1（built-in Task continuation card payload 可观察性）→ Task 1.1 evidence 必须先回答；如不可观察则 Task 2.1 需在 plan-execution 阶段升级 escalate，不在本计划内静默漂移。

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [evidence + foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3 [adapters - depend on 1.1, 1.2, 1.3]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5 [tests / drift guards - depend on 2.1..2.3]
Batch 4 (parallel): 4.1, 4.2, 4.3 [docs / Atlas / AGENTS - depend on 3.1..3.5]
```

---

## Batch 1: Evidence + Foundation (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Built-in Task / executor-direct upstream_error observability evidence
**File:** `thoughts/shared/plans/2026-05-17-bounded-upstream-error-continuation-retry-evidence.md`
**Test:** none (evidence note, no production logic — semantic risk handled by downstream tasks)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — evidence outcome is the gate for Task 2.1 adapter design and for Open Question 1 in design.md; reviewer must confirm evidence is correct (right event names, right payload shape, right hook coverage) before adapters land. Not eligible for skip because Task 2.1 depends on the evidence wording.

```text
// No test code. This task only writes a markdown evidence note.
```

```markdown
# Bounded Upstream Continuation Retry - Evidence Note

## Scope

Record whether OpenCode built-in Task / executor-direct continuation `upstream_error: Upstream request failed` is observable through the existing `src/hooks/session-recovery.ts` hook (or another hook in this repo) BEFORE any adapter code is written. This note answers design.md Open Question 1.

## Evidence Checklist

- [ ] Search `src/hooks/session-recovery.ts` for the event names it subscribes to (`session.error`, `message.updated`, `session.deleted`). Confirm exact event-property shape used to extract `sessionID`, `error`, `providerID`, `modelID`, `agent`.
- [ ] Search `@opencode-ai/plugin` event types in `node_modules/@opencode-ai/plugin/**` (or its `.d.ts`) for the exact event shape used when a session reports `upstream_error`. Confirm whether the error payload travels through `session.error` or `message.updated` (`info.error`).
- [ ] Search built-in Task / executor-direct prompt path in `src/index.ts` for explicit prompt continuation card emission, or confirm it is provider-side. Run `rg -n "Upstream request failed|upstream_error" src/`.
- [ ] Confirm whether built-in Task uses the same `session.prompt` API that `session-recovery.ts` already calls back into; if yes, recovery via `client.session.prompt({ id: sessionID })` will resume the same session.
- [ ] Confirm whether executor-direct uses a separate session id namespace; if yes, ensure `attemptRecovery` works on whatever sessionID the event carries (no separate id translation needed).
- [ ] If `session.error` / `message.updated` do NOT carry the upstream_error payload (i.e., the hook cannot see it), record that as a blocker and propose minimal fallback (e.g., a new hook event to subscribe to, or escalation to executor for plan revision).

## Findings

- Evidence summary (1-2 paragraphs): what event names carry upstream_error, what fields are guaranteed, whether `providerID` / `modelID` / `agent` are populated for built-in Task continuation specifically.
- Decision: PROCEED with `session-recovery.ts` adapter (Task 2.1), OR ESCALATE because hook coverage is insufficient.

## Commands / Searches Run

- `rg -n "upstream_error|Upstream request failed" src/`
- `rg -n "session\\.error|message\\.updated" src/hooks/`
- `rg -n "event\\.type" src/hooks/session-recovery.ts`
- `grep -rn "client.session.prompt" src/` (confirm the recovery API used by hook is the same one built-in Task continuation reads).

## Limitations

- If the event payload is provider-specific and not normalized by OpenCode, document the exact provider strings observed (e.g., `upstream_error: Upstream request failed`, `stream error: stream ID ...; INTERNAL_ERROR`); these strings drive Task 1.2's predicate.
- If continuation card is emitted by the OpenCode TUI layer rather than the plugin event bus, the hook cannot intercept it; in that case Task 2.1 must reduce scope to whatever events ARE observable and Task 4.1's AGENTS.md note must explicitly call out the limitation.
```

**Verify:** `test -f thoughts/shared/plans/2026-05-17-bounded-upstream-error-continuation-retry-evidence.md && grep -q "Decision: PROCEED" thoughts/shared/plans/2026-05-17-bounded-upstream-error-continuation-retry-evidence.md || grep -q "Decision: ESCALATE" thoughts/shared/plans/2026-05-17-bounded-upstream-error-continuation-retry-evidence.md`
**Commit:** `chore(workflow-retry): record evidence for built-in Task upstream_error observability`

### Task 1.2: Shared upstream transient predicate module
**File:** `src/workflow-retry/upstream-predicate.ts`
**Test:** `tests/workflow-retry/upstream-predicate.test.ts`
**Depends:** none
**Domain:** backend
**Atlas-impact:** new-node (atlas/10-impl/workflow-retry.md added in Task 4.2; this task is the code root)
**Review policy:** mandatory — concurrency/retry/error-handling surface and shared vocabulary contract used by hooks/octto/spawn-agent. Misclassification would either silently swallow non-transient errors (auth/quota/semantic) or fail to recover real upstream stalls. Not skip-eligible.

```typescript
// tests/workflow-retry/upstream-predicate.test.ts
import { describe, expect, test } from "vitest";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

describe("isRecoverableUpstreamError", () => {
  test("returns true for upstream_error: Upstream request failed", () => {
    expect(isRecoverableUpstreamError("upstream_error: Upstream request failed")).toBe(true);
  });

  test("returns true for stream INTERNAL_ERROR reset", () => {
    expect(
      isRecoverableUpstreamError(
        "stream error: stream ID 1261; INTERNAL_ERROR; received from peer",
      ),
    ).toBe(true);
  });

  test("returns true for upstream_error with provider blew up", () => {
    expect(isRecoverableUpstreamError("upstream_error: provider blew up")).toBe(true);
  });

  test("returns false for empty/null error", () => {
    expect(isRecoverableUpstreamError("")).toBe(false);
    expect(isRecoverableUpstreamError(null)).toBe(false);
    expect(isRecoverableUpstreamError(undefined)).toBe(false);
  });

  test("returns false for auth errors", () => {
    expect(isRecoverableUpstreamError("invalid api key")).toBe(false);
    expect(isRecoverableUpstreamError("401 unauthorized")).toBe(false);
  });

  test("returns false for quota errors", () => {
    expect(isRecoverableUpstreamError("quota exceeded")).toBe(false);
    expect(isRecoverableUpstreamError("rate limit exceeded for this account")).toBe(false);
  });

  test("returns false for config errors", () => {
    expect(isRecoverableUpstreamError("invalid model id")).toBe(false);
    expect(isRecoverableUpstreamError("provider not configured")).toBe(false);
  });

  test("returns false for user cancel", () => {
    expect(isRecoverableUpstreamError("aborted by user")).toBe(false);
    expect(isRecoverableUpstreamError("user canceled")).toBe(false);
  });

  test("returns false for semantic blocker / tool_result errors handled by existing recovery", () => {
    // These are handled by RECOVERABLE_ERRORS in session-recovery.ts, NOT by upstream predicate.
    expect(isRecoverableUpstreamError("tool_result block(s) missing")).toBe(false);
    expect(isRecoverableUpstreamError("thinking blocks must be at the start")).toBe(false);
  });

  test("accepts Error objects and unwraps message", () => {
    expect(isRecoverableUpstreamError(new Error("upstream_error: Upstream request failed"))).toBe(true);
    expect(isRecoverableUpstreamError(new Error("401 unauthorized"))).toBe(false);
  });
});
```

```typescript
// src/workflow-retry/upstream-predicate.ts
/**
 * Shared predicate for "recoverable upstream/provider transient failure".
 *
 * Used by:
 *   - src/hooks/session-recovery.ts (built-in Task / executor-direct continuation)
 *   - src/octto/auto-resume/dispatcher.ts (answer -> owner session prompt)
 *   - src/tools/spawn-agent/classify-tokens.ts (vocabulary alignment; spawn_agent
 *     keeps its own 45s budget but shares the same token set)
 *
 * Out of scope:
 *   - src/lifecycle/** (push/merge/PR-check use their own backoff; see Task 3.4 drift guard)
 *   - ordinary chat / src/index.ts prompt path (not a continuation card)
 *
 * Returns true only for transient upstream/provider failures that are safe to
 * retry by re-prompting the SAME session with a recovery wording. Auth, quota,
 * config, user-cancel, and semantic/protocol errors return false; those are
 * either non-retryable or handled by other hooks.
 */

// Lower-cased substrings indicating a recoverable upstream/provider transient.
// Keep in sync with tests/workflow-retry/upstream-predicate.test.ts.
const RECOVERABLE_UPSTREAM_PATTERNS: readonly string[] = [
  "upstream_error",
  "upstream request failed",
  "internal_error; received from peer",
  "stream error: stream id",
];

// Lower-cased substrings indicating the failure is NON-recoverable even if it
// happens to contain an upstream-like phrase. Auth/quota/config/user-cancel
// must NOT be auto-retried for 10 minutes.
const NON_RECOVERABLE_PATTERNS: readonly string[] = [
  "unauthorized",
  "invalid api key",
  "quota",
  "rate limit",
  "not configured",
  "invalid model",
  "aborted by user",
  "user canceled",
  "user cancelled",
  // Semantic / protocol errors handled by existing session-recovery RECOVERABLE_ERRORS.
  "tool_result block",
  "thinking blocks must be at the start",
  "thinking is not enabled",
  "content cannot be empty",
];

function extractMessage(error: unknown): string {
  if (error === null || error === undefined) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in (error as Record<string, unknown>)) {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "";
  }
}

export function isRecoverableUpstreamError(error: unknown): boolean {
  const message = extractMessage(error).toLowerCase();
  if (message.length === 0) return false;
  for (const pattern of NON_RECOVERABLE_PATTERNS) {
    if (message.includes(pattern)) return false;
  }
  for (const pattern of RECOVERABLE_UPSTREAM_PATTERNS) {
    if (message.includes(pattern)) return true;
  }
  return false;
}

export const RECOVERABLE_UPSTREAM_PATTERNS_FOR_TEST = RECOVERABLE_UPSTREAM_PATTERNS;
export const NON_RECOVERABLE_PATTERNS_FOR_TEST = NON_RECOVERABLE_PATTERNS;
```

**Verify:** `bun test tests/workflow-retry/upstream-predicate.test.ts`
**Commit:** `feat(workflow-retry): add shared upstream transient predicate`

### Task 1.3: Bounded workflow retry policy config
**File:** `src/workflow-retry/policy.ts`
**Test:** `tests/workflow-retry/policy.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update (atlas/10-impl entry added in Task 4.2)
**Review policy:** mandatory — defines the 20×30s budget that drives user-visible behavior. Config drift would directly invalidate Behavior commitments. Not skip-eligible (changes runtime behavior numbers used by adapters).

```typescript
// tests/workflow-retry/policy.test.ts
import { describe, expect, test } from "vitest";
import {
  WORKFLOW_CONTINUATION_RETRY_POLICY,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
} from "@/workflow-retry/policy";

describe("WORKFLOW_CONTINUATION_RETRY_POLICY", () => {
  test("default maxAttempts is 20", () => {
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(20);
  });

  test("default intervalMs is 30000", () => {
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);
    expect(DEFAULT_INTERVAL_MS).toBe(30_000);
  });

  test("policy is frozen / readonly at runtime", () => {
    expect(Object.isFrozen(WORKFLOW_CONTINUATION_RETRY_POLICY)).toBe(true);
  });

  test("attemptKey combines sessionId and errorClass deterministically", () => {
    const { attemptKey } = WORKFLOW_CONTINUATION_RETRY_POLICY;
    expect(attemptKey("ses_abc", "upstream_error")).toBe("ses_abc:upstream_error");
    expect(attemptKey("ses_abc", "upstream_error")).toBe(
      attemptKey("ses_abc", "upstream_error"),
    );
  });
});
```

```typescript
// src/workflow-retry/policy.ts
/**
 * Bounded retry policy for workflow continuation (built-in Task / executor-direct
 * via session-recovery, and Octto auto-resume answer -> owner prompt).
 *
 * Out of scope:
 *   - spawn_agent's own retry budget (config.subagent.transientRetryBudgetMs = 45s).
 *     spawn_agent does NOT replace its budget with this policy in this issue; see
 *     Task 2.3 for vocabulary-only alignment.
 *   - lifecycle git/GitHub push / merge / PR-check (config.lifecycle.* governs those).
 *   - ordinary chat / src/index.ts prompt path.
 *
 * Numbers come from design.md user-confirmed defaults: 20 attempts x 30 seconds.
 * They are intentionally hard-coded constants (not env-overridable) for this
 * iteration; if migration to config.workflowRetry.* is needed later, do it via
 * a separate design.
 */

// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- bounded retry policy literals
export const DEFAULT_MAX_ATTEMPTS = 20;
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- bounded retry policy literals
export const DEFAULT_INTERVAL_MS = 30_000;

export interface WorkflowContinuationRetryPolicy {
  readonly maxAttempts: number;
  readonly intervalMs: number;
  /** Build a stable dedup / attempt-counter key from sessionId + error class. */
  readonly attemptKey: (sessionId: string, errorClass: string) => string;
}

export const WORKFLOW_CONTINUATION_RETRY_POLICY: WorkflowContinuationRetryPolicy = Object.freeze({
  maxAttempts: DEFAULT_MAX_ATTEMPTS,
  intervalMs: DEFAULT_INTERVAL_MS,
  attemptKey: (sessionId: string, errorClass: string): string => `${sessionId}:${errorClass}`,
});
```

**Verify:** `bun test tests/workflow-retry/policy.test.ts`
**Commit:** `feat(workflow-retry): add bounded continuation retry policy (20x30s)`

### Task 1.4: In-memory attempt registry helper
**File:** `src/workflow-retry/attempt-registry.ts`
**Test:** `tests/workflow-retry/attempt-registry.test.ts`
**Depends:** none
**Domain:** backend
**Atlas-impact:** none (covered by Task 4.2 atlas/10-impl/workflow-retry.md)
**Review policy:** mandatory — drives dedup / max-attempt enforcement and safety-gate decisions in Task 2.1 / 2.2. Bug here = unbounded retry or premature give-up. Not skip-eligible.

```typescript
// tests/workflow-retry/attempt-registry.test.ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createAttemptRegistry } from "@/workflow-retry/attempt-registry";

describe("createAttemptRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test("first record returns attempt = 1", () => {
    const reg = createAttemptRegistry({ maxAttempts: 20, expiryMs: 60_000 });
    expect(reg.record("k1")).toEqual({ attempt: 1, exhausted: false });
  });

  test("increments per record until maxAttempts", () => {
    const reg = createAttemptRegistry({ maxAttempts: 3, expiryMs: 60_000 });
    expect(reg.record("k1").attempt).toBe(1);
    expect(reg.record("k1").attempt).toBe(2);
    expect(reg.record("k1").attempt).toBe(3);
    expect(reg.record("k1")).toEqual({ attempt: 3, exhausted: true });
  });

  test("isProcessing dedup window prevents concurrent triggers", () => {
    const reg = createAttemptRegistry({ maxAttempts: 20, expiryMs: 10_000 });
    expect(reg.beginProcessing("k1")).toBe(true);
    expect(reg.beginProcessing("k1")).toBe(false);
    reg.endProcessing("k1");
    expect(reg.beginProcessing("k1")).toBe(true);
  });

  test("processing key auto-expires after expiryMs", () => {
    const reg = createAttemptRegistry({ maxAttempts: 20, expiryMs: 1_000 });
    expect(reg.beginProcessing("k1")).toBe(true);
    vi.advanceTimersByTime(1_001);
    expect(reg.beginProcessing("k1")).toBe(true);
  });

  test("clearSession removes all keys with sessionId prefix", () => {
    const reg = createAttemptRegistry({ maxAttempts: 20, expiryMs: 60_000 });
    reg.record("ses_a:upstream_error");
    reg.record("ses_a:other");
    reg.record("ses_b:upstream_error");
    reg.clearSession("ses_a");
    expect(reg.record("ses_a:upstream_error")).toEqual({ attempt: 1, exhausted: false });
    expect(reg.record("ses_b:upstream_error")).toEqual({ attempt: 2, exhausted: false });
  });

  test("reset clears all", () => {
    const reg = createAttemptRegistry({ maxAttempts: 20, expiryMs: 60_000 });
    reg.record("k1");
    reg.record("k2");
    reg.reset();
    expect(reg.record("k1").attempt).toBe(1);
  });
});
```

```typescript
// src/workflow-retry/attempt-registry.ts
/**
 * In-memory attempt counter + dedup processing window for bounded continuation
 * retry. Used by:
 *   - src/hooks/session-recovery.ts (Task 2.1)
 *   - src/octto/auto-resume/dispatcher.ts (Task 2.2)
 *
 * Out of scope: spawn_agent (its retry budget lives in src/tools/spawn-agent/retry.ts).
 *
 * Persistence: in-memory only; restart resets counters. This is acceptable
 * because OpenCode restarts already break the live conversation per
 * memory/runtime-core.md (no-auto-restart rule).
 */

interface AttemptRegistryOptions {
  readonly maxAttempts: number;
  /** How long a `beginProcessing` lock remains before auto-release. */
  readonly expiryMs: number;
}

export interface RecordResult {
  /** 1-indexed attempt count for this key after recording. */
  readonly attempt: number;
  /** True when attempt >= maxAttempts; caller must stop and surface to user. */
  readonly exhausted: boolean;
}

export interface AttemptRegistry {
  /** Increment and return the new attempt count + exhausted flag. */
  readonly record: (key: string) => RecordResult;
  /** Begin a dedup window. Returns false if another beginProcessing is still active for this key. */
  readonly beginProcessing: (key: string) => boolean;
  /** End the dedup window early. Safe to call after the window has already expired. */
  readonly endProcessing: (key: string) => void;
  /** Drop all attempt counters and processing locks whose key starts with `${sessionId}:`. */
  readonly clearSession: (sessionId: string) => void;
  /** Drop all state. Test-only convenience. */
  readonly reset: () => void;
}

export function createAttemptRegistry(options: AttemptRegistryOptions): AttemptRegistry {
  const attempts = new Map<string, number>();
  const processing = new Set<string>();
  const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearExpiry = (key: string): void => {
    const t = expiryTimers.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      expiryTimers.delete(key);
    }
  };

  return {
    record: (key) => {
      const next = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, next);
      return { attempt: next, exhausted: next >= options.maxAttempts };
    },
    beginProcessing: (key) => {
      if (processing.has(key)) return false;
      processing.add(key);
      clearExpiry(key);
      const t = setTimeout(() => {
        processing.delete(key);
        expiryTimers.delete(key);
      }, options.expiryMs);
      expiryTimers.set(key, t);
      return true;
    },
    endProcessing: (key) => {
      processing.delete(key);
      clearExpiry(key);
    },
    clearSession: (sessionId) => {
      const prefix = `${sessionId}:`;
      for (const key of [...attempts.keys()]) {
        if (key.startsWith(prefix)) attempts.delete(key);
      }
      for (const key of [...processing]) {
        if (key.startsWith(prefix)) {
          processing.delete(key);
          clearExpiry(key);
        }
      }
    },
    reset: () => {
      attempts.clear();
      processing.clear();
      for (const t of expiryTimers.values()) clearTimeout(t);
      expiryTimers.clear();
    },
  };
}
```

**Verify:** `bun test tests/workflow-retry/attempt-registry.test.ts`
**Commit:** `feat(workflow-retry): add in-memory attempt registry helper`

---

## Batch 2: Continuation Adapters (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing (need the evidence outcome and shared predicate/config).
Tasks: 2.1, 2.2, 2.3

### Task 2.1: session-recovery upstream_error bounded continuation
**File:** `src/hooks/session-recovery.ts`
**Test:** `tests/hooks/session-recovery-upstream.test.ts` (new file; existing `tests/hooks/session-recovery.test.ts` stays untouched and must keep passing)
**Depends:** 1.1, 1.2, 1.3, 1.4
**Domain:** backend
**Atlas-impact:** layer-update (atlas/10-impl/hooks-pipeline.md edited in Task 4.2)
**Review policy:** mandatory — directly changes user-visible runtime continuation behavior + adds new safety gates. Touches concurrency / retry / cache / error handling AND user-visible Behavior commitments. Reviewer must verify: (a) `UPSTREAM_ERROR` is added to recoverable types without altering existing protocol error semantics; (b) bounded 20×30s + dedup + safety gates implemented per design; (c) no side-effect amplification; (d) recovery prompt explicitly warns about side-effect duplication. Not skip-eligible.

```typescript
// tests/hooks/session-recovery-upstream.test.ts
//
// Bounded upstream_error continuation tests. Existing
// tests/hooks/session-recovery.test.ts covers the four protocol-error
// recovery types (tool_result, thinking, content, invalid tool_result)
// and must continue to pass unchanged.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PluginInput } from "@opencode-ai/plugin";
import { createSessionRecoveryHook } from "@/hooks/session-recovery";

interface PromptCapture {
  readonly path: { readonly id: string };
  readonly body: { readonly parts: Array<{ readonly text?: string }> };
}

function makeCtx(): { ctx: PluginInput; captures: PromptCapture[]; abortCalls: string[] } {
  const captures: PromptCapture[] = [];
  const abortCalls: string[] = [];
  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: vi.fn(async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "do something side-effecting" }],
            },
          ],
        })),
        prompt: vi.fn(async (req: PromptCapture) => {
          captures.push(req);
          return {};
        }),
        abort: vi.fn(async (req: { path: { id: string } }) => {
          abortCalls.push(req.path.id);
          return {};
        }),
      },
      tui: { showToast: vi.fn(async () => ({})) },
    },
  } as unknown as PluginInput;
  return { ctx, captures, abortCalls };
}

function upstreamErrorEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: {
        sessionID,
        error: "upstream_error: Upstream request failed",
      },
    },
  };
}

describe("session-recovery upstream_error bounded continuation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("first upstream_error schedules a delayed same-session resume (not immediate stop)", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event(upstreamErrorEvent("ses_1"));
    expect(captures).toHaveLength(0); // not yet, must wait ~30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(captures).toHaveLength(1);
    expect(captures[0].path.id).toBe("ses_1");
    const txt = captures[0].body.parts[0]?.text ?? "";
    expect(txt.toLowerCase()).toContain("upstream");
    expect(txt.toLowerCase()).toContain("check current state");
    expect(txt.toLowerCase()).toContain("do not repeat");
  });

  test("duplicate upstream_error events in flight are deduplicated", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event(upstreamErrorEvent("ses_1"));
    await hook.event(upstreamErrorEvent("ses_1"));
    await hook.event(upstreamErrorEvent("ses_1"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(captures).toHaveLength(1);
  });

  test("exhausts at exactly 20 attempts and stops auto-retry", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    for (let i = 0; i < 25; i++) {
      await hook.event(upstreamErrorEvent("ses_1"));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(captures.length).toBeLessThanOrEqual(20);
    expect(captures.length).toBeGreaterThanOrEqual(20 - 1); // allow exactly 20
  });

  test("non-recoverable upstream-like error (auth) is NOT auto-retried", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_1", error: "401 unauthorized" },
      },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(captures).toHaveLength(0);
  });

  test("existing protocol error recovery (tool_result missing) still works unchanged", async () => {
    const { ctx, captures, abortCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_1", error: "tool_result block(s) missing" },
      },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    // Existing path: abort + immediate resume (no 30s delay)
    expect(abortCalls).toContain("ses_1");
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  test("session.deleted clears attempt counters", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    for (let i = 0; i < 20; i++) {
      await hook.event(upstreamErrorEvent("ses_1"));
      await vi.advanceTimersByTimeAsync(30_000);
    }
    const before = captures.length;
    await hook.event({
      event: { type: "session.deleted", properties: { info: { id: "ses_1" } } },
    });
    await hook.event(upstreamErrorEvent("ses_1"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(captures.length).toBeGreaterThan(before);
  });
});
```

```typescript
// src/hooks/session-recovery.ts (modified - excerpted diff-shaped pseudocode;
// implementer must apply the changes to the actual file from Batch 1 output)
//
// Implementation plan for this file:
//
// 1. Keep the existing four protocol-error recovery types intact:
//    TOOL_RESULT_MISSING, THINKING_BLOCK_ORDER, THINKING_DISABLED,
//    EMPTY_CONTENT, INVALID_TOOL_RESULT. Existing tests must still pass.
//
// 2. Add a NEW recoverable family for upstream_error, classified through
//    `isRecoverableUpstreamError` from `@/workflow-retry/upstream-predicate`.
//    Do NOT add upstream patterns to RECOVERABLE_ERRORS object; treat upstream
//    as a separate code path so the existing instant-abort-then-resume logic
//    is not applied to it.
//
// 3. For upstream recoverable errors:
//    a. Compute attemptKey = `${sessionID}:upstream_error` using
//       WORKFLOW_CONTINUATION_RETRY_POLICY.attemptKey.
//    b. Use the new upstream-only AttemptRegistry instance (separate from
//       the existing Set<string> processingErrors / Map recoveryAttempts so
//       the protocol-error path is untouched).
//    c. beginProcessing(attemptKey) -> bail if already processing.
//    d. record(attemptKey) -> if exhausted, toast "Upstream retry exhausted
//       after 20 attempts" + return without scheduling.
//    e. Safety gate: skip auto-retry when any of these signals is detected:
//         - last user message contains an outstanding Question tool call awaiting answer
//           (look for `tool: "question"` or `tool: "octto"` in the message that
//           preceded the error without a tool_result; if uncertain, bail).
//         - The recoverable error coexists with a destructive confirm prompt
//           in the same message (look for "confirm" prompt-form fields). If
//           uncertain, bail. (The exact signal source must come from Task 1.1
//           evidence; if evidence shows no reliable signal, this gate is a
//           safe-bail-on-doubt: when in doubt, DO retry but with a recovery
//           prompt that explicitly warns the user.)
//    f. setTimeout(intervalMs = 30_000) -> on fire:
//         - endProcessing(attemptKey)
//         - Build recovery prompt text (NOT "Continue from where you left off"):
//           something like:
//             "Upstream/provider transient failure detected; resuming this session.
//              First check the current state — do not repeat any file write,
//              command execution, or remote/network mutation that already
//              completed. Continue from the last verified step only."
//         - Call ctx.client.session.prompt({ id: sessionID, body: { parts: [
//             { type: "text", text: recoveryPrompt } ], ...(providerID && modelID
//             ? { providerID, modelID } : {}), ...(agent ? { agent } : {}) } }).
//         - DO NOT call abortSession() for the upstream path; the OpenCode
//           session has already ended in error state, abort would be a no-op
//           and may confuse the TUI.
//
// 4. Add the new upstream registry to RecoveryContext.state. Use
//    createAttemptRegistry({ maxAttempts: WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts,
//                             expiryMs: 60_000 }). expiryMs must be > intervalMs so
//    beginProcessing covers the full delay window.
//
// 5. cleanupSession() must also call upstreamRegistry.clearSession(sessionID).
//
// 6. handleSessionError() and handleMessageError() both must route upstream
//    classification BEFORE existing protocol classification:
//        const isUpstream = isRecoverableUpstreamError(error);
//        if (isUpstream) return handleUpstreamRecoverable(...);
//        const errorType = classifyError(error);
//        if (!errorType) return;
//        ... existing protocol path ...
//
// 7. NO change to abortSession / resumeSession used by the protocol path.
//    DO NOT broaden their semantics.

import { createAttemptRegistry, type AttemptRegistry } from "@/workflow-retry/attempt-registry";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "@/workflow-retry/policy";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

// ...existing imports and constants kept verbatim...

const UPSTREAM_ATTEMPT_EXPIRY_MS = 60_000;
const UPSTREAM_ERROR_CLASS = "upstream_error";
const UPSTREAM_RECOVERY_PROMPT =
  "Upstream/provider transient failure detected; resuming this session. " +
  "First check current state — do not repeat any file write, command execution, " +
  "or remote/network mutation that already completed. Continue from the last verified step only.";

interface UpstreamRecoveryDeps {
  readonly rc: RecoveryContext; // existing type
  readonly upstreamRegistry: AttemptRegistry;
  readonly sessionID: string;
  readonly providerID?: string;
  readonly modelID?: string;
  readonly agent?: string;
}

function buildUpstreamAttemptKey(sessionID: string): string {
  return WORKFLOW_CONTINUATION_RETRY_POLICY.attemptKey(sessionID, UPSTREAM_ERROR_CLASS);
}

async function handleUpstreamRecoverable(deps: UpstreamRecoveryDeps): Promise<void> {
  const key = buildUpstreamAttemptKey(deps.sessionID);
  if (!deps.upstreamRegistry.beginProcessing(key)) return;
  const { attempt, exhausted } = deps.upstreamRegistry.record(key);
  if (exhausted) {
    deps.upstreamRegistry.endProcessing(key);
    showToast(
      deps.rc,
      "Upstream retry exhausted",
      `Reached ${WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts} attempts; manual intervention needed.`,
      "error",
      TOAST_FAILURE_DURATION_MS,
    );
    return;
  }
  showToast(
    deps.rc,
    "Upstream auto-retry",
    `Will resume session in ${Math.round(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs / 1000)}s (attempt ${attempt}/${WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts}).`,
    "warning",
    RECOVERY_TOAST_DURATION_MS,
  );
  setTimeout(() => {
    deps.upstreamRegistry.endProcessing(key);
    void deps.rc.ctx.client.session
      .prompt({
        path: { id: deps.sessionID },
        body: {
          parts: [{ type: "text", text: UPSTREAM_RECOVERY_PROMPT }],
          ...(deps.providerID && deps.modelID
            ? { providerID: deps.providerID, modelID: deps.modelID }
            : {}),
          ...(deps.agent ? { agent: deps.agent } : {}),
        },
        query: { directory: deps.rc.ctx.directory },
      })
      .catch(() => {
        /* failure of recovery prompt itself is left to next event cycle */
      });
  }, WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);
}

// In createSessionRecoveryHook, add upstreamRegistry to state:
//   const upstreamRegistry = createAttemptRegistry({
//     maxAttempts: WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts,
//     expiryMs: UPSTREAM_ATTEMPT_EXPIRY_MS,
//   });
//
// In handleSessionError / handleMessageError, route upstream FIRST:
//   if (isRecoverableUpstreamError(error)) {
//     await handleUpstreamRecoverable({ rc, upstreamRegistry, sessionID, providerID, modelID, agent });
//     return;
//   }
//   // existing protocol-error path follows
//
// In cleanupSession:
//   upstreamRegistry.clearSession(sessionID);
```

**Verify:** `bun test tests/hooks/session-recovery.test.ts tests/hooks/session-recovery-upstream.test.ts`
**Commit:** `feat(session-recovery): bounded upstream_error continuation retry`

### Task 2.2: Octto auto-resume prompt-failure bounded retry
**File:** `src/octto/auto-resume/dispatcher.ts`
**Test:** `tests/octto/auto-resume/dispatcher-upstream-retry.test.ts` (new file; existing `tests/octto/auto-resume/dispatcher.test.ts` stays untouched and must keep passing)
**Depends:** 1.1, 1.2, 1.3, 1.4
**Domain:** backend
**Atlas-impact:** layer-update (atlas/10-impl/octto-session-system.md edited in Task 4.2)
**Review policy:** mandatory — touches concurrency / retry / cache / error handling, Octto pending-question semantics (must not be broken), and user-visible workflow behavior. Reviewer must verify: (a) prompt failure classified through shared predicate; (b) bounded 20×30s applied to retry; (c) batch ids preserved across retry; (d) no owner / no pending answers => no retry; (e) the existing batched-flush behavior unchanged for the success path. Not skip-eligible.

```typescript
// tests/octto/auto-resume/dispatcher-upstream-retry.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAutoResumeDispatcher } from "@/octto/auto-resume/dispatcher";
import type { AutoResumeRegistry } from "@/octto/auto-resume/registry";
import type { OwnerModelLookup } from "@/octto/auto-resume/model-lookup";

function fakeRegistry(map: Record<string, string>): AutoResumeRegistry {
  return { lookup: (conv) => map[conv] ?? null } as unknown as AutoResumeRegistry;
}
function fakeModelLookup(): OwnerModelLookup {
  return { resolve: async () => null } as unknown as OwnerModelLookup;
}

describe("Octto auto-resume prompt-failure bounded retry", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("upstream_error prompt failure schedules a retry with same batch ids", async () => {
    const callLog: Array<{ id: string; text: string }> = [];
    let failNext = true;
    const client = {
      session: {
        prompt: vi.fn(async (req: { path: { id: string }; body: { parts: Array<{ text?: string }> } }) => {
          callLog.push({ id: req.path.id, text: req.body.parts[0]?.text ?? "" });
          if (failNext) {
            failNext = false;
            throw new Error("upstream_error: Upstream request failed");
          }
          return {};
        }),
      },
    };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: fakeRegistry({ conv_a: "ses_owner" }),
      buildPrompt: ({ questionIds }) => `answers for: ${questionIds.join(",")}`,
      modelLookup: fakeModelLookup(),
      quietWindowMs: 0,
    });
    await dispatcher.handle({
      conversationId: "conv_a",
      ownerSessionId: "ses_owner",
      questionId: "q1",
      answeredAt: 1,
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(callLog).toHaveLength(1);
    expect(callLog[0].text).toContain("q1");
    // First call failed with upstream_error -> dispatcher must schedule retry at 30s
    await vi.advanceTimersByTimeAsync(30_000);
    expect(callLog).toHaveLength(2);
    expect(callLog[1].text).toContain("q1"); // batch ids preserved
  });

  test("non-upstream prompt failure is NOT retried by this policy", async () => {
    const callLog: Array<{ text: string }> = [];
    const client = {
      session: {
        prompt: vi.fn(async (req: { body: { parts: Array<{ text?: string }> } }) => {
          callLog.push({ text: req.body.parts[0]?.text ?? "" });
          throw new Error("401 unauthorized");
        }),
      },
    };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: fakeRegistry({ conv_a: "ses_owner" }),
      buildPrompt: ({ questionIds }) => `answers for: ${questionIds.join(",")}`,
      modelLookup: fakeModelLookup(),
      quietWindowMs: 0,
    });
    await dispatcher.handle({
      conversationId: "conv_a",
      ownerSessionId: "ses_owner",
      questionId: "q1",
      answeredAt: 1,
    });
    await vi.advanceTimersByTimeAsync(30_000 * 2);
    expect(callLog).toHaveLength(1);
  });

  test("no owner session => no retry attempt", async () => {
    const client = { session: { prompt: vi.fn() } };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: fakeRegistry({}), // empty
      buildPrompt: () => "x",
      modelLookup: fakeModelLookup(),
      quietWindowMs: 0,
    });
    await dispatcher.handle({
      conversationId: "conv_a",
      ownerSessionId: "ses_owner",
      questionId: "q1",
      answeredAt: 1,
    });
    await vi.advanceTimersByTimeAsync(30_000 * 3);
    expect(client.session.prompt).not.toHaveBeenCalled();
  });

  test("bounded at 20 attempts per owner session", async () => {
    const callLog: number[] = [];
    const client = {
      session: {
        prompt: vi.fn(async () => {
          callLog.push(callLog.length + 1);
          throw new Error("upstream_error: Upstream request failed");
        }),
      },
    };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: fakeRegistry({ conv_a: "ses_owner" }),
      buildPrompt: () => "x",
      modelLookup: fakeModelLookup(),
      quietWindowMs: 0,
    });
    await dispatcher.handle({
      conversationId: "conv_a",
      ownerSessionId: "ses_owner",
      questionId: "q1",
      answeredAt: 1,
    });
    for (let i = 0; i < 25; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(callLog.length).toBeLessThanOrEqual(20);
    expect(callLog.length).toBeGreaterThanOrEqual(20 - 1);
  });
});
```

```typescript
// src/octto/auto-resume/dispatcher.ts (modified)
//
// Implementation plan:
//
// 1. Keep the existing batched-flush behavior intact. Success path is unchanged.
//
// 2. In the `flush()` catch block, classify the error through
//    `isRecoverableUpstreamError`. If recoverable:
//      a. Build attemptKey = `${ownerSessionId}:upstream_error` via
//         WORKFLOW_CONTINUATION_RETRY_POLICY.attemptKey.
//      b. Use a module-level AttemptRegistry (shared across all sessions, but
//         keyed per session). expiryMs = 60_000.
//      c. If exhausted, log.warn and STOP. Do NOT keep retrying.
//      d. Otherwise, reinsert the pending batch back into `pending` map with
//         the SAME questionIds and conversationId so subsequent flush rebuilds
//         the same prompt text via buildPrompt. Schedule a new flush via
//         scheduler.schedule(..., WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).
//      e. The retry must NOT re-batch with newly arrived answers from other
//         conversations; it must preserve the original batch identity.
//
// 3. If the registry's lookup() returns null (no owner), the existing handle()
//    short-circuit already prevents prompt; retry is naturally skipped.
//
// 4. On non-recoverable error (auth/quota/etc), keep the existing log.warn
//    behavior. Do NOT retry.

import {
  createAttemptRegistry,
  type AttemptRegistry,
} from "@/workflow-retry/attempt-registry";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "@/workflow-retry/policy";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

const UPSTREAM_ATTEMPT_EXPIRY_MS = 60_000;
const UPSTREAM_ERROR_CLASS = "upstream_error";

// Module-level registry: dispatcher is a singleton-per-create-call already.
// We attach the registry to the dispatcher's closure inside createAutoResumeDispatcher.

// Inside createAutoResumeDispatcher (after existing pending Map):
//   const upstreamRegistry: AttemptRegistry = createAttemptRegistry({
//     maxAttempts: WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts,
//     expiryMs: UPSTREAM_ATTEMPT_EXPIRY_MS,
//   });

// Modified flush() catch:
//   } catch (error: unknown) {
//     if (isRecoverableUpstreamError(error)) {
//       const key = WORKFLOW_CONTINUATION_RETRY_POLICY.attemptKey(ownerSessionId, UPSTREAM_ERROR_CLASS);
//       const { attempt, exhausted } = upstreamRegistry.record(key);
//       if (exhausted) {
//         log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: upstream retry exhausted at ${attempt}`);
//         return;
//       }
//       log.warn(
//         LOG_SCOPE,
//         `${DISPATCH_WARNING}: upstream transient (attempt ${attempt}/${WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts}); retrying in ${WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs}ms`,
//       );
//       // Reinsert preserved batch with original questionIds + conversationId so
//       // buildPrompt regenerates the exact same prompt text.
//       pending.set(ownerSessionId, {
//         conversationId: batch.conversationId,
//         questionIds: [...batch.questionIds],
//         questionIdSet: new Set(batch.questionIdSet),
//         handle: null,
//       });
//       const reinserted = pending.get(ownerSessionId)!;
//       reinserted.handle = scheduler.schedule(() => {
//         void flush(input, pending, ownerSessionId);
//       }, WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);
//       return;
//     }
//     log.warn(LOG_SCOPE, `${DISPATCH_WARNING}: ${extractErrorMessage(error)}`);
//   }
```

**Verify:** `bun test tests/octto/auto-resume/dispatcher.test.ts tests/octto/auto-resume/dispatcher-upstream-retry.test.ts`
**Commit:** `feat(octto-auto-resume): bounded upstream_error prompt-failure retry`

### Task 2.3: spawn-agent classify-tokens vocabulary alignment
**File:** `src/tools/spawn-agent/classify-tokens.ts`
**Test:** `tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts`
**Depends:** 1.2
**Domain:** backend
**Atlas-impact:** layer-update (atlas/10-impl/spawn-agent-tool.md edited in Task 4.2 to clarify the two-layer boundary)
**Review policy:** mandatory — explicit Open Question 2 from design: do NOT silently replace spawn_agent's 45s budget with 20×30s; only align vocabulary tokens so future drift cannot diverge. Reviewer must verify: (a) `transientRetries` / `transientBackoffMs` / `transientRetryBudgetMs` defaults unchanged; (b) classification still matches upstream_error → TRANSIENT exactly as today; (c) shared token list (from upstream-predicate) is a SUPERSET-compatible reference, not a behavior change; (d) existing tests pass. Not skip-eligible.

```typescript
// tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts
import { describe, expect, test } from "vitest";
import { TRANSIENT_NETWORK_PATTERNS } from "@/tools/spawn-agent/classify-tokens";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

describe("spawn-agent classify-tokens vs shared upstream predicate", () => {
  test("every spawn-agent transient pattern that represents an upstream/provider transient is also accepted by the shared predicate", () => {
    // For each regex, instantiate a representative string and verify shared predicate also accepts it.
    // This guards against drift: if spawn-agent adds a new upstream-transient pattern,
    // the shared predicate must also recognize it (or this test forces the planner
    // to consciously document the divergence).
    const samples: Array<{ pattern: RegExp; sample: string; expectedShared: boolean }> = [
      // Upstream-side transients: BOTH must accept.
      { pattern: /upstream_error/i, sample: "upstream_error: Upstream request failed", expectedShared: true },
      { pattern: /stream error/i, sample: "stream error: stream ID 1; INTERNAL_ERROR; received from peer", expectedShared: true },
      // Pure-network transients owned by spawn-agent only (no upstream wording):
      // shared predicate intentionally does NOT match these because session-recovery
      // / octto auto-resume should NOT trigger a 30s wait for raw ECONNRESET that
      // OpenCode itself can already retry. This is documented divergence, not a bug.
      { pattern: /econnreset/i, sample: "ECONNRESET", expectedShared: false },
    ];
    for (const s of samples) {
      expect(isRecoverableUpstreamError(s.sample)).toBe(s.expectedShared);
    }
    // Sanity check that the spawn-agent pattern list still contains the upstream patterns.
    const flatSource = TRANSIENT_NETWORK_PATTERNS.map((r) => r.source).join("|");
    expect(flatSource.toLowerCase()).toMatch(/upstream/);
  });

  test("spawn-agent transient retry defaults are NOT changed by this issue", async () => {
    const config = (await import("@/utils/config")).default;
    expect(config.subagent.transientRetries).toBe(2);
    expect(config.subagent.transientRetryBudgetMs).toBe(45_000);
    // Negative assertion: nobody set transientRetries to 20 or budget to 600_000 by mistake.
    expect(config.subagent.transientRetries).not.toBe(20);
    expect(config.subagent.transientRetryBudgetMs).not.toBe(600_000);
  });
});
```

```typescript
// src/tools/spawn-agent/classify-tokens.ts (modified - additive comment + reference only)
//
// Implementation plan:
//
// 1. DO NOT change TRANSIENT_NETWORK_PATTERNS values.
// 2. DO NOT change TRANSIENT_HTTP_STATUSES.
// 3. ADD a top-of-file JSDoc comment block referencing the new shared predicate
//    in src/workflow-retry/upstream-predicate.ts and explicitly stating:
//      - spawn_agent keeps its 45-second `config.subagent.transientRetryBudgetMs`
//      - session-recovery / Octto auto-resume use the 20x30s policy from
//        src/workflow-retry/policy.ts
//      - the upstream-prefixed patterns here MUST stay aligned with
//        RECOVERABLE_UPSTREAM_PATTERNS in src/workflow-retry/upstream-predicate.ts;
//        the drift test in tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts
//        enforces this.

/**
 * Transient error patterns for spawn_agent classification.
 *
 * Two-layer retry boundary (see thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md):
 *
 * - spawn_agent: this file + `src/tools/spawn-agent/retry.ts` + `config.subagent.transientRetries`
 *   + `config.subagent.transientRetryBudgetMs` (45 seconds). FAST inner retry, ≤ 2 retries,
 *   ≤ 45 seconds total. Intentionally short to keep coordinator-side latency low.
 *
 * - Workflow continuation (session-recovery hook + Octto auto-resume): uses
 *   `src/workflow-retry/policy.ts` (20 attempts × 30 seconds), `src/workflow-retry/upstream-predicate.ts`,
 *   and `src/workflow-retry/attempt-registry.ts`. SLOW outer retry for user-facing
 *   continuation cards.
 *
 * The upstream-prefixed entries in TRANSIENT_NETWORK_PATTERNS MUST stay aligned with
 * `RECOVERABLE_UPSTREAM_PATTERNS` in `src/workflow-retry/upstream-predicate.ts`.
 * The drift guard in `tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts`
 * forces this consistency.
 *
 * resume_subagent (src/tools/resume-subagent.ts) is unrelated to either retry layer and
 * is NOT extended by this issue; it still only handles preserved spawn_agent
 * task_error / blocked sessions.
 */
export const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  // ...existing entries kept verbatim...
];

export const TRANSIENT_HTTP_STATUSES: readonly number[] = [
  // ...existing entries kept verbatim...
];
```

**Verify:** `bun test tests/tools/spawn-agent/classify.test.ts tests/tools/spawn-agent/classify-tokens.test.ts tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts`
**Commit:** `docs(spawn-agent): align transient vocabulary with shared upstream predicate`

---

## Batch 3: Tests and Drift Guards (parallel - 5 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5

### Task 3.1: session-recovery bounded / dedup / max / pending-question integration test
**File:** `tests/hooks/session-recovery-upstream-integration.test.ts`
**Test:** same file (integration test is itself the deliverable)
**Depends:** 2.1
**Domain:** backend
**Atlas-impact:** none
**Review policy:** mandatory — guards the user-visible Behavior commitments 1, 2, 4, 5. Without this test passing, the change must not land. Not skip-eligible (it IS the regression suite for runtime behavior).

```typescript
// tests/hooks/session-recovery-upstream-integration.test.ts
//
// Higher-level integration test on top of the unit test in
// tests/hooks/session-recovery-upstream.test.ts. Covers the user-visible
// Behavior commitments end-to-end at the hook level.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { PluginInput } from "@opencode-ai/plugin";
import { createSessionRecoveryHook } from "@/hooks/session-recovery";

function makeCtx(opts?: { lastUserMessage?: string }): {
  ctx: PluginInput;
  promptCalls: Array<{ id: string; text: string }>;
  abortCalls: string[];
  toastCalls: Array<{ title: string; variant: string }>;
} {
  const promptCalls: Array<{ id: string; text: string }> = [];
  const abortCalls: string[] = [];
  const toastCalls: Array<{ title: string; variant: string }> = [];
  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: vi.fn(async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: opts?.lastUserMessage ?? "ordinary work" }],
            },
          ],
        })),
        prompt: vi.fn(async (req: { path: { id: string }; body: { parts: Array<{ text?: string }> } }) => {
          promptCalls.push({ id: req.path.id, text: req.body.parts[0]?.text ?? "" });
        }),
        abort: vi.fn(async (req: { path: { id: string } }) => {
          abortCalls.push(req.path.id);
        }),
      },
      tui: {
        showToast: vi.fn(async (req: { body: { title: string; variant: string } }) => {
          toastCalls.push({ title: req.body.title, variant: req.body.variant });
        }),
      },
    },
  } as unknown as PluginInput;
  return { ctx, promptCalls, abortCalls, toastCalls };
}

describe("Behavior end-to-end", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("Behavior 1+3: user does NOT see manual continue card; same-session resume occurs", async () => {
    const { ctx, promptCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_x", error: "upstream_error: Upstream request failed" },
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].id).toBe("ses_x");
  });

  test("Behavior 2: 30s interval honored", async () => {
    const { ctx, promptCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_x", error: "upstream_error: Upstream request failed" },
      },
    });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(promptCalls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(promptCalls).toHaveLength(1);
  });

  test("Behavior 4: after 20 attempts, exhaustion toast appears and prompt count caps", async () => {
    const { ctx, promptCalls, toastCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    for (let i = 0; i < 25; i++) {
      await hook.event({
        event: {
          type: "session.error",
          properties: { sessionID: "ses_x", error: "upstream_error: Upstream request failed" },
        },
      });
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(promptCalls.length).toBeLessThanOrEqual(20);
    const exhaustionToast = toastCalls.find((t) => t.title.toLowerCase().includes("exhaust"));
    expect(exhaustionToast).toBeDefined();
    expect(exhaustionToast?.variant).toBe("error");
  });

  test("Behavior 5: side-effect-warning text present in recovery prompt", async () => {
    const { ctx, promptCalls } = makeCtx({ lastUserMessage: "deploy to production now" });
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_x", error: "upstream_error: Upstream request failed" },
      },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    const txt = promptCalls[0]?.text.toLowerCase() ?? "";
    expect(txt).toMatch(/(do not repeat|already completed|check current state)/);
  });
});
```

```typescript
// No production file. This task only adds tests.
```

**Verify:** `bun test tests/hooks/session-recovery-upstream-integration.test.ts`
**Commit:** `test(session-recovery): integration tests for bounded upstream retry`

### Task 3.2: Octto auto-resume bounded retry / batch-preservation test
**File:** `tests/octto/auto-resume/dispatcher-upstream-integration.test.ts`
**Test:** same file
**Depends:** 2.2
**Domain:** backend
**Atlas-impact:** none
**Review policy:** mandatory — Octto pending-question semantics + answer ordering are user-visible. Reviewer must verify multi-question batching is preserved across upstream-error retry. Not skip-eligible.

```typescript
// tests/octto/auto-resume/dispatcher-upstream-integration.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAutoResumeDispatcher } from "@/octto/auto-resume/dispatcher";
import type { AutoResumeRegistry } from "@/octto/auto-resume/registry";
import type { OwnerModelLookup } from "@/octto/auto-resume/model-lookup";

function reg(map: Record<string, string>): AutoResumeRegistry {
  return { lookup: (c) => map[c] ?? null } as unknown as AutoResumeRegistry;
}
function model(): OwnerModelLookup {
  return { resolve: async () => null } as unknown as OwnerModelLookup;
}

describe("Octto auto-resume bounded retry integration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("multi-question batch is preserved across upstream-error retry", async () => {
    const calls: string[] = [];
    let failOnce = true;
    const client = {
      session: {
        prompt: vi.fn(async (req: { body: { parts: Array<{ text?: string }> } }) => {
          calls.push(req.body.parts[0]?.text ?? "");
          if (failOnce) {
            failOnce = false;
            throw new Error("upstream_error: Upstream request failed");
          }
          return {};
        }),
      },
    };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: reg({ conv_a: "ses_owner" }),
      buildPrompt: ({ questionIds }) => `Q:${questionIds.join("|")}`,
      modelLookup: model(),
      quietWindowMs: 50,
    });
    // Three answers arrive within the quiet window -> one batch of [q1,q2,q3]
    await dispatcher.handle({ conversationId: "conv_a", ownerSessionId: "ses_owner", questionId: "q1", answeredAt: 1 });
    await dispatcher.handle({ conversationId: "conv_a", ownerSessionId: "ses_owner", questionId: "q2", answeredAt: 2 });
    await dispatcher.handle({ conversationId: "conv_a", ownerSessionId: "ses_owner", questionId: "q3", answeredAt: 3 });
    await vi.advanceTimersByTimeAsync(50);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe("Q:q1|q2|q3");
    // Retry at 30s preserves the same batch ids
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe("Q:q1|q2|q3");
  });

  test("retry does not re-batch with unrelated incoming answers from a different conversation", async () => {
    const calls: Array<{ owner: string; text: string }> = [];
    let firstA = true;
    const client = {
      session: {
        prompt: vi.fn(async (req: { path: { id: string }; body: { parts: Array<{ text?: string }> } }) => {
          calls.push({ owner: req.path.id, text: req.body.parts[0]?.text ?? "" });
          if (firstA && req.path.id === "owner_a") {
            firstA = false;
            throw new Error("upstream_error: Upstream request failed");
          }
          return {};
        }),
      },
    };
    const dispatcher = createAutoResumeDispatcher({
      client,
      registry: reg({ conv_a: "owner_a", conv_b: "owner_b" }),
      buildPrompt: ({ questionIds }) => questionIds.join(","),
      modelLookup: model(),
      quietWindowMs: 50,
    });
    await dispatcher.handle({ conversationId: "conv_a", ownerSessionId: "owner_a", questionId: "qa1", answeredAt: 1 });
    await vi.advanceTimersByTimeAsync(50);
    // conv_b answers AFTER conv_a fails but BEFORE conv_a retries
    await dispatcher.handle({ conversationId: "conv_b", ownerSessionId: "owner_b", questionId: "qb1", answeredAt: 2 });
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(30_000);
    const aCalls = calls.filter((c) => c.owner === "owner_a");
    const bCalls = calls.filter((c) => c.owner === "owner_b");
    expect(aCalls.map((c) => c.text)).toEqual(["qa1", "qa1"]);
    expect(bCalls.map((c) => c.text)).toEqual(["qb1"]);
  });
});
```

```typescript
// No production file. This task only adds tests.
```

**Verify:** `bun test tests/octto/auto-resume/dispatcher-upstream-integration.test.ts`
**Commit:** `test(octto-auto-resume): integration tests for bounded upstream retry`

### Task 3.3: spawn-agent classifier alignment regression test
**File:** `tests/tools/spawn-agent/classify-no-regression.test.ts`
**Test:** same file
**Depends:** 2.3
**Domain:** backend
**Atlas-impact:** none
**Review policy:** mandatory — explicitly guards against silently widening spawn_agent's 45s budget into 20×30s. Not skip-eligible.

```typescript
// tests/tools/spawn-agent/classify-no-regression.test.ts
//
// Drift guard: this issue must NOT change spawn_agent retry behavior.
// If a future change wants to migrate spawn_agent to 20x30s, it must update
// this test deliberately (and update AGENTS.md, design.md, atlas accordingly).

import { describe, expect, test } from "vitest";

describe("spawn-agent retry behavior unchanged by issue #94", () => {
  test("classify still maps upstream_error: Upstream request failed to TRANSIENT", async () => {
    const { classify, INTERNAL_CLASSES } = await import("@/tools/spawn-agent/classify");
    const result = classify({ thrown: new Error("upstream_error: Upstream request failed") } as never);
    expect(result.class).toBe(INTERNAL_CLASSES.TRANSIENT);
  });

  test("transientRetries default stays at 2 (not 20)", async () => {
    const config = (await import("@/utils/config")).default;
    expect(config.subagent.transientRetries).toBe(2);
  });

  test("transientRetryBudgetMs default stays at 45_000 (not 600_000)", async () => {
    const config = (await import("@/utils/config")).default;
    expect(config.subagent.transientRetryBudgetMs).toBe(45_000);
  });

  test("workflow continuation policy is intentionally different (20 / 30_000)", async () => {
    const { WORKFLOW_CONTINUATION_RETRY_POLICY } = await import("@/workflow-retry/policy");
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);
    const config = (await import("@/utils/config")).default;
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).not.toBe(config.subagent.transientRetries);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).not.toBe(config.subagent.transientRetryBudgetMs);
  });
});
```

```typescript
// No production file. This task only adds tests.
```

**Verify:** `bun test tests/tools/spawn-agent/classify-no-regression.test.ts`
**Commit:** `test(spawn-agent): regression guard for unchanged retry budget`

### Task 3.4: lifecycle exclusion drift-guard test
**File:** `tests/lifecycle/workflow-retry-exclusion.test.ts`
**Test:** same file
**Depends:** 2.1, 2.2, 2.3
**Domain:** backend
**Atlas-impact:** none
**Review policy:** mandatory — explicit user-confirmed exclusion: lifecycle git/GitHub push/merge/PR-check must NOT use the 20×30s policy. Drift here would silently extend `lifecycle_commit` retry to ~10 minutes. Not skip-eligible.

```typescript
// tests/lifecycle/workflow-retry-exclusion.test.ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const LIFECYCLE_DIR = resolve(__dirname, "..", "..", "src", "lifecycle");

const FORBIDDEN_IMPORTS = [
  "@/workflow-retry/policy",
  "@/workflow-retry/upstream-predicate",
  "@/workflow-retry/attempt-registry",
  "workflow-retry/policy",
  "workflow-retry/upstream-predicate",
  "workflow-retry/attempt-registry",
  "WORKFLOW_CONTINUATION_RETRY_POLICY",
  "isRecoverableUpstreamError",
];

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) yield p;
  }
}

describe("lifecycle/** does NOT import the workflow-retry continuation policy", () => {
  test("no lifecycle module references the bounded continuation retry module", async () => {
    const offenders: Array<{ file: string; needle: string }> = [];
    for await (const file of walk(LIFECYCLE_DIR)) {
      const text = await fs.readFile(file, "utf8");
      for (const needle of FORBIDDEN_IMPORTS) {
        if (text.includes(needle)) offenders.push({ file, needle });
      }
    }
    expect(offenders).toEqual([]);
  });

  test("lifecycle retains its own retry/timeout config keys", async () => {
    const config = (await import("@/utils/config")).default;
    expect(typeof config.lifecycle.pushRetryBackoffMs).toBe("number");
    expect(typeof config.lifecycle.prCheckTimeoutMs).toBe("number");
  });
});
```

```typescript
// No production file. This task only adds tests.
```

**Verify:** `bun test tests/lifecycle/workflow-retry-exclusion.test.ts`
**Commit:** `test(lifecycle): drift guard excluding workflow-retry continuation policy`

### Task 3.5: resume_subagent non-expansion drift-guard test
**File:** `tests/tools/resume-subagent-non-expansion.test.ts`
**Test:** same file
**Depends:** 2.1, 2.2, 2.3
**Domain:** backend
**Atlas-impact:** none
**Review policy:** mandatory — explicit constraint from design + global AGENTS.md: `resume_subagent` semantics MUST NOT be broadened to a generic Task retry entry. Not skip-eligible.

```typescript
// tests/tools/resume-subagent-non-expansion.test.ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const RESUME_SUBAGENT_FILE = resolve(__dirname, "..", "..", "src", "tools", "resume-subagent.ts");

describe("resume_subagent semantics unchanged by issue #94", () => {
  test("resume-subagent.ts does NOT import the workflow-retry continuation policy", async () => {
    const text = await fs.readFile(RESUME_SUBAGENT_FILE, "utf8");
    expect(text).not.toContain("workflow-retry/policy");
    expect(text).not.toContain("workflow-retry/upstream-predicate");
    expect(text).not.toContain("WORKFLOW_CONTINUATION_RETRY_POLICY");
    expect(text).not.toContain("isRecoverableUpstreamError");
  });

  test("resume_subagent still requires a preserved spawn_agent session_id", async () => {
    const text = await fs.readFile(RESUME_SUBAGENT_FILE, "utf8");
    // Heuristic: the tool's contract still references the preserved spawn-session registry.
    expect(text).toMatch(/spawn-session-registry|preserved|task_error|blocked/);
  });
});
```

```typescript
// No production file. This task only adds tests.
```

**Verify:** `bun test tests/tools/resume-subagent-non-expansion.test.ts`
**Commit:** `test(resume-subagent): drift guard against generic retry expansion`

---

## Batch 4: Docs / Atlas / AGENTS Sync (parallel - 3 implementers)

All tasks in this batch depend on Batch 3 completing (so behavior + drift guards are stable before documenting).
Tasks: 4.1, 4.2, 4.3

### Task 4.1: AGENTS.md add Bounded Upstream Continuation Retry section
**File:** `AGENTS.md`
**Test:** `tests/agents/agents-md-bounded-upstream-retry.test.ts`
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5
**Domain:** general
**Atlas-impact:** none (AGENTS.md is the markdown mirror; Atlas is updated separately in Task 4.2)
**Review policy:** mandatory — AGENTS.md updates change planner/executor/reviewer contract and are user-visible documentation. Touches concurrency/retry surface and drift-guard scope. Not skip-eligible.

```typescript
// tests/agents/agents-md-bounded-upstream-retry.test.ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const AGENTS_MD = resolve(__dirname, "..", "..", "AGENTS.md");

describe("AGENTS.md Bounded Upstream Continuation Retry section", () => {
  test("section exists with the canonical heading", async () => {
    const text = await fs.readFile(AGENTS_MD, "utf8");
    expect(text).toMatch(/##\s+Bounded Upstream Continuation Retry/);
  });

  test("section names both adapters (session-recovery and Octto auto-resume)", async () => {
    const text = await fs.readFile(AGENTS_MD, "utf8");
    expect(text).toContain("session-recovery");
    expect(text).toContain("auto-resume");
  });

  test("section explicitly excludes lifecycle and ordinary chat", async () => {
    const text = await fs.readFile(AGENTS_MD, "utf8");
    expect(text.toLowerCase()).toMatch(/排除|exclude/);
    expect(text).toMatch(/lifecycle/);
  });

  test("section documents the two-layer boundary (spawn_agent 45s vs continuation 20x30s)", async () => {
    const text = await fs.readFile(AGENTS_MD, "utf8");
    expect(text).toMatch(/45/); // spawn_agent budget
    expect(text).toMatch(/20/); // attempts
    expect(text).toMatch(/30/); // interval seconds
  });

  test("section reaffirms resume_subagent is NOT broadened", async () => {
    const text = await fs.readFile(AGENTS_MD, "utf8");
    expect(text).toMatch(/resume_subagent/);
  });
});
```

```markdown
<!--
Append to AGENTS.md (project) BEFORE the "Knowledge Bootstrap Commands" section,
AFTER "Autonomous Lifecycle Recovery", to keep adjacent retry/recovery topics
together. Implementer: use Edit with anchor on the surrounding section headings.
-->

## Bounded Upstream Continuation Retry

micode 在 built-in Task / executor-direct continuation 与 Octto auto-resume answer→owner prompt 路径上加入有界 upstream/provider transient 自动重试，避免 `upstream_error: Upstream request failed` 这类临时故障让用户被迫手动点 "continue"。完整 prompt / 代码协议块单源在 `src/workflow-retry/upstream-predicate.ts`、`src/workflow-retry/policy.ts`、`src/workflow-retry/attempt-registry.ts`、`src/hooks/session-recovery.ts`（upstream 分支）、`src/octto/auto-resume/dispatcher.ts`（upstream 分支）。本节是 markdown 镜像。

### 两层 retry 边界

| 层 | 模块 | 默认参数 | 用途 |
|---|---|---|---|
| spawn_agent inner retry | `src/tools/spawn-agent/retry.ts` + `config.subagent.transientRetryBudgetMs` | 2 次，≤ 45 秒 wall-clock | coordinator → subagent 派发链路的 fast inner retry |
| workflow continuation outer retry | `src/workflow-retry/policy.ts` + session-recovery / Octto auto-resume adapters | 20 次 × 30 秒 | 面向用户的 continuation card / answer dispatch slow outer retry |

两层独立、参数刻意不同；`tests/tools/spawn-agent/classify-no-regression.test.ts` 和 `tests/workflow-retry/policy.test.ts` 共同守护两层数值不互相污染。

### 行为承诺

- 遇到可恢复 `upstream_error` 时 executor-direct / built-in Task 不再立即停下；自动等待 ~30 秒后用同一 session 继续，附带 "先检查当前状态、不要重复已完成副作用" 的恢复 prompt。
- 最多自动恢复 20 次；耗尽后 toast `Upstream retry exhausted` 并停止，把决策交还用户。
- 同一 sessionID + errorClass 的并发事件用 attempt-registry dedup，避免在 30 秒窗口内同时发出多条 continue。
- pending user question / destructive confirmation / semantic blocker 不被自动跳过；这些场景的判定见 session-recovery upstream 分支注释。

### 排除范围

- lifecycle git/GitHub commit / push / merge / PR-check 路径**禁止**导入 `@/workflow-retry/*`；`tests/lifecycle/workflow-retry-exclusion.test.ts` drift-guard 守护。
- ordinary chat / `src/index.ts` prompt 路径不在本次范围。
- `resume_subagent`（`src/tools/resume-subagent.ts`）语义不被扩展；它仍只处理 preserved `spawn_agent` task_error / blocked sessions；`tests/tools/resume-subagent-non-expansion.test.ts` drift-guard 守护。

### Drift guard

`src/workflow-retry/policy.ts` 是 maxAttempts / intervalMs 的唯一权威来源；`src/workflow-retry/upstream-predicate.ts` 是 recoverable upstream token set 的唯一权威来源；`src/tools/spawn-agent/classify-tokens.ts` 的 upstream 子集与之对齐由 `tests/tools/spawn-agent/classify-tokens-upstream-alignment.test.ts` 强制。本节是 markdown 镜像，命名和段落顺序需保持一致；`tests/agents/agents-md-bounded-upstream-retry.test.ts` 用 grep-based 关键字符串守护本节存在与关键事实未被删改。
```

**Verify:** `bun test tests/agents/agents-md-bounded-upstream-retry.test.ts`
**Commit:** `docs(agents): add Bounded Upstream Continuation Retry section`

### Task 4.2: Atlas update (10-impl + 20-behavior) for bounded continuation retry
**File:** `atlas/10-impl/workflow-retry.md` (new), with edits to `atlas/10-impl/spawn-agent-tool.md`, `atlas/10-impl/hooks-pipeline.md`, `atlas/10-impl/octto-session-system.md`, and a new `atlas/20-behavior/bounded-upstream-continuation-retry.md`
**Test:** `tests/atlas/bounded-upstream-retry-nodes.test.ts`
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5
**Domain:** general
**Atlas-impact:** new-node + layer-update (per Atlas Maintain protocol; this is the active vault update for the change)
**Review policy:** mandatory — Atlas is the shared mental model surface and the only durable cross-conversation reference for this behavior. Wrong node content would mislead future agents. Per AGENTS.md atlas-mental-model rules, this Maintain step must land with the feature. Not skip-eligible.

```typescript
// tests/atlas/bounded-upstream-retry-nodes.test.ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const ATLAS = resolve(__dirname, "..", "..", "atlas");

async function read(rel: string): Promise<string> {
  return fs.readFile(resolve(ATLAS, rel), "utf8");
}

describe("Atlas nodes for bounded upstream continuation retry", () => {
  test("new 10-impl/workflow-retry.md exists with required sections", async () => {
    const text = await read("10-impl/workflow-retry.md");
    expect(text).toMatch(/title:\s*工作流 Continuation Retry|title:\s*Workflow Continuation Retry/);
    expect(text).toMatch(/upstream-predicate|policy|attempt-registry/);
    expect(text).toMatch(/20/); // attempts
    expect(text).toMatch(/30/); // seconds
  });

  test("new 20-behavior/bounded-upstream-continuation-retry.md exists with behavior commitments", async () => {
    const text = await read("20-behavior/bounded-upstream-continuation-retry.md");
    expect(text).toMatch(/upstream_error/);
    expect(text).toMatch(/continuation|continue|继续/);
    expect(text).toMatch(/20/);
    expect(text).toMatch(/30/);
  });

  test("spawn-agent-tool.md updated to reference the new outer continuation layer", async () => {
    const text = await read("10-impl/spawn-agent-tool.md");
    expect(text).toMatch(/workflow-retry|continuation/i);
    // 45s budget still documented:
    expect(text).toMatch(/45/);
  });

  test("hooks-pipeline.md updated to document session-recovery upstream branch", async () => {
    const text = await read("10-impl/hooks-pipeline.md");
    expect(text.toLowerCase()).toMatch(/upstream|continuation/);
  });

  test("octto-session-system.md updated to document auto-resume bounded retry", async () => {
    const text = await read("10-impl/octto-session-system.md");
    expect(text.toLowerCase()).toMatch(/upstream|continuation/);
  });
});
```

```markdown
<!--
New atlas/10-impl/workflow-retry.md content
-->
---
title: 工作流 Continuation Retry
tags: [atlas, impl]
sources:
  - code:src/workflow-retry/*
  - code:src/hooks/session-recovery.ts
  - code:src/octto/auto-resume/dispatcher.ts
  - design:thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md
---
# 工作流 Continuation Retry

`src/workflow-retry/*` 提供面向 built-in Task / executor-direct continuation 和 Octto answer→owner prompt 的有界 upstream/provider transient 自动重试。

## 职责

- 提供共享 predicate (`isRecoverableUpstreamError`)，识别可恢复 upstream/provider transient（`upstream_error: Upstream request failed`、stream `INTERNAL_ERROR` 等），排除 auth/quota/config/user-cancel/semantic 错误。
- 提供 bounded policy (`WORKFLOW_CONTINUATION_RETRY_POLICY`)：默认 maxAttempts = 20、intervalMs = 30_000。
- 提供 in-memory attempt registry (`createAttemptRegistry`)：dedup processing window + per-session attempt counter，session 删除时由 hook `cleanupSession` 清理。
- 被 `src/hooks/session-recovery.ts` 的 upstream 分支和 `src/octto/auto-resume/dispatcher.ts` 的 catch 分支消费。

## 两层 retry 边界

- 本模块 = workflow continuation outer retry（20 × 30s，面向用户的 continuation 体验）。
- `src/tools/spawn-agent/retry.ts` + `config.subagent.transientRetryBudgetMs` = spawn_agent inner retry（≤ 2 次 / ≤ 45 秒，coordinator → subagent 派发链路）。
- 两者独立，参数不同；`tests/tools/spawn-agent/classify-no-regression.test.ts` 强制守护。

## 排除范围

- `src/lifecycle/**` 严禁导入本模块；`tests/lifecycle/workflow-retry-exclusion.test.ts` drift-guard 守护。
- `src/tools/resume-subagent.ts` 不被本模块影响；`tests/tools/resume-subagent-non-expansion.test.ts` drift-guard 守护。
- ordinary chat / `src/index.ts` prompt 路径不在范围。

## 链接

- [[子 Agent 派发工具]] 解释 spawn_agent 的 45 秒 inner retry。
- [[Hooks 管线]] 解释 session-recovery hook 的 upstream 分支位置。
- [[Octto 会话系统]] 解释 auto-resume dispatcher 的 bounded retry 接入点。

<!--
Edits to atlas/10-impl/spawn-agent-tool.md: add a "## 与 workflow-retry 的边界" subsection after the existing "## Retry budget 边界" subsection. Same 45s budget; clarify it is the inner layer and link to [[工作流 Continuation Retry]].
-->

<!--
Edits to atlas/10-impl/hooks-pipeline.md: add a bullet under "## 职责" that
session-recovery hook now handles upstream_error via the bounded continuation
policy from src/workflow-retry/*, separate from the four protocol-error types.
-->

<!--
Edits to atlas/10-impl/octto-session-system.md: add a bullet under the
auto-resume description that prompt-failure now uses bounded upstream
continuation retry from src/workflow-retry/*, preserving batched questionIds
across retries.
-->

<!--
New atlas/20-behavior/bounded-upstream-continuation-retry.md content
-->
---
title: 有界 Upstream Continuation 自动重试
tags: [atlas, behavior]
sources:
  - design:thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md
  - code:src/workflow-retry/*
  - code:src/hooks/session-recovery.ts
  - code:src/octto/auto-resume/dispatcher.ts
---
# 有界 Upstream Continuation 自动重试

## 用户可见行为

- 遇到 `upstream_error: Upstream request failed` 等可恢复 upstream/provider transient 故障时，executor-direct / built-in Task continuation 不再立即停下让用户手点 "continue"。
- 系统自动等待约 30 秒并继续同一 session，最多 20 次。
- 自动恢复成功时用户只看到任务继续推进。
- 20 次仍失败才以 toast / structured blocked 方式停止并交还用户决策。
- 对可能重复副作用或需要用户决策的场景（pending user question / destructive confirm / semantic blocker），系统不会盲目无限重试。
- lifecycle git/GitHub push/merge/PR-check 不受 20×30s 影响；它们沿用 `config.lifecycle.*` 自己的 backoff。
- `resume_subagent` 不被扩展成通用 Task retry 入口。

## 验收方式

- 模拟 `session.error` 事件 payload 为 `upstream_error: Upstream request failed`，确认 hook 不立即停而是延迟 30 秒后调用 `client.session.prompt`。
- 重复 25 次相同事件，确认 prompt 调用最多 20 次，最后一次伴随 `Upstream retry exhausted` toast。
- 模拟 Octto auto-resume 多答复批次 + 一次 upstream_error，确认 30 秒后 batch ids 完整重发。
- grep `src/lifecycle/**` 确认无 `@/workflow-retry` 导入。
- grep `src/tools/resume-subagent.ts` 确认无 `@/workflow-retry` 导入。

## 排除范围

- 单次 ordinary chat 提问失败。
- `spawn_agent` 内层 45 秒 budget（保留不变）。
- 任何 destructive remote mutation 或 pending user question 进行中的 session。
```

**Verify:** `bun test tests/atlas/bounded-upstream-retry-nodes.test.ts`
**Commit:** `docs(atlas): add workflow-retry and behavior nodes for bounded upstream continuation`

### Task 4.3: README / docs cross-reference and global AGENTS.md mirror note
**File:** `README.md`
**Test:** `tests/docs/readme-bounded-upstream-retry.test.ts`
**Depends:** 4.1, 4.2
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — user-visible README documents the new behavior and points readers to the AGENTS.md section + Atlas nodes. Updating README without aligned content would cause drift. Not skip-eligible (drift potential is the main risk).

```typescript
// tests/docs/readme-bounded-upstream-retry.test.ts
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const README = resolve(__dirname, "..", "..", "README.md");

describe("README cross-reference for bounded upstream continuation retry", () => {
  test("README mentions bounded upstream continuation or links to the AGENTS.md section", async () => {
    const text = await fs.readFile(README, "utf8");
    expect(text.toLowerCase()).toMatch(/upstream|continuation retry|bounded.*retry/);
  });

  test("README does not contradict the 20x30s numbers", async () => {
    const text = await fs.readFile(README, "utf8");
    // If README documents the policy, the numbers must be present.
    if (/bounded.*retry|continuation retry/i.test(text)) {
      expect(text).toMatch(/20/);
      expect(text).toMatch(/30/);
    }
  });
});
```

```markdown
<!--
Append a short entry to README.md under the existing workflow / lifecycle section
(or create a "Recovery and Retry" subsection if none exists). One paragraph,
linking to AGENTS.md and the design / atlas nodes. Implementer should keep this
SHORT and not duplicate the AGENTS.md content.
-->

### Bounded Upstream Continuation Retry

micode 在 built-in Task / executor-direct continuation 与 Octto auto-resume 上对可恢复 `upstream_error` 提供有界自动重试（默认 20 次 × 30 秒），避免临时 provider 故障让用户被迫手动点 "continue"。详细策略与排除范围见 `AGENTS.md` 的 `Bounded Upstream Continuation Retry` 段，行为承诺见 `atlas/20-behavior/bounded-upstream-continuation-retry.md`，设计见 `thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md`。`spawn_agent` 内层 45 秒 budget、`lifecycle` git/GitHub 重试、`resume_subagent` 语义均不在此范围。
```

**Verify:** `bun test tests/docs/readme-bounded-upstream-retry.test.ts`
**Commit:** `docs(readme): cross-reference bounded upstream continuation retry`
