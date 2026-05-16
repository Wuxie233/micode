---
date: 2026-05-17
topic: "working-context-capsule-v2"
issue: 93
scope: agents
contract: none
---

# Working Context Capsule v2 Implementation Plan

**Goal:** Extend the v1 Context Capsule so that same-conversation, single-subagent dispatches (commander → executor-direct) and ops/quick-fix flows without a lifecycle issue also generate and reuse a capsule, without breaking v1's lifecycle-issue path, byte-identical injection, secret filter, or immutable file philosophy.

**Architecture:** Add a small `conversation.ts` module that hashes the current OpenCode session id into a stable `conversation_anchor` (null when unavailable). Extend `ContextCapsuleBuildInput` / frontmatter / freshness / store with four optional v2 fields (`conversation_anchor`, `generated_by`, `dispatch_kind`, `parent_capsule`) so v1 callers keep working. Upgrade `findLatestContextCapsule` to a two-tier matcher (v1: `(lifecycle_issue, branch, worktree)` then v2: `(conversation_anchor, repo, branch, worktree)` fallback). Extend the shared `CONTEXT_CAPSULE_PROTOCOL` block with a v2 trigger clause ("派遣前查找+复用、派遣后生成"), keeping byte-identical drift guard across brainstormer / commander / octto. Each sub-dispatch produces a new immutable file under `thoughts/shared/context-capsules/`; no in-place edits.

**Design:** `thoughts/shared/designs/2026-05-17-working-context-capsule-v2-design.md`

**Contract:** none

**按默认决定:** design 未指定 `conversation_anchor` 哈希算法或长度。本计划采用 sha256 截断 16 个 hex 字符（与既有 `createCapsuleToken` 长度一致），理由：避免 leak 原始 session id、足够低碰撞、与现有 token 长度对齐、易回滚。design 未指定 v2 capsule 文件名命名。采用 `conv-<anchor>-<topicSlug>-<token>.md` 模式（lifecycle 路径仍是 `issue-<N>-...` 不变），理由：人眼可识别 v2 路径来源；不影响 v1 文件命名兼容。design 未指定 `generated_by` enum 与 `dispatch_kind` enum 的字面量大小写。采用 lowercase kebab-case (`commander | brainstormer | octto | executor`、`parallel-fanout | single-subagent | executor-direct`)，理由：与既有 status / frontmatter 风格一致。

---

## 行为承诺映射

design.md `## 承诺清单 / Commitments` 与 `## Behavior` 段共列出约 14 条行为承诺。映射如下：

- commander/brainstormer/octto 三者同步在每次 sub-dispatch 完成后生成或追加 capsule → 由 Batch 3 Task 3.5（commander prompt v2 hook）、Task 3.6（brainstormer prompt v2 hook）、Task 3.7（octto prompt v2 hook）三处同步扩展；Batch 4 Task 4.1 drift guard 守护字节一致。
- 同对话内后续 sub-dispatch（包括 executor-direct）自动注入最新 capsule → 由 Batch 2 Task 2.3（`store.findLatestContextCapsule` v2 fallback）+ Batch 3 Task 3.5/3.6/3.7 prompt 协议要求"派遣前 find + 派遣后 build"；Batch 4 Task 4.3 集成测试模拟三连 executor-direct。
- 复用 anchor 扩展到「同对话 + 同 repo + 同 worktree」（lifecycle_issue 可为 null）→ 由 Batch 1 Task 1.2 types 增加 `conversation_anchor`；Batch 2 Task 2.3 store 实现两层 matcher；Batch 2 Task 2.4 freshness 增加 conversation 维度。
- 不跨对话复用；OpenCode 重启后同对话 anchor 失效，可接受 → 由 Batch 1 Task 1.4 conversation.ts 实现 session-id-based hash（无持久化）；Batch 4 Task 4.3 集成测试覆盖 anchor 变化 → discarded。
- byte-identical drift guard / secret filter / immutable 三大不变量保持 → Batch 2 Task 2.1 builder 仍走 `assertCapsuleSafe`；Batch 2 Task 2.2 仍使用 `writeImmutableFile`（existsSync skip）；Batch 4 Task 4.1 drift guard 检查 v1 + v2 协议块均出现在三 primary agent prompt。
- 不破坏 v1 lifecycle-issue 复用路径 → Batch 2 Task 2.3 v1 matcher 优先于 v2 fallback；Batch 4 Task 4.4 v1 回归测试（lifecycle-issue 命中仍取首选）。
- 不扩展 resume_subagent → 本计划无 task 接触 `src/tools/resume-subagent` 或 preserved-session 注册表；Batch 4 Task 4.5 回归测试保持。
- capsule builder 必须轻量，不能明显拖慢下一轮 dispatch → Batch 2 Task 2.1 仍单文件 IO + 单次 sha256；Batch 1 Task 1.4 conversation.ts 是纯函数；不做新 IO。
- 终态 Capsule status 行在同对话连续 ops 场景里能稳定出现 fresh / partially-stale / discarded → Batch 3 Task 3.5/3.6/3.7 prompt 要求每个 primary agent 在 effect-first knowledge-context 段更新 Capsule status；既有 `KNOWLEDGE_CONTEXT_SECTION` 已含 Capsule status 行（v1 已实现，本计划不动单源）。
- conversation_anchor 取不到时静默降级到 v1，Capsule status: skipped: no-conversation-anchor → Batch 1 Task 1.4 conversation.ts 返回 null；Batch 3 Task 3.5/3.6/3.7 prompt 要求当 anchor 为 null 时上报 skipped:no-conversation-anchor；Batch 4 Task 4.3 集成测试覆盖该路径。
- 同对话多份 capsule 时间戳冲突时按 created_at desc + path 字典序破平 → Batch 2 Task 2.3 store 排序逻辑（v1 已有，本计划保留并扩展到 v2 集合）；Batch 4 Task 4.4 单元测试覆盖破平。
- 找到的 capsule 与当前 repo 不匹配时 discarded → Batch 2 Task 2.4 freshness 仍检查 worktree（worktree 隐含 repo 边界）；Batch 4 Task 4.4 单元测试覆盖。
- secret / raw logs / 凭据仍不会写入 capsule → Batch 2 Task 2.1 builder 不变 `assertCapsuleSafe` 调用；Batch 4 Task 4.2 builder 测试覆盖 v2 字段 + secret 注入仍返回 blocked。
- v1 已有的 lifecycle issue 内 A→B 复用 / 并行 fan-out 缓存命中行为完全保留 → Batch 2 Task 2.3 v1 matcher 路径保持；Batch 4 Task 4.5 既有 drift-guard 测试不变。
- AGENTS.md Capsule status 取值与协议块描述同步 → Batch 3 Task 3.8 AGENTS.md mirror 更新（在既有 `Capsule status` 行附近增补 v2 trigger 简述，不改单源测试断言）。

**未对应任何 task 的行为**：无。

---

## Review Policy

- **Reviewer mandatory:** 所有 task。理由：本变更全部落在高风险面 — `src/agents/**` prompt contract（commander / brainstormer / octto / context-capsule-protocol）、context-capsule runtime（builder / store / freshness / conversation anchor）、secret filtering、cache/freshness 行为、subagent dispatch UX、AGENTS.md mirror。
- **Reviewer-skip eligible:** 无。本 feature 涉及 prompt-contract / secret / cache / drift-guard 多重风险，无 task 命中低风险白名单（prompt-only 字面修订也属于 workflow contract）。
- **Risk observations:**
  - byte-identical 注入风险（v1 已防）：v2 不得在 prefix 模板里穿插 conversation anchor 等动态字段使每个 worker prompt drift（Task 1.1 / 2.4 / 4.1）。
  - 同对话 anchor 偶发为 null 时 must graceful degrade，不得抛错或阻断 dispatch（Task 1.4 / 2.3 / 3.5–3.7 / 4.3）。
  - v1 lifecycle 命中必须始终优先（防 v2 fallback 误用旧 conversation anchor 覆盖更精确的 issue 匹配）（Task 2.3 / 4.4）。
  - secret 检测面积不缩小（Task 2.1 / 4.2）。
  - resume_subagent / planner / reviewer / Atlas / PM 边界保持（Task 3.5–3.7 prompt 不下放 capsule 维护权给 leaf agent；Task 4.5 回归）。

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [core capsule runtime - depend on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 [prompt protocol + agent prompts + AGENTS.md - depend on batch 2 module shapes]
Batch 4 (parallel): 4.1, 4.2, 4.3, 4.4, 4.5 [drift guard + integration regression - depend on batch 3]
```

---

## Batch 1: Foundation (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Extend v1 types with v2 optional fields
**File:** `src/agents/context-capsule/types.ts`
**Test:** `tests/agents/context-capsule/types.test.ts` (extend existing)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Introduces the four v2 frontmatter fields (`conversation_anchor`, `generated_by`, `dispatch_kind`, `parent_capsule`) and a `DispatchKind` / `GeneratorAgent` union so every downstream consumer can opt into v2 while v1 callers keep compiling.
**Review policy:** mandatory — shared runtime contract used by builder, store, freshness, injector; type drift cascades into every primary agent prompt path.

```typescript
// tests/agents/context-capsule/types.test.ts — append after existing block
import { describe, expect, it } from "bun:test";
import type {
  ContextCapsuleBuildInput,
  ContextCapsuleFrontmatter,
  ContextCapsuleFreshnessInput,
  DispatchKind,
  GeneratorAgent,
} from "@/agents/context-capsule/types";
import { DISPATCH_KINDS, GENERATOR_AGENTS, isDispatchKind, isGeneratorAgent } from "@/agents/context-capsule/types";

describe("v2 frontmatter fields", () => {
  it("declares dispatch_kind enum", () => {
    expect(DISPATCH_KINDS).toEqual(["parallel-fanout", "single-subagent", "executor-direct"]);
  });

  it("declares generated_by enum", () => {
    expect(GENERATOR_AGENTS).toEqual(["brainstormer", "commander", "octto", "executor"]);
  });

  it("guards dispatch_kind values", () => {
    expect(isDispatchKind("executor-direct")).toBe(true);
    expect(isDispatchKind("unknown")).toBe(false);
  });

  it("guards generated_by values", () => {
    expect(isGeneratorAgent("commander")).toBe(true);
    expect(isGeneratorAgent("planner")).toBe(false);
  });

  it("allows v2 fields to be omitted in BuildInput (v1 callers unchanged)", () => {
    const input: ContextCapsuleBuildInput = {
      topic: "x",
      lifecycleIssue: 1,
      branch: "main",
      headSha: "deadbeef",
      worktree: "/tmp",
      sourceFiles: [],
      confirmedFacts: [],
    };
    expect(input.conversationAnchor).toBeUndefined();
    expect(input.generatedBy).toBeUndefined();
    expect(input.dispatchKind).toBeUndefined();
    expect(input.parentCapsuleSha).toBeUndefined();
  });

  it("allows v2 fields to be null in frontmatter (degraded v1 capsules)", () => {
    const frontmatter: ContextCapsuleFrontmatter = {
      lifecycle_issue: 1,
      branch: "main",
      head_sha: "deadbeef",
      worktree: "/tmp",
      created_at: "2026-05-17T00:00:00Z",
      source_files: [],
      source_hashes: {},
      conversation_anchor: null,
      generated_by: null,
      dispatch_kind: null,
      parent_capsule: null,
    };
    expect(frontmatter.conversation_anchor).toBeNull();
  });

  it("freshness input accepts expectedConversationAnchor", () => {
    const input: ContextCapsuleFreshnessInput = {
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-abc",
      branch: "main",
      headSha: "x",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "x",
        worktree: "/tmp",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-abc",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    };
    expect(input.expectedConversationAnchor).toBe("anchor-abc");
  });
});
```

```typescript
// src/agents/context-capsule/types.ts — replace whole file
export const CAPSULE_STATUSES = ["none", "fresh", "partially-stale", "discarded", "skipped", "blocked"] as const;
export const DISPATCH_KINDS = ["parallel-fanout", "single-subagent", "executor-direct"] as const;
export const GENERATOR_AGENTS = ["brainstormer", "commander", "octto", "executor"] as const;

export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];
export type CapsuleFreshnessStatus = "fresh" | "partially-stale" | "discarded";
export type DispatchKind = (typeof DISPATCH_KINDS)[number];
export type GeneratorAgent = (typeof GENERATOR_AGENTS)[number];

export interface ContextCapsuleFrontmatter {
  readonly lifecycle_issue: number | null;
  readonly branch: string;
  readonly head_sha: string;
  readonly worktree: string;
  readonly created_at: string;
  readonly source_files: readonly string[];
  readonly source_hashes: Readonly<Record<string, string>>;
  readonly conversation_anchor: string | null;
  readonly generated_by: GeneratorAgent | null;
  readonly dispatch_kind: DispatchKind | null;
  readonly parent_capsule: string | null;
}

export interface ContextCapsuleSource {
  readonly path: string;
  readonly content: string;
}

export interface ContextCapsuleBuildInput {
  readonly topic: string;
  readonly lifecycleIssue: number | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceFiles: readonly ContextCapsuleSource[];
  readonly confirmedFacts: readonly string[];
  readonly createdAt?: Date;
  readonly outputDir?: string;
  readonly softWindowRatio?: number;
  readonly conversationAnchor?: string | null;
  readonly generatedBy?: GeneratorAgent | null;
  readonly dispatchKind?: DispatchKind | null;
  readonly parentCapsuleSha?: string | null;
}

export interface BuiltContextCapsule {
  readonly status: "fresh";
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
  readonly document: string;
  readonly warnings: readonly string[];
}

export interface BlockedContextCapsule {
  readonly status: "blocked";
  readonly reason: string;
  readonly detail?: string;
}

export type BuildContextCapsuleResult = BuiltContextCapsule | BlockedContextCapsule;

export interface ContextCapsuleRef {
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly content: string;
}

export interface ContextCapsuleFreshnessInput {
  readonly expectedLifecycleIssue: number | null;
  readonly expectedConversationAnchor?: string | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly frontmatter: ContextCapsuleFrontmatter;
}

export interface ContextCapsuleFreshnessResult {
  readonly status: CapsuleFreshnessStatus;
  readonly reasons: readonly string[];
  readonly staleSourceFiles: readonly string[];
}

export function isCapsuleStatus(value: string): value is CapsuleStatus {
  return (CAPSULE_STATUSES as readonly string[]).includes(value);
}

export function isDispatchKind(value: string): value is DispatchKind {
  return (DISPATCH_KINDS as readonly string[]).includes(value);
}

export function isGeneratorAgent(value: string): value is GeneratorAgent {
  return (GENERATOR_AGENTS as readonly string[]).includes(value);
}
```

**Verify:** `bun test tests/agents/context-capsule/types.test.ts`
**Commit:** `feat(agents): add v2 dispatch_kind / generated_by / conversation_anchor types`

---

### Task 1.2: v2 builder input contract test scaffold
**File:** `tests/agents/context-capsule/builder-v2.test.ts` (NEW)
**Test:** self (this IS the test)
**Depends:** none (Task 2.1 implementation will satisfy the assertions; this task only writes failing tests)
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Locks the v2 builder contract: v2 fields propagate into frontmatter; v1 callers (no v2 fields) still produce a valid v1-shaped frontmatter with the new fields set to null; secret detection still works with v2 fields present.
**Review policy:** mandatory — test-only file, but it pins the builder behavioral contract that the executor / primary agents depend on at runtime.

```typescript
// tests/agents/context-capsule/builder-v2.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { parseContextCapsuleDocument } from "@/agents/context-capsule/store";

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), "capsule-v2-"));
});

describe("builder v2 fields", () => {
  it("writes conversation_anchor, generated_by, dispatch_kind, parent_capsule into frontmatter", () => {
    const result = buildContextCapsule({
      topic: "conv-test",
      lifecycleIssue: null,
      branch: "issue/x",
      headSha: "abc",
      worktree: "/tmp/x",
      sourceFiles: [],
      confirmedFacts: ["ok"],
      outputDir,
      conversationAnchor: "anchor-xyz",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
      parentCapsuleSha: "deadbeef",
      createdAt: new Date("2026-05-17T00:00:00Z"),
    });
    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") return;
    expect(result.frontmatter.conversation_anchor).toBe("anchor-xyz");
    expect(result.frontmatter.generated_by).toBe("commander");
    expect(result.frontmatter.dispatch_kind).toBe("executor-direct");
    expect(result.frontmatter.parent_capsule).toBe("deadbeef");
    expect(result.document).toContain("conversation_anchor:");
    expect(result.document).toContain("dispatch_kind:");
  });

  it("v1 callers (no v2 fields) still produce capsule with v2 fields=null", () => {
    const result = buildContextCapsule({
      topic: "v1-compat",
      lifecycleIssue: 42,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/y",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
    });
    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") return;
    expect(result.frontmatter.conversation_anchor).toBeNull();
    expect(result.frontmatter.generated_by).toBeNull();
    expect(result.frontmatter.dispatch_kind).toBeNull();
    expect(result.frontmatter.parent_capsule).toBeNull();
  });

  it("v2 capsule file name uses conv-<anchor>- prefix when lifecycleIssue is null", () => {
    const result = buildContextCapsule({
      topic: "fix-hub",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/z",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
      conversationAnchor: "anchor-001",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    expect(result.path).toContain("conv-anchor-001-");
  });

  it("v1 lifecycle-issue capsule file name keeps issue-<N>- prefix", () => {
    const result = buildContextCapsule({
      topic: "lifecycle",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    expect(result.path).toContain("issue-91-");
  });

  it("secret filter still triggers when v2 fields present", () => {
    const result = buildContextCapsule({
      topic: "leak",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/leak",
      sourceFiles: [],
      confirmedFacts: ["Authorization: Bearer abcdef1234567890"],
      outputDir,
      conversationAnchor: "a",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
    });
    expect(result.status).toBe("blocked");
  });

  it("frontmatter round-trips through parseContextCapsuleDocument", () => {
    const result = buildContextCapsule({
      topic: "round",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/r",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir,
      conversationAnchor: "anchor-42",
      generatedBy: "octto",
      dispatchKind: "single-subagent",
      parentCapsuleSha: null,
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    const parsed = parseContextCapsuleDocument(result.document);
    expect(parsed.frontmatter.conversation_anchor).toBe("anchor-42");
    expect(parsed.frontmatter.generated_by).toBe("octto");
    expect(parsed.frontmatter.dispatch_kind).toBe("single-subagent");
    expect(parsed.frontmatter.parent_capsule).toBeNull();
  });
});
```

**Verify:** `bun test tests/agents/context-capsule/builder-v2.test.ts` (expected to fail until Batch 2 Task 2.1 lands)
**Commit:** `test(agents): scaffold v2 builder contract tests`

---

### Task 1.3: v2 store + freshness contract test scaffold
**File:** `tests/agents/context-capsule/store-v2.test.ts` (NEW)
**Test:** self
**Depends:** none (Task 2.3 / 2.4 implementations will satisfy)
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Locks v2 store/freshness behavior: v1 (lifecycle_issue) match wins over v2 (conversation_anchor) when both present; v2 fallback returns latest within `(conversation_anchor, branch, worktree)`; freshness discards on conversation_anchor mismatch; deterministic tie-break by path lexicographic order.
**Review policy:** mandatory — pins reuse boundary; misorder would silently leak A's capsule into B's session.

```typescript
// tests/agents/context-capsule/store-v2.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findReusableContextCapsule } from "@/agents/context-capsule/store";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

function writeCapsule(dir: string, name: string, fm: Partial<ContextCapsuleFrontmatter>): string {
  const fullFm: ContextCapsuleFrontmatter = {
    lifecycle_issue: null,
    branch: "main",
    head_sha: "abc",
    worktree: "/tmp/w",
    created_at: "2026-05-17T00:00:00Z",
    source_files: [],
    source_hashes: {},
    conversation_anchor: null,
    generated_by: null,
    dispatch_kind: null,
    parent_capsule: null,
    ...fm,
  };
  const doc = [
    "---",
    `lifecycle_issue: ${fullFm.lifecycle_issue ?? "null"}`,
    `branch: "${fullFm.branch}"`,
    `head_sha: "${fullFm.head_sha}"`,
    `worktree: "${fullFm.worktree}"`,
    `created_at: "${fullFm.created_at}"`,
    `source_files: []`,
    `source_hashes: {}`,
    `conversation_anchor: ${fullFm.conversation_anchor === null ? "null" : `"${fullFm.conversation_anchor}"`}`,
    `generated_by: ${fullFm.generated_by === null ? "null" : `"${fullFm.generated_by}"`}`,
    `dispatch_kind: ${fullFm.dispatch_kind === null ? "null" : `"${fullFm.dispatch_kind}"`}`,
    `parent_capsule: ${fullFm.parent_capsule === null ? "null" : `"${fullFm.parent_capsule}"`}`,
    "---",
    "",
    "body",
    "",
  ].join("\n");
  const path = join(dir, name);
  writeFileSync(path, doc, "utf8");
  return path;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "capsule-store-v2-"));
});

describe("findReusableContextCapsule v2 matcher", () => {
  it("returns null when directory has no matching capsule", async () => {
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 99,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("v1 (lifecycle_issue) match wins over v2 conversation_anchor match", async () => {
    writeCapsule(dir, "issue-7-a-aaaaaaaaaaaaaaaa.md", {
      lifecycle_issue: 7,
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-b-bbbbbbbbbbbbbbbb.md", {
      lifecycle_issue: null,
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T01:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 7,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toContain("issue-7-");
  });

  it("v2 fallback returns latest (conversation_anchor, branch, worktree) when lifecycle is null", async () => {
    writeCapsule(dir, "conv-anchor-x-a-aaaaaaaaaaaaaaaa.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-b-bbbbbbbbbbbbbbbb.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T02:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toContain("conv-anchor-x-b-");
  });

  it("v2 fallback ignores capsules with mismatched conversation_anchor", async () => {
    writeCapsule(dir, "conv-anchor-other.md", {
      conversation_anchor: "anchor-other",
      branch: "main",
      worktree: "/tmp/w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("returns null when conversationAnchor is null and no lifecycle match", async () => {
    writeCapsule(dir, "conv-a.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: null,
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("deterministic tie-break: equal created_at falls back to path lex order", async () => {
    writeCapsule(dir, "conv-anchor-x-b.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-a.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toMatch(/conv-anchor-x-a\.md$/);
  });
});

describe("evaluateContextCapsuleFreshness v2 conversation dimension", () => {
  const base = {
    branch: "main",
    headSha: "abc",
    worktree: "/tmp/w",
    sourceHashes: {},
  };

  it("discards when frontmatter conversation_anchor mismatches expected", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-current",
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-old",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("discarded");
    expect(result.reasons).toContain("conversation_anchor_mismatch");
  });

  it("does NOT check conversation_anchor when expected is undefined (v1 backwards compat)", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: 7,
      frontmatter: {
        lifecycle_issue: 7,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-anything",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("fresh");
  });

  it("fresh when v2 conversation_anchor matches and lifecycle null on both sides", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-x",
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-x",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("fresh");
  });
});
```

**Verify:** `bun test tests/agents/context-capsule/store-v2.test.ts` (expected to fail until Batch 2 Tasks 2.3 / 2.4 land)
**Commit:** `test(agents): scaffold v2 store + freshness contract tests`

---

### Task 1.4: Conversation anchor extractor (NEW module)
**File:** `src/agents/context-capsule/conversation.ts` (NEW)
**Test:** `tests/agents/context-capsule/conversation.test.ts` (NEW)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Provides `resolveConversationAnchor(sessionId)` that hashes the OpenCode primary session id into a stable, leakage-safe 16-hex-char anchor; returns `null` when input is missing/empty so v2 path silently degrades to v1.
**Review policy:** mandatory — anchor stability and null-safety determine whether v2 reuse fires; a regression here either leaks raw session ids into capsule frontmatter or breaks all v2 reuse.

```typescript
// tests/agents/context-capsule/conversation.test.ts
import { describe, expect, it } from "bun:test";
import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";

describe("resolveConversationAnchor", () => {
  it("returns null when session id is undefined", () => {
    expect(resolveConversationAnchor(undefined)).toBeNull();
  });

  it("returns null when session id is null", () => {
    expect(resolveConversationAnchor(null)).toBeNull();
  });

  it("returns null when session id is empty string", () => {
    expect(resolveConversationAnchor("")).toBeNull();
  });

  it("returns null when session id is whitespace only", () => {
    expect(resolveConversationAnchor("   ")).toBeNull();
  });

  it("returns 16-hex-char hash for non-empty session id", () => {
    const anchor = resolveConversationAnchor("ses_01HXYZ");
    expect(anchor).not.toBeNull();
    expect(anchor).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same session id", () => {
    expect(resolveConversationAnchor("ses_01HXYZ")).toBe(resolveConversationAnchor("ses_01HXYZ"));
  });

  it("produces different anchors for different session ids", () => {
    const a = resolveConversationAnchor("ses_A");
    const b = resolveConversationAnchor("ses_B");
    expect(a).not.toBe(b);
  });

  it("does not leak raw session id substring", () => {
    const anchor = resolveConversationAnchor("ses_VERY_SECRET_TOKEN_12345");
    expect(anchor).not.toContain("SECRET");
    expect(anchor).not.toContain("ses_");
  });

  it("trims surrounding whitespace before hashing", () => {
    const a = resolveConversationAnchor("ses_X");
    const b = resolveConversationAnchor("  ses_X  ");
    expect(a).toBe(b);
  });
});
```

```typescript
// src/agents/context-capsule/conversation.ts
import { createHash } from "node:crypto";

const ANCHOR_LENGTH = 16;

/**
 * Hash an OpenCode primary session id into a stable, leak-safe conversation anchor.
 * Returns null when sessionId is missing, empty, or whitespace-only so v2 reuse
 * silently degrades to v1 (lifecycle-issue-only) without blocking the dispatch.
 */
export function resolveConversationAnchor(sessionId: string | null | undefined): string | null {
  if (sessionId === null || sessionId === undefined) return null;
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) return null;
  return createHash("sha256").update(trimmed).digest("hex").slice(0, ANCHOR_LENGTH);
}
```

**Verify:** `bun test tests/agents/context-capsule/conversation.test.ts`
**Commit:** `feat(agents): add conversation anchor extractor with graceful null degrade`

---

## Batch 2: Core Capsule Runtime (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Builder writes v2 frontmatter + v2 filename prefix
**File:** `src/agents/context-capsule/builder.ts`
**Test:** `tests/agents/context-capsule/builder.test.ts` (extend existing) + Task 1.2's `builder-v2.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Builder propagates `conversationAnchor` / `generatedBy` / `dispatchKind` / `parentCapsuleSha` into frontmatter as null when omitted, and switches the file name prefix from `issue-<N>-` to `conv-<anchor>-` when `lifecycleIssue` is null and an anchor is present. Existing immutable / secret / soft-window behavior preserved.
**Review policy:** mandatory — runtime that writes files to disk; secret filter / immutable contract / byte-identical output all anchor here.

```typescript
// tests/agents/context-capsule/builder.test.ts — append at end
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { buildContextCapsule as build2 } from "@/agents/context-capsule/builder";
import { mkdtempSync as mkd2 } from "node:fs";
import { tmpdir as tmp2 } from "node:os";
import { join as join2 } from "node:path";

describe2("builder v1 backwards compat", () => {
  it2("emits null v2 fields for legacy callers", () => {
    const out = mkd2(join2(tmp2(), "cap-v1-"));
    const r = build2({
      topic: "legacy",
      lifecycleIssue: 1,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp",
      sourceFiles: [],
      confirmedFacts: ["a"],
      outputDir: out,
    });
    if (r.status !== "fresh") throw new Error("expected fresh");
    expect2(r.frontmatter.conversation_anchor).toBeNull();
    expect2(r.frontmatter.generated_by).toBeNull();
    expect2(r.frontmatter.dispatch_kind).toBeNull();
    expect2(r.frontmatter.parent_capsule).toBeNull();
  });
});
```

```typescript
// src/agents/context-capsule/builder.ts — full replacement
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCapsuleToken, hashText, renderCapsuleDocument, slugifyCapsuleTopic } from "./format";
import { assertCapsuleSafe } from "./redact";
import type {
  BuildContextCapsuleResult,
  BuiltContextCapsule,
  ContextCapsuleBuildInput,
  ContextCapsuleFrontmatter,
} from "./types";

const DEFAULT_OUTPUT_DIR = join("thoughts", "shared", "context-capsules");
const SOFT_WINDOW_WARNING_THRESHOLD = 1;

function getOutputDir(input: ContextCapsuleBuildInput): string {
  return input.outputDir ?? join(input.worktree, DEFAULT_OUTPUT_DIR);
}

function buildSourceHashes(input: ContextCapsuleBuildInput): Readonly<Record<string, string>> {
  return Object.fromEntries(input.sourceFiles.map((s) => [s.path, hashText(s.content)]));
}

function buildFrontmatter(input: ContextCapsuleBuildInput): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: input.lifecycleIssue,
    branch: input.branch,
    head_sha: input.headSha,
    worktree: input.worktree,
    created_at: (input.createdAt ?? new Date()).toISOString(),
    source_files: input.sourceFiles.map((s) => s.path).sort(),
    source_hashes: buildSourceHashes(input),
    conversation_anchor: input.conversationAnchor ?? null,
    generated_by: input.generatedBy ?? null,
    dispatch_kind: input.dispatchKind ?? null,
    parent_capsule: input.parentCapsuleSha ?? null,
  };
}

function renderBullets(values: readonly string[], emptyText: string): string {
  if (values.length === 0) return `- ${emptyText}`;
  return values.map((v) => `- ${v}`).join("\n");
}

function renderSourceFiles(fm: ContextCapsuleFrontmatter): string {
  if (fm.source_files.length === 0) return "- none";
  return fm.source_files.map((p) => `- \`${p}\` — sha256: ${fm.source_hashes[p] ?? "missing"}`).join("\n");
}

function renderCapsuleBody(input: ContextCapsuleBuildInput, fm: ContextCapsuleFrontmatter): string {
  return [
    "## Confirmed Facts",
    "",
    renderBullets(input.confirmedFacts, "none"),
    "",
    "## Source Files",
    "",
    renderSourceFiles(fm),
  ].join("\n");
}

function findUnsafeInput(input: ContextCapsuleBuildInput): { readonly scope: string; readonly reason: string } | null {
  for (const fact of input.confirmedFacts) {
    const r = assertCapsuleSafe(fact);
    if (!r.ok) return { scope: "confirmedFacts", reason: r.match.reason };
  }
  for (const source of input.sourceFiles) {
    const r = assertCapsuleSafe(source.content);
    if (!r.ok) return { scope: `sourceFiles:${source.path}`, reason: r.match.reason };
  }
  return null;
}

function buildWarnings(input: ContextCapsuleBuildInput): readonly string[] {
  if (input.softWindowRatio === undefined || input.softWindowRatio <= SOFT_WINDOW_WARNING_THRESHOLD) return [];
  return [`soft_window_ratio: ${input.softWindowRatio}`];
}

function makeCapsulePath(outputDir: string, input: ContextCapsuleBuildInput, token: string): string {
  const topicSlug = slugifyCapsuleTopic(input.topic);
  if (input.lifecycleIssue !== null && input.lifecycleIssue !== undefined) {
    return join(outputDir, `issue-${input.lifecycleIssue}-${topicSlug}-${token}.md`);
  }
  if (input.conversationAnchor) {
    return join(outputDir, `conv-${input.conversationAnchor}-${topicSlug}-${token}.md`);
  }
  return join(outputDir, `no-issue-${topicSlug}-${token}.md`);
}

function writeImmutableFile(path: string, document: string): void {
  if (existsSync(path)) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, document, "utf8");
}

export function buildContextCapsule(input: ContextCapsuleBuildInput): BuildContextCapsuleResult {
  const unsafe = findUnsafeInput(input);
  if (unsafe) return { status: "blocked", reason: "secret_detected", detail: `${unsafe.scope}: ${unsafe.reason}` };

  const frontmatter = buildFrontmatter(input);
  const body = renderCapsuleBody(input, frontmatter);
  const document = renderCapsuleDocument(frontmatter, body);
  const safety = assertCapsuleSafe(document);
  if (!safety.ok) return { status: "blocked", reason: "secret_detected", detail: `document: ${safety.match.reason}` };

  const token = createCapsuleToken(frontmatter);
  const path = makeCapsulePath(getOutputDir(input), input, token);
  writeImmutableFile(path, document);

  const result: BuiltContextCapsule = {
    status: "fresh",
    path,
    sha: hashText(document),
    token,
    frontmatter,
    body,
    document,
    warnings: buildWarnings(input),
  };
  return result;
}
```

**Verify:** `bun test tests/agents/context-capsule/builder.test.ts tests/agents/context-capsule/builder-v2.test.ts`
**Commit:** `feat(agents): builder writes v2 frontmatter + conv-<anchor> filename`

---

### Task 2.2: Format renderer emits v2 frontmatter keys deterministically
**File:** `src/agents/context-capsule/format.ts`
**Test:** `tests/agents/context-capsule/format.test.ts` (extend existing)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** `renderCapsuleDocument` outputs the four new keys (`conversation_anchor`, `generated_by`, `dispatch_kind`, `parent_capsule`) in a stable order so byte-identical injection across parallel workers is preserved. Token hash includes v2 fields so v1 and v2 capsules with otherwise-identical state still produce distinct tokens.
**Review policy:** mandatory — byte-identical drift = silent prompt-cache miss; token-hash drift = false freshness hits across dispatch kinds.

```typescript
// tests/agents/context-capsule/format.test.ts — append
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { renderCapsuleDocument, createCapsuleToken } from "@/agents/context-capsule/format";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

const baseFm: ContextCapsuleFrontmatter = {
  lifecycle_issue: null,
  branch: "main",
  head_sha: "abc",
  worktree: "/tmp",
  created_at: "2026-05-17T00:00:00Z",
  source_files: [],
  source_hashes: {},
  conversation_anchor: "anchor-x",
  generated_by: "commander",
  dispatch_kind: "executor-direct",
  parent_capsule: null,
};

describe2("renderCapsuleDocument v2 keys", () => {
  it2("emits all four v2 keys in stable order", () => {
    const doc = renderCapsuleDocument(baseFm, "body");
    const idxConv = doc.indexOf("conversation_anchor:");
    const idxGen = doc.indexOf("generated_by:");
    const idxKind = doc.indexOf("dispatch_kind:");
    const idxParent = doc.indexOf("parent_capsule:");
    expect2(idxConv).toBeGreaterThan(-1);
    expect2(idxGen).toBeGreaterThan(idxConv);
    expect2(idxKind).toBeGreaterThan(idxGen);
    expect2(idxParent).toBeGreaterThan(idxKind);
  });

  it2("emits null literally for absent v2 fields", () => {
    const fm: ContextCapsuleFrontmatter = {
      ...baseFm,
      conversation_anchor: null,
      generated_by: null,
      dispatch_kind: null,
      parent_capsule: null,
    };
    const doc = renderCapsuleDocument(fm, "body");
    expect2(doc).toContain("conversation_anchor: null");
    expect2(doc).toContain("generated_by: null");
    expect2(doc).toContain("dispatch_kind: null");
    expect2(doc).toContain("parent_capsule: null");
  });

  it2("byte-identical for the same frontmatter input", () => {
    expect2(renderCapsuleDocument(baseFm, "body")).toBe(renderCapsuleDocument(baseFm, "body"));
  });
});

describe2("createCapsuleToken v2 sensitivity", () => {
  it2("differs when conversation_anchor differs", () => {
    const a = createCapsuleToken(baseFm);
    const b = createCapsuleToken({ ...baseFm, conversation_anchor: "anchor-y" });
    expect2(a).not.toBe(b);
  });

  it2("differs when dispatch_kind differs", () => {
    const a = createCapsuleToken(baseFm);
    const b = createCapsuleToken({ ...baseFm, dispatch_kind: "single-subagent" });
    expect2(a).not.toBe(b);
  });
});
```

```typescript
// src/agents/context-capsule/format.ts — replace renderCapsuleDocument and createCapsuleToken
import { createHash } from "node:crypto";
import type { ContextCapsuleFrontmatter } from "./types";

const FALLBACK_TOPIC = "context-capsule";
const MAX_SLUG_LENGTH = 80;
const CAPSULE_TOKEN_LENGTH = 16;

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function slugifyCapsuleTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug : FALLBACK_TOPIC;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function renderStringArray(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `\n${[...values].sort().map((v) => `  - ${quoteYaml(v)}`).join("\n")}`;
}

function renderStringRecord(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return "{}";
  return `\n${entries.map(([k, v]) => `  ${quoteYaml(k)}: ${quoteYaml(v)}`).join("\n")}`;
}

function renderOptionalString(value: string | null): string {
  return value === null ? "null" : quoteYaml(value);
}

export function renderCapsuleDocument(frontmatter: ContextCapsuleFrontmatter, body: string): string {
  const fm: ContextCapsuleFrontmatter = {
    ...frontmatter,
    source_files: [...frontmatter.source_files].sort(),
    source_hashes: Object.fromEntries(
      Object.entries(frontmatter.source_hashes).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  return [
    "---",
    `lifecycle_issue: ${fm.lifecycle_issue ?? "null"}`,
    `branch: ${quoteYaml(fm.branch)}`,
    `head_sha: ${quoteYaml(fm.head_sha)}`,
    `worktree: ${quoteYaml(fm.worktree)}`,
    `created_at: ${quoteYaml(fm.created_at)}`,
    `source_files:${renderStringArray(fm.source_files)}`,
    `source_hashes:${renderStringRecord(fm.source_hashes)}`,
    `conversation_anchor: ${renderOptionalString(fm.conversation_anchor)}`,
    `generated_by: ${renderOptionalString(fm.generated_by)}`,
    `dispatch_kind: ${renderOptionalString(fm.dispatch_kind)}`,
    `parent_capsule: ${renderOptionalString(fm.parent_capsule)}`,
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

export function createCapsuleToken(frontmatter: ContextCapsuleFrontmatter): string {
  return hashText(
    JSON.stringify({
      lifecycle_issue: frontmatter.lifecycle_issue,
      branch: frontmatter.branch,
      head_sha: frontmatter.head_sha,
      worktree: frontmatter.worktree,
      source_hashes: Object.fromEntries(
        Object.entries(frontmatter.source_hashes).sort(([a], [b]) => a.localeCompare(b)),
      ),
      conversation_anchor: frontmatter.conversation_anchor,
      dispatch_kind: frontmatter.dispatch_kind,
    }),
  ).slice(0, CAPSULE_TOKEN_LENGTH);
}
```

**Verify:** `bun test tests/agents/context-capsule/format.test.ts`
**Commit:** `feat(agents): render v2 frontmatter keys with deterministic order and v2-sensitive token`

---

### Task 2.3: Store gains v2 reusable matcher + parses v2 frontmatter
**File:** `src/agents/context-capsule/store.ts`
**Test:** `tests/agents/context-capsule/store.test.ts` (extend existing) + Task 1.3's `store-v2.test.ts`
**Depends:** 1.1, 2.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** New exported `findReusableContextCapsule({ directory, lifecycleIssue, conversationAnchor, branch, worktree })` returns the highest-priority capsule: tier-1 = `(lifecycle_issue, branch, worktree)` match, tier-2 fallback = `(conversation_anchor, branch, worktree)` match. Within a tier, sort by `created_at desc, path asc`. Existing `findLatestContextCapsule` kept as v1-compatible export for any caller not yet upgraded.
**Review policy:** mandatory — reuse boundary; tier order misconfiguration silently leaks A's capsule into B.

```typescript
// tests/agents/context-capsule/store.test.ts — append v2 parsing assertions
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { parseContextCapsuleDocument } from "@/agents/context-capsule/store";

describe2("parseContextCapsuleDocument v2 fields", () => {
  it2("parses conversation_anchor / generated_by / dispatch_kind / parent_capsule", () => {
    const doc = [
      "---",
      'lifecycle_issue: null',
      'branch: "main"',
      'head_sha: "abc"',
      'worktree: "/tmp"',
      'created_at: "2026-05-17T00:00:00Z"',
      "source_files: []",
      "source_hashes: {}",
      'conversation_anchor: "anchor-x"',
      'generated_by: "commander"',
      'dispatch_kind: "executor-direct"',
      "parent_capsule: null",
      "---",
      "",
      "body",
    ].join("\n");
    const parsed = parseContextCapsuleDocument(doc);
    expect2(parsed.frontmatter.conversation_anchor).toBe("anchor-x");
    expect2(parsed.frontmatter.generated_by).toBe("commander");
    expect2(parsed.frontmatter.dispatch_kind).toBe("executor-direct");
    expect2(parsed.frontmatter.parent_capsule).toBeNull();
  });

  it2("falls back to null when v2 keys absent (v1 file)", () => {
    const doc = [
      "---",
      "lifecycle_issue: 7",
      'branch: "main"',
      'head_sha: "abc"',
      'worktree: "/tmp"',
      'created_at: "2026-05-17T00:00:00Z"',
      "source_files: []",
      "source_hashes: {}",
      "---",
      "",
      "body",
    ].join("\n");
    const parsed = parseContextCapsuleDocument(doc);
    expect2(parsed.frontmatter.conversation_anchor).toBeNull();
    expect2(parsed.frontmatter.generated_by).toBeNull();
    expect2(parsed.frontmatter.dispatch_kind).toBeNull();
    expect2(parsed.frontmatter.parent_capsule).toBeNull();
  });
});
```

```typescript
// src/agents/context-capsule/store.ts — full replacement
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { createCapsuleToken, hashText } from "./format";
import type {
  ContextCapsuleFrontmatter,
  ContextCapsuleRef,
  DispatchKind,
  GeneratorAgent,
} from "./types";
import { isDispatchKind, isGeneratorAgent } from "./types";

export const DEFAULT_CONTEXT_CAPSULE_DIRECTORY = "thoughts/shared/context-capsules";

const FRONTMATTER_OPEN = "---\n";
const FRONTMATTER_CLOSE = "\n---";
const FRONTMATTER_CLOSE_WITH_NEWLINE = "\n---\n";

export interface ParsedContextCapsuleDocument {
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asDispatchKind(value: unknown): DispatchKind | null {
  return typeof value === "string" && isDispatchKind(value) ? value : null;
}

function asGeneratorAgent(value: unknown): GeneratorAgent | null {
  return typeof value === "string" && isGeneratorAgent(value) ? value : null;
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").sort();
}

function asStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function normalizeLifecycleIssue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeFrontmatter(value: unknown): ContextCapsuleFrontmatter {
  const fm = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const r = fm as Record<string, unknown>;
  return {
    lifecycle_issue: normalizeLifecycleIssue(r.lifecycle_issue),
    branch: asString(r.branch),
    head_sha: asString(r.head_sha),
    worktree: asString(r.worktree),
    created_at: asString(r.created_at),
    source_files: asStringArray(r.source_files),
    source_hashes: asStringRecord(r.source_hashes),
    conversation_anchor: asNullableString(r.conversation_anchor),
    generated_by: asGeneratorAgent(r.generated_by),
    dispatch_kind: asDispatchKind(r.dispatch_kind),
    parent_capsule: asNullableString(r.parent_capsule),
  };
}

export function parseContextCapsuleDocument(document: string): ParsedContextCapsuleDocument {
  if (!document.startsWith(FRONTMATTER_OPEN)) return { frontmatter: normalizeFrontmatter({}), body: document };
  const end = document.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
  if (end === -1) return { frontmatter: normalizeFrontmatter({}), body: document };
  const text = document.slice(FRONTMATTER_OPEN.length, end);
  let bodyStart = document.startsWith(FRONTMATTER_CLOSE_WITH_NEWLINE, end)
    ? end + FRONTMATTER_CLOSE_WITH_NEWLINE.length
    : end + FRONTMATTER_CLOSE.length;
  if (document.startsWith("\n", bodyStart)) bodyStart += 1;
  return { frontmatter: normalizeFrontmatter(parse(text)), body: document.slice(bodyStart) };
}

interface CapsuleRecord extends ContextCapsuleRef {
  readonly createdAt: number;
  readonly frontmatter: ContextCapsuleFrontmatter;
}

async function readCapsuleRecord(path: string): Promise<CapsuleRecord | null> {
  const content = await readFile(path, "utf-8");
  const { frontmatter } = parseContextCapsuleDocument(content);
  const createdAt = Date.parse(frontmatter.created_at);
  if (Number.isNaN(createdAt)) return null;
  return {
    path,
    content,
    sha: hashText(content),
    token: createCapsuleToken(frontmatter),
    createdAt,
    frontmatter,
  };
}

async function readAllCapsules(directory: string): Promise<readonly CapsuleRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records = await Promise.all(
    entries.filter((e) => e.endsWith(".md")).map((e) => readCapsuleRecord(join(directory, e))),
  );
  return records.filter((r): r is CapsuleRecord => r !== null);
}

function compareNewestFirst(a: CapsuleRecord, b: CapsuleRecord): number {
  return b.createdAt - a.createdAt || a.path.localeCompare(b.path);
}

function toRef(record: CapsuleRecord): ContextCapsuleRef {
  const { path, content, sha, token } = record;
  return { path, content, sha, token };
}

export async function findLatestContextCapsule(
  directory = DEFAULT_CONTEXT_CAPSULE_DIRECTORY,
): Promise<ContextCapsuleRef | null> {
  const all = await readAllCapsules(directory);
  if (all.length === 0) return null;
  return toRef([...all].sort(compareNewestFirst)[0]);
}

export interface FindReusableInput {
  readonly directory?: string;
  readonly lifecycleIssue: number | null;
  readonly conversationAnchor: string | null;
  readonly branch: string;
  readonly worktree: string;
}

export async function findReusableContextCapsule(input: FindReusableInput): Promise<ContextCapsuleRef | null> {
  const all = await readAllCapsules(input.directory ?? DEFAULT_CONTEXT_CAPSULE_DIRECTORY);
  if (all.length === 0) return null;

  if (input.lifecycleIssue !== null) {
    const tier1 = all
      .filter(
        (r) =>
          r.frontmatter.lifecycle_issue === input.lifecycleIssue &&
          r.frontmatter.branch === input.branch &&
          r.frontmatter.worktree === input.worktree,
      )
      .sort(compareNewestFirst);
    if (tier1.length > 0) return toRef(tier1[0]);
  }

  if (input.conversationAnchor !== null) {
    const tier2 = all
      .filter(
        (r) =>
          r.frontmatter.conversation_anchor === input.conversationAnchor &&
          r.frontmatter.branch === input.branch &&
          r.frontmatter.worktree === input.worktree,
      )
      .sort(compareNewestFirst);
    if (tier2.length > 0) return toRef(tier2[0]);
  }

  return null;
}
```

**Verify:** `bun test tests/agents/context-capsule/store.test.ts tests/agents/context-capsule/store-v2.test.ts`
**Commit:** `feat(agents): store gains v2 two-tier reusable matcher + frontmatter parser`

---

### Task 2.4: Freshness adds conversation_anchor dimension
**File:** `src/agents/context-capsule/freshness.ts`
**Test:** `tests/agents/context-capsule/freshness.test.ts` (extend existing) + Task 1.3's `store-v2.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** When `expectedConversationAnchor` is provided (not undefined), a mismatch against the frontmatter's `conversation_anchor` produces `discarded` with reason `conversation_anchor_mismatch`. Undefined `expectedConversationAnchor` preserves v1 freshness semantics exactly.
**Review policy:** mandatory — wrong polarity here either allows cross-conversation leakage or breaks v1 lifecycle reuse.

```typescript
// tests/agents/context-capsule/freshness.test.ts — append
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

const fm: ContextCapsuleFrontmatter = {
  lifecycle_issue: null,
  branch: "main",
  head_sha: "abc",
  worktree: "/tmp",
  created_at: "2026-05-17T00:00:00Z",
  source_files: [],
  source_hashes: {},
  conversation_anchor: "anchor-x",
  generated_by: "commander",
  dispatch_kind: "executor-direct",
  parent_capsule: null,
};

describe2("freshness v2 conversation_anchor", () => {
  it2("discards on mismatched expectedConversationAnchor", () => {
    const r = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-other",
      branch: "main",
      headSha: "abc",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: fm,
    });
    expect2(r.status).toBe("discarded");
    expect2(r.reasons).toContain("conversation_anchor_mismatch");
  });

  it2("does not check when expectedConversationAnchor is undefined", () => {
    const r = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: fm,
    });
    expect2(r.status).toBe("fresh");
  });

  it2("fresh when expected matches frontmatter", () => {
    const r = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-x",
      branch: "main",
      headSha: "abc",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: fm,
    });
    expect2(r.status).toBe("fresh");
  });

  it2("expected anchor X, frontmatter null → discarded", () => {
    const r = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-x",
      branch: "main",
      headSha: "abc",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: { ...fm, conversation_anchor: null },
    });
    expect2(r.status).toBe("discarded");
    expect2(r.reasons).toContain("conversation_anchor_mismatch");
  });
});
```

```typescript
// src/agents/context-capsule/freshness.ts — full replacement
import type { ContextCapsuleFreshnessInput, ContextCapsuleFreshnessResult } from "./types";

const HARD_DISCARD_REASONS = [
  "lifecycle_issue_mismatch",
  "branch_mismatch",
  "worktree_mismatch",
  "conversation_anchor_mismatch",
] as const;

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function findStaleSourceFiles(input: ContextCapsuleFreshnessInput): readonly string[] {
  const all = new Set([...input.frontmatter.source_files, ...Object.keys(input.frontmatter.source_hashes)]);
  for (const file of Object.keys(input.sourceHashes)) all.add(file);
  return sortedUnique(
    [...all].filter((file) => input.frontmatter.source_hashes[file] !== input.sourceHashes[file]),
  );
}

export function evaluateContextCapsuleFreshness(input: ContextCapsuleFreshnessInput): ContextCapsuleFreshnessResult {
  const discard: string[] = [];

  if (input.frontmatter.lifecycle_issue !== input.expectedLifecycleIssue) discard.push(HARD_DISCARD_REASONS[0]);
  if (input.frontmatter.branch !== input.branch) discard.push(HARD_DISCARD_REASONS[1]);
  if (input.frontmatter.worktree !== input.worktree) discard.push(HARD_DISCARD_REASONS[2]);
  if (
    input.expectedConversationAnchor !== undefined &&
    input.frontmatter.conversation_anchor !== input.expectedConversationAnchor
  ) {
    discard.push(HARD_DISCARD_REASONS[3]);
  }

  if (discard.length > 0) return { status: "discarded", reasons: discard, staleSourceFiles: [] };

  const stale = findStaleSourceFiles(input);
  const reasons: string[] = [];
  if (input.frontmatter.head_sha !== input.headSha) reasons.push("head_sha_changed");
  if (stale.length > 0) reasons.push("source_hashes_changed");

  if (reasons.length > 0) return { status: "partially-stale", reasons, staleSourceFiles: stale };
  return { status: "fresh", reasons: [], staleSourceFiles: [] };
}
```

**Verify:** `bun test tests/agents/context-capsule/freshness.test.ts`
**Commit:** `feat(agents): freshness adds conversation_anchor discard dimension`

---

## Batch 3: Protocol + Agent Prompts + AGENTS.md (parallel - 8 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8

### Task 3.1: Re-export v2 module surface
**File:** `src/agents/context-capsule/index.ts`
**Test:** none (re-export-only glue; covered by callers' tests)
**Depends:** 1.4, 2.1, 2.2, 2.3, 2.4
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Adds `./conversation` to the barrel export so primary agents and the spawn-agent tool can import `resolveConversationAnchor`. Keeps existing exports intact so v1 callers don't break.
**Review policy:** mandatory — module surface contract; missing re-export silently makes v2 path inaccessible to primary agents.

```typescript
// src/agents/context-capsule/index.ts
export * from "./builder";
export * from "./conversation";
export * from "./format";
export * from "./freshness";
export * from "./injector";
export * from "./redact";
export * from "./store";
export * from "./types";
```

**Verify:** `bun test tests/agents/context-capsule/` (full suite still green)
**Commit:** `feat(agents): re-export conversation anchor module`

---

### Task 3.2: Extend shared `CONTEXT_CAPSULE_PROTOCOL` with v2 trigger clause
**File:** `src/agents/context-capsule-protocol.ts`
**Test:** `tests/agents/context-capsule-protocol.test.ts` (extend existing)
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update (atlas/20-behavior subagent-dispatch reuse node — described in Behavior section)
**Behavior-impact:** Single-source v2 trigger contract: "派遣前查找+复用、派遣后生成" applies to single-subagent and executor-direct dispatches in addition to parallel fan-out. Same-conversation reuse boundary documented: `(conversation_anchor, branch, worktree)` fallback when `lifecycle_issue` is null. Capsule status enum unchanged. OpenCode restart → anchor lost → no recovery attempt; first post-restart dispatch shows `none`.
**Review policy:** mandatory — drift-guarded byte-identical block injected into brainstormer / commander / executor; semantic regression silently breaks all three.

```typescript
// tests/agents/context-capsule-protocol.test.ts — append (do not remove existing v1 assertions)
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe2("v2 trigger clauses present in shared protocol", () => {
  it2("documents v2 dispatch triggers", () => {
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("派遣前查找+复用、派遣后生成");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("single-subagent");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("executor-direct");
  });

  it2("documents v2 reuse boundary", () => {
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("conversation_anchor");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("(conversation_anchor, branch, worktree)");
  });

  it2("documents OpenCode restart degrades to none without recovery", () => {
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("OpenCode restart");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("no-conversation-anchor");
  });

  it2("preserves v1 invariants", () => {
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("byte-identical");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("user prompt TOP");
    expect2(CONTEXT_CAPSULE_PROTOCOL).toContain("worker still must read its own target files");
  });
});
```

```typescript
// src/agents/context-capsule-protocol.ts — full replacement
export const CONTEXT_CAPSULE_PROTOCOL = `<context-capsule-protocol priority="critical" description="Immutable hot-path context prefix for subagent prompt cache reuse">
<purpose>
The Context Capsule is an immutable, short-lived hot-path artifact that carries already-read and already-confirmed facts into subagent user prompts. It is not durable knowledge, not Project Memory, not Atlas, not a replacement for context-brief, and not a live subagent session fork.
</purpose>

<injection-contract>
- Inject the capsule into the user prompt TOP, before spawn-meta, before context-brief, before task-specific instructions.
- Never inject capsule content into a system prompt or agent definition.
- The exact <context-capsule>...</context-capsule> block for one fan-out MUST be byte-identical across every parallel worker so provider prompt cache can hit.
- Task-specific deltas stay after the capsule. Existing <context-brief> remains the per-task executor/reviewer contract and must not be replaced by the capsule.
</injection-contract>

<dispatch-trigger>
- v2 trigger contract: 派遣前查找+复用、派遣后生成 applies to every sub-dispatch shape, not only parallel fan-out:
  - parallel-fanout (≥2 subagents in one batch): build once, inject into every worker byte-identically.
  - single-subagent (Task / spawn_agent with one entry): same flow; one worker.
  - executor-direct (commander → executor-direct single session): same flow; executor-direct receives capsule but does NOT itself build a new capsule nor spawn subagents.
- Before any sub-dispatch: call findReusableContextCapsule with the current (lifecycleIssue, conversationAnchor, branch, worktree); on hit, run freshness preflight, then inject.
- After the sub-dispatch returns: build a new immutable capsule capturing this round's confirmed facts so the next sub-dispatch in the same conversation can reuse it. Builder runs in milliseconds and must not block the final user-facing reply.
</dispatch-trigger>

<reuse-boundary>
- Tier-1 reuse (v1): same lifecycle issue, same branch, same worktree.
- Tier-2 reuse (v2 fallback when lifecycle_issue is null): same conversation_anchor, same branch, same worktree.
- Tier-1 always wins over tier-2 when both could match.
- Freshness preflight checks lifecycle issue, branch, HEAD SHA, worktree, source file hashes, and (v2 only) conversation_anchor before reuse.
- Cross-conversation reuse is forbidden: a capsule whose conversation_anchor does not match the current session's anchor is discarded, even if branch and worktree match.
- Freshness result must be surfaced as Capsule status: <none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>.
- OpenCode restart invalidates the in-memory primary session id, which changes the conversation_anchor. The first sub-dispatch after restart will see Capsule status: none (or skipped:no-conversation-anchor when the anchor cannot be resolved). Do not attempt to recover; the second sub-dispatch onward will populate fresh capsules normally.
</reuse-boundary>

<safety-boundary>
- Secret filtering is mandatory before writing any capsule file.
- Do not write Authorization headers, tokens, private URLs, .env style values, raw logs, or credentials into a capsule.
- Capsule is not durable knowledge: do not promote it to Project Memory, do not write it into Atlas, and do not treat it as a long-term source of truth.
- The worker still must read its own target files before editing or reviewing. Capsule facts are a warm start, not the final evidence source.
- Do not extend resume_subagent, do not fork live sessions, and do not change lifecycle recovery semantics for capsule reuse.
- Immutable file philosophy: every sub-dispatch generates a new capsule file under thoughts/shared/context-capsules/; never edit a prior capsule in place.
</safety-boundary>
</context-capsule-protocol>`;
```

**Verify:** `bun test tests/agents/context-capsule-protocol.test.ts`
**Commit:** `feat(agents): extend shared CONTEXT_CAPSULE_PROTOCOL with v2 trigger and conversation_anchor boundary`

---

### Task 3.3: Spawn-agent tool docs note v2 capsule path unchanged
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** none (comment-only change; existing tests cover behavior)
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Adds a comment above `applyContextCapsulePrefix` documenting that the spawn-agent runtime does not change between v1 and v2: capsule is opaque to the tool, primary agents own the find / build cycle and pass the ref via `contextCapsule`. No code change.
**Review policy:** mandatory — even comment changes near a runtime injection point need reviewer sign-off (executor-direct path is now in scope and any wording slip can mislead future maintainers).

```typescript
// Edit: in src/tools/spawn-agent/tool.ts, immediately above the line
//   parts: [{ type: "text" as const, text: applyContextCapsulePrefix(task.prompt, task.contextCapsule) }],
// insert this comment block:

// v2 unchanged: the spawn-agent runtime is opaque to capsule shape. Primary agents
// (commander / brainstormer / octto) own the find / build cycle and pass an
// already-resolved ContextCapsuleRef via task.contextCapsule. v2's new
// conversation_anchor / dispatch_kind / generated_by / parent_capsule live entirely
// inside that ref's content and frontmatter; the tool never inspects them.
```

**Verify:** `bun test tests/tools/spawn-agent/` (no behavior change expected)
**Commit:** `docs(tools): note v2 capsule path is opaque to spawn-agent runtime`

---

### Task 3.4: Knowledge-context section keeps Capsule status line (no change, drift guard reaffirmation)
**File:** `src/agents/knowledge-context-section.ts`
**Test:** none (existing drift guard already asserts Capsule status line; no code change)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** This task explicitly confirms the single-source `KNOWLEDGE_CONTEXT_SECTION` already emits `Capsule status:` and DOES NOT NEED EDITING for v2. The v2 enum values (`fresh`, `partially-stale`, `discarded`, `skipped:no-conversation-anchor`, `blocked:secret_detected`, `none`) are already covered by the v1 enum `<none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>`. Task exists so the executor cannot accidentally skip verifying that no edit is required.
**Review policy:** mandatory — reviewer must verify no v2 edit slipped in; touching this single source would break the existing byte-identical commander/brainstormer/octto mirror.

```
# No edit. Reviewer verifies:
git diff src/agents/knowledge-context-section.ts
# expected output: empty
```

**Verify:** `git diff --exit-code src/agents/knowledge-context-section.ts && bun test tests/agents/effect-first-reporting.test.ts`
**Commit:** (none — this task produces no diff; if a diff is needed, escalate to user)

---

### Task 3.5: Commander prompt — v2 dispatch hook
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts` (extended in Task 4.1)
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** layer-update (atlas/20-behavior subagent-dispatch node — commander now generates capsule for single-subagent and executor-direct)
**Behavior-impact:** Adds a `<context-capsule-v2-hook>` section to commander's prompt instructing:
  1. Before any sub-dispatch (Task / spawn_agent / executor-direct), call `findReusableContextCapsule({ lifecycleIssue, conversationAnchor: resolveConversationAnchor(sessionId), branch, worktree })`; on hit, run freshness preflight and inject via `applyContextCapsulePrefix` (or pass `contextCapsule` to spawn_agent).
  2. After the sub-dispatch returns, call `buildContextCapsule({ ..., generatedBy: "commander", dispatchKind: <"executor-direct"|"single-subagent"|"parallel-fanout">, parentCapsuleSha: <prior sha or null>, conversationAnchor })`.
  3. When `resolveConversationAnchor` returns null and no lifecycle issue is active, report `Capsule status: skipped: no-conversation-anchor` and do not attempt v2 reuse.
  4. executor-direct receives the capsule but never itself builds a capsule or spawns subagents.
**Review policy:** mandatory — commander is the highest-traffic primary; wrong hook order silently regresses the v1 lifecycle fan-out path.

```
# Patch instructions for src/agents/commander.ts
# 1. Inside the existing <context-capsule-protocol> ... </context-capsule-protocol>
#    injection (CONTEXT_CAPSULE_PROTOCOL is already template-literaled into the
#    prompt), append IMMEDIATELY AFTER the closing tag the following commander-
#    specific block (keep CONTEXT_CAPSULE_PROTOCOL byte-identical via shared
#    source — do not inline-edit it here):

<context-capsule-v2-hook scope="commander">
- Before every sub-dispatch (parallel fan-out, single Task / spawn_agent, or executor-direct):
  1. Resolve conversationAnchor via resolveConversationAnchor(currentSessionId). If null, skip v2 reuse path; v1 lifecycle path still active if lifecycleIssue is set.
  2. Call findReusableContextCapsule({ lifecycleIssue, conversationAnchor, branch, worktree }). On hit, run evaluateContextCapsuleFreshness with the same expected anchors; on fresh / partially-stale, inject via spawn_agent task.contextCapsule. On discarded, do not inject.
- After the sub-dispatch returns:
  1. Call buildContextCapsule({ topic, lifecycleIssue, branch, headSha, worktree, sourceFiles, confirmedFacts, conversationAnchor, generatedBy: "commander", dispatchKind: "<parallel-fanout|single-subagent|executor-direct>", parentCapsuleSha }).
  2. Use the prior capsule's sha as parentCapsuleSha when the previous round produced one; null otherwise.
  3. executor-direct receives the capsule in its user-prompt prefix (already handled by applyContextCapsulePrefix) but never itself builds a new capsule nor spawns subagents.
- Report Capsule status: in the terminal "本次知识上下文" section using the existing enum. When v2 reuse is unavailable because conversationAnchor is null and no lifecycle issue exists, report Capsule status: skipped: no-conversation-anchor.
- Capsule build must not block the final user reply: invoke after the subagent reply is in hand, before composing the user-facing terminal report.
</context-capsule-v2-hook>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts tests/agents/commander.test.ts`
**Commit:** `feat(agents): commander v2 hook for find-before / build-after every sub-dispatch`

---

### Task 3.6: Brainstormer prompt — v2 dispatch hook
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts` (extended in Task 4.1)
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Same hook semantics as commander, scoped to brainstormer's sub-dispatch surfaces: Lens Swarm fan-out, critic / adversarial swarm, single product-manager / software-architect / ux-designer dispatch. v2 trigger ensures sequential research rounds in the same conversation reuse prior capsule content.
**Review policy:** mandatory — brainstormer is the primary entry for design phases; missing the v2 hook silently regresses Discovery Swarm / Adversarial Swarm reuse for users who run multiple rounds.

```
# Patch instructions for src/agents/brainstormer.ts
# Insert IMMEDIATELY AFTER the closing tag of the CONTEXT_CAPSULE_PROTOCOL
# template-literal injection (do not edit CONTEXT_CAPSULE_PROTOCOL itself):

<context-capsule-v2-hook scope="brainstormer">
- Before every sub-dispatch (Lens Swarm fan-out, adversarial / critic swarm, single specialist Task / spawn_agent):
  1. Resolve conversationAnchor via resolveConversationAnchor(currentSessionId). Null → v2 path inactive; v1 lifecycle path remains.
  2. Call findReusableContextCapsule({ lifecycleIssue, conversationAnchor, branch, worktree }) and run freshness preflight; inject on fresh / partially-stale.
- After the sub-dispatch returns:
  1. Call buildContextCapsule({ ..., generatedBy: "brainstormer", dispatchKind: "<parallel-fanout|single-subagent>", parentCapsuleSha, conversationAnchor }).
  2. brainstormer dispatches never use dispatchKind: "executor-direct" (only commander does).
- Report Capsule status: alongside the existing knowledge-context section. skipped: no-conversation-anchor when anchor cannot be resolved AND no lifecycle issue is active.
- A→B reuse within the same conversation (multi-round refinement, scenario walkthrough, adversarial drill-down) MUST go through findReusableContextCapsule, not by re-deriving facts from chat history.
</context-capsule-v2-hook>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts tests/agents/brainstormer.test.ts`
**Commit:** `feat(agents): brainstormer v2 hook for find-before / build-after every sub-dispatch`

---

### Task 3.7: Octto prompt — v2 dispatch hook (NEW capsule integration)
**File:** `src/agents/octto.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts` (extended in Task 4.1)
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Adds the shared `CONTEXT_CAPSULE_PROTOCOL` injection (octto currently has no capsule mention) AND the octto-scoped `<context-capsule-v2-hook>`. Octto's brainstorm sessions (`create_brainstorm`) and async sub-dispatches now participate in v2 reuse. Octto's terminal report emits `Capsule status:` consistent with commander / brainstormer (existing `KNOWLEDGE_CONTEXT_SECTION` source is reused; no separate template edit needed).
**Review policy:** mandatory — first time octto participates in the capsule contract; missing or misaligned wording breaks three-primary consistency.

```
# Patch instructions for src/agents/octto.ts
# 1. Import the shared protocol source at top:
#      import { CONTEXT_CAPSULE_PROTOCOL } from "./context-capsule-protocol";
# 2. In the prompt template literal, insert ${CONTEXT_CAPSULE_PROTOCOL} at the
#    same structural position used by commander / brainstormer (between the
#    existing knowledge-protocol blocks and the dispatch-mechanics block — match
#    commander's placement so drift guard finds it).
# 3. IMMEDIATELY AFTER ${CONTEXT_CAPSULE_PROTOCOL}, append the octto-scoped hook:

<context-capsule-v2-hook scope="octto">
- Before every sub-dispatch (octto create_brainstorm fan-out, octto show_plan / show_diff async dispatch, single specialist Task):
  1. Resolve conversationAnchor via resolveConversationAnchor(currentSessionId). Null → v2 path inactive.
  2. Call findReusableContextCapsule({ lifecycleIssue, conversationAnchor, branch, worktree }) and run freshness preflight.
- After the sub-dispatch returns:
  1. Call buildContextCapsule({ ..., generatedBy: "octto", dispatchKind: "<parallel-fanout|single-subagent>", parentCapsuleSha, conversationAnchor }).
- Report Capsule status: alongside the existing knowledge-context section in the terminal report. skipped: no-conversation-anchor on null anchor + no lifecycle issue.
- Octto's auto-resume dispatcher: when the user returns after async wait, treat the resume as a continuation of the same conversation; reuse the most recent capsule via findReusableContextCapsule before re-posing follow-up structured questions.
</context-capsule-v2-hook>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts tests/agents/octto.test.ts`
**Commit:** `feat(agents): octto integrates CONTEXT_CAPSULE_PROTOCOL with v2 hook`

---

### Task 3.8: AGENTS.md mirror — note v2 trigger in Capsule status surface
**File:** `AGENTS.md`
**Test:** none (markdown mirror; existing drift guards cover Capsule status enum)
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Adds one short paragraph to the existing "本次知识上下文" / Capsule status surface area explicitly stating: v2 extends generation trigger to single-subagent and executor-direct; reuse boundary extended to `(conversation_anchor, branch, worktree)` fallback; OpenCode restart drops anchor without recovery attempt. Does NOT add new byte-identical mirror sections.
**Review policy:** mandatory — AGENTS.md is the human-readable cross-reference; wording drift here misleads contributors and future planners.

```markdown
# Add INSIDE the existing Working Context Capsule / Capsule status area of
# AGENTS.md (find the line that currently says `Capsule status 取值为 ...`).
# Append the following paragraph IMMEDIATELY AFTER that line. Do not move or
# rewrite the existing enum text.

> **v2 扩展（trigger + reuse anchor）**：commander / brainstormer / octto 在每次 sub-dispatch（含单 subagent、Task、executor-direct）前调用 `findReusableContextCapsule` 复用、后调用 `buildContextCapsule` 生成。复用边界优先 `(lifecycle_issue, branch, worktree)`（v1），否则回退到 `(conversation_anchor, branch, worktree)`（v2）。OpenCode 重启后 conversation anchor 失效，第一轮 dispatch 显示 `Capsule status: none` 或 `skipped: no-conversation-anchor`，不尝试恢复；第二轮起恢复 `fresh`。executor-direct 接收 capsule 但不自建 capsule、不派 subagent。同对话 + 同 repo + 同 worktree 之外的复用一律 `discarded`。
```

**Verify:** `bun test tests/agents/agents-md-*.test.ts` (existing AGENTS.md drift guards still green)
**Commit:** `docs(agents): note v2 trigger and conversation_anchor reuse boundary in AGENTS.md`

---

## Batch 4: Drift Guard + Integration Regression (parallel - 5 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5

### Task 4.1: Drift guard — v2 protocol present in all three primary agents
**File:** `tests/agents/context-capsule-drift-guard.test.ts`
**Test:** self
**Depends:** 3.2, 3.5, 3.6, 3.7
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Extends the existing drift guard with: (a) `CONTEXT_CAPSULE_PROTOCOL` appears in octto's prompt (new); (b) the v2 trigger key phrases appear in commander, brainstormer, and octto prompts (`context-capsule-v2-hook`, `派遣前查找+复用、派遣后生成`, `executor-direct`); (c) the shared protocol still contains v1 invariants (byte-identical / user-prompt-TOP / worker-must-read).
**Review policy:** mandatory — this is the safety net that catches every future regression on v2 wiring.

```typescript
// tests/agents/context-capsule-drift-guard.test.ts — append after existing blocks
import { describe as describe2, expect as expect2, it as it2 } from "bun:test";
import { brainstormerAgent as ba2 } from "@/agents/brainstormer";
import { primaryAgent as ca2 } from "@/agents/commander";
import { octtoAgent as oa2 } from "@/agents/octto";
import { CONTEXT_CAPSULE_PROTOCOL as proto2 } from "@/agents/context-capsule-protocol";

const v2Primaries = [
  { name: "commander", prompt: ca2.prompt ?? "" },
  { name: "brainstormer", prompt: ba2.prompt ?? "" },
  { name: "octto", prompt: oa2.prompt ?? "" },
];

describe2("v2 context-capsule injection across all three primaries", () => {
  it2("injects shared CONTEXT_CAPSULE_PROTOCOL in octto (new for v2)", () => {
    expect2(oa2.prompt ?? "").toContain(proto2);
  });

  for (const { name, prompt } of v2Primaries) {
    it2(`${name} prompt contains v2 trigger hook block`, () => {
      expect2(prompt).toContain("<context-capsule-v2-hook");
    });

    it2(`${name} prompt mentions find-before / build-after Chinese trigger phrase`, () => {
      expect2(prompt).toContain("派遣前查找+复用、派遣后生成");
    });

    it2(`${name} prompt names executor-direct dispatch kind context`, () => {
      expect2(prompt).toContain("executor-direct");
    });
  }
});

describe2("v2 shared protocol invariants preserved", () => {
  it2("retains v1 byte-identical / user-prompt-TOP / worker-must-read commitments", () => {
    expect2(proto2).toContain("byte-identical");
    expect2(proto2).toContain("user prompt TOP");
    expect2(proto2).toContain("worker still must read its own target files");
  });

  it2("documents v2 reuse boundary phrase", () => {
    expect2(proto2).toContain("(conversation_anchor, branch, worktree)");
  });

  it2("documents OpenCode restart no-recovery semantics", () => {
    expect2(proto2).toContain("OpenCode restart");
  });
});
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts`
**Commit:** `test(agents): drift guard for v2 trigger hook across commander / brainstormer / octto`

---

### Task 4.2: Integration — builder writes v2 capsule that survives store + freshness round-trip
**File:** `tests/integration/context-capsule-v2-roundtrip.test.ts` (NEW)
**Test:** self
**Depends:** 2.1, 2.2, 2.3, 2.4
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** End-to-end: build a v2 capsule with conversation_anchor "anchor-A" → find it via `findReusableContextCapsule({ lifecycleIssue: null, conversationAnchor: "anchor-A", ... })` → run freshness preflight → confirm `fresh`. Then change anchor to "anchor-B" → find returns null. Then add a lifecycle-issue capsule sharing the same branch/worktree → find prefers the lifecycle one (tier-1 wins). Confirms cross-module wiring without touching agent prompts.
**Review policy:** mandatory — single integration anchor that catches inter-module regression across builder / format / store / freshness.

```typescript
// tests/integration/context-capsule-v2-roundtrip.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { findReusableContextCapsule, parseContextCapsuleDocument } from "@/agents/context-capsule/store";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cap-v2-rt-"));
});

describe("v2 round-trip: build → find → freshness", () => {
  it("anchor-A capsule is reusable for anchor-A query and fresh", async () => {
    const built = buildContextCapsule({
      topic: "fix-hub-entry",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc123",
      worktree: "/tmp/rt",
      sourceFiles: [],
      confirmedFacts: ["hub entry confirmed at line 42"],
      outputDir: dir,
      conversationAnchor: "anchor-A",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
    });
    if (built.status !== "fresh") throw new Error("build failed");

    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      branch: "main",
      worktree: "/tmp/rt",
    });
    expect(found?.path).toBe(built.path);

    const parsed = parseContextCapsuleDocument(found!.content);
    const fresh = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-A",
      branch: "main",
      headSha: "abc123",
      worktree: "/tmp/rt",
      sourceHashes: {},
      frontmatter: parsed.frontmatter,
    });
    expect(fresh.status).toBe("fresh");
  });

  it("different anchor → find returns null", async () => {
    buildContextCapsule({
      topic: "round",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/rt",
      sourceFiles: [],
      confirmedFacts: ["a"],
      outputDir: dir,
      conversationAnchor: "anchor-A",
      generatedBy: "commander",
      dispatchKind: "single-subagent",
    });
    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-B",
      branch: "main",
      worktree: "/tmp/rt",
    });
    expect(found).toBeNull();
  });

  it("lifecycle capsule + same-anchor capsule coexist → lifecycle wins for lifecycle query", async () => {
    const lifeBuilt = buildContextCapsule({
      topic: "lifecycle-task",
      lifecycleIssue: 93,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/rt",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
      createdAt: new Date("2026-05-17T00:00:00Z"),
    });
    buildContextCapsule({
      topic: "conv-task",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/rt",
      sourceFiles: [],
      confirmedFacts: ["y"],
      outputDir: dir,
      conversationAnchor: "anchor-A",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
      createdAt: new Date("2026-05-17T01:00:00Z"),
    });
    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 93,
      conversationAnchor: "anchor-A",
      branch: "main",
      worktree: "/tmp/rt",
    });
    if (lifeBuilt.status !== "fresh") throw new Error("life build failed");
    expect(found?.path).toBe(lifeBuilt.path);
  });

  it("null anchor + null lifecycle → find returns null (no degenerate match)", async () => {
    buildContextCapsule({
      topic: "orphan",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/rt",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
    });
    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: null,
      branch: "main",
      worktree: "/tmp/rt",
    });
    expect(found).toBeNull();
  });
});
```

**Verify:** `bun test tests/integration/context-capsule-v2-roundtrip.test.ts`
**Commit:** `test(integration): v2 capsule build → find → freshness round-trip`

---

### Task 4.3: Integration — same-conversation 3-dispatch sequence (simulates user screenshot scenario)
**File:** `tests/integration/context-capsule-same-conversation.test.ts` (NEW)
**Test:** self
**Depends:** 1.4, 2.1, 2.3, 2.4
**Domain:** general
**Atlas-impact:** layer-update (atlas/20-behavior: same-conversation A→B→C reuse becomes a guaranteed behavior)
**Behavior-impact:** Simulates the exact user-screenshot flow:
  1. Dispatch 1 ("Fix hub entry"): `resolveConversationAnchor("ses_X")` → "anchor-h"; `findReusableContextCapsule` returns null → no injection; `buildContextCapsule` writes capsule_1.
  2. Dispatch 2 ("Continue hub fix"): same anchor "anchor-h"; `findReusableContextCapsule` returns capsule_1; freshness preflight → fresh; `buildContextCapsule` writes capsule_2 with `parent_capsule = capsule_1.sha`.
  3. Dispatch 3 ("Fix NPC name"): same anchor; finds latest (capsule_2); fresh; writes capsule_3 with `parent_capsule = capsule_2.sha`.
  4. Simulate OpenCode restart: new session "ses_Y" → anchor changes → `findReusableContextCapsule` returns null → Capsule status: none.
**Review policy:** mandatory — this is the primary behavioral acceptance for the user-reported pain point.

```typescript
// tests/integration/context-capsule-same-conversation.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { findReusableContextCapsule } from "@/agents/context-capsule/store";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";

let dir: string;
const WORKTREE = "/tmp/conv-w";
const BRANCH = "main";
const HEAD = "abc";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cap-conv-"));
});

async function simulateDispatch(args: {
  sessionId: string;
  topic: string;
  facts: readonly string[];
  parentSha: string | null;
}): Promise<{ injected: string | null; built: string; sha: string }> {
  const anchor = resolveConversationAnchor(args.sessionId);
  const found = await findReusableContextCapsule({
    directory: dir,
    lifecycleIssue: null,
    conversationAnchor: anchor,
    branch: BRANCH,
    worktree: WORKTREE,
  });
  let injected: string | null = null;
  if (found) {
    const parsed = await import("@/agents/context-capsule/store").then((m) => m.parseContextCapsuleDocument(found.content));
    const fresh = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: null,
      expectedConversationAnchor: anchor,
      branch: BRANCH,
      headSha: HEAD,
      worktree: WORKTREE,
      sourceHashes: {},
      frontmatter: parsed.frontmatter,
    });
    if (fresh.status === "fresh" || fresh.status === "partially-stale") injected = found.path;
  }
  const built = buildContextCapsule({
    topic: args.topic,
    lifecycleIssue: null,
    branch: BRANCH,
    headSha: HEAD,
    worktree: WORKTREE,
    sourceFiles: [],
    confirmedFacts: args.facts,
    outputDir: dir,
    conversationAnchor: anchor,
    generatedBy: "commander",
    dispatchKind: "executor-direct",
    parentCapsuleSha: args.parentSha,
  });
  if (built.status !== "fresh") throw new Error("build failed");
  return { injected, built: built.path, sha: built.sha };
}

describe("same-conversation three sequential executor-direct dispatches", () => {
  it("dispatch 1: no prior capsule, builds capsule_1", async () => {
    const d1 = await simulateDispatch({
      sessionId: "ses_X",
      topic: "fix-hub-entry",
      facts: ["hub entry at index.ts line 42"],
      parentSha: null,
    });
    expect(d1.injected).toBeNull();
    expect(d1.built).toContain("conv-");
  });

  it("dispatch 2: finds capsule_1, freshness fresh, builds capsule_2 with parent=capsule_1.sha", async () => {
    const d1 = await simulateDispatch({
      sessionId: "ses_X",
      topic: "fix-hub-entry",
      facts: ["fact1"],
      parentSha: null,
    });
    const d2 = await simulateDispatch({
      sessionId: "ses_X",
      topic: "continue-hub-fix",
      facts: ["fact2"],
      parentSha: d1.sha,
    });
    expect(d2.injected).toBe(d1.built);
    expect(d2.built).not.toBe(d1.built);
  });

  it("dispatch 3: same conversation, capsule reuse chain continues", async () => {
    const d1 = await simulateDispatch({ sessionId: "ses_X", topic: "a", facts: ["1"], parentSha: null });
    const d2 = await simulateDispatch({ sessionId: "ses_X", topic: "b", facts: ["2"], parentSha: d1.sha });
    const d3 = await simulateDispatch({ sessionId: "ses_X", topic: "c", facts: ["3"], parentSha: d2.sha });
    expect(d3.injected).toBe(d2.built);
  });

  it("OpenCode restart: new session id → new anchor → dispatch 1 sees no prior capsule", async () => {
    await simulateDispatch({ sessionId: "ses_X", topic: "a", facts: ["1"], parentSha: null });
    await simulateDispatch({ sessionId: "ses_X", topic: "b", facts: ["2"], parentSha: null });
    const post = await simulateDispatch({
      sessionId: "ses_Y_after_restart",
      topic: "post-restart",
      facts: ["fresh"],
      parentSha: null,
    });
    expect(post.injected).toBeNull();
  });

  it("null session id (anchor unavailable) → v2 path silently inactive", async () => {
    const anchor = resolveConversationAnchor(null);
    expect(anchor).toBeNull();
    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: anchor,
      branch: BRANCH,
      worktree: WORKTREE,
    });
    expect(found).toBeNull();
  });

  it("different worktree → discarded even with matching anchor", async () => {
    await simulateDispatch({ sessionId: "ses_X", topic: "a", facts: ["1"], parentSha: null });
    const otherWorktreeFound = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: resolveConversationAnchor("ses_X"),
      branch: BRANCH,
      worktree: "/tmp/OTHER",
    });
    expect(otherWorktreeFound).toBeNull();
  });
});
```

**Verify:** `bun test tests/integration/context-capsule-same-conversation.test.ts`
**Commit:** `test(integration): same-conversation three-dispatch reuse chain (user screenshot scenario)`

---

### Task 4.4: Regression — v1 lifecycle fan-out path unchanged
**File:** `tests/integration/context-capsule-v1-regression.test.ts` (NEW)
**Test:** self
**Depends:** 2.1, 2.3, 2.4
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Confirms that for any v1-shaped input (lifecycleIssue set, no v2 fields), the resulting capsule still: (a) gets the `issue-<N>-` filename prefix; (b) is found by `findReusableContextCapsule` keyed on lifecycleIssue ignoring conversationAnchor; (c) passes freshness preflight when only v1 fields are checked. Guards against accidental tier-2 leakage when both anchors are present.
**Review policy:** mandatory — protects v1 contract; any regression breaks issue #91 production behavior.

```typescript
// tests/integration/context-capsule-v1-regression.test.ts
import { describe, expect, it, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { findReusableContextCapsule, parseContextCapsuleDocument } from "@/agents/context-capsule/store";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cap-v1-reg-"));
});

describe("v1 regression: lifecycle path unaffected by v2 module changes", () => {
  it("v1 build (no v2 fields) emits issue-<N>- filename", () => {
    const r = buildContextCapsule({
      topic: "lifecycle",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
    });
    if (r.status !== "fresh") throw new Error("build failed");
    expect(r.path).toContain("/issue-91-");
  });

  it("v1 find by lifecycleIssue ignores anchor", async () => {
    const r = buildContextCapsule({
      topic: "lifecycle",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
    });
    if (r.status !== "fresh") throw new Error("build failed");
    const found = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 91,
      conversationAnchor: null,
      branch: "main",
      worktree: "/tmp/v1",
    });
    expect(found?.path).toBe(r.path);
  });

  it("v1 freshness with no expectedConversationAnchor preserves prior semantics", () => {
    const r = buildContextCapsule({
      topic: "lifecycle",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
    });
    if (r.status !== "fresh") throw new Error("build failed");
    const parsed = parseContextCapsuleDocument(r.document);
    const f = evaluateContextCapsuleFreshness({
      expectedLifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceHashes: {},
      frontmatter: parsed.frontmatter,
    });
    expect(f.status).toBe("fresh");
  });

  it("v1 fan-out byte-identical: two builds with identical input produce byte-identical documents", () => {
    const a = buildContextCapsule({
      topic: "fan",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1-fan",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
      createdAt: new Date("2026-05-17T00:00:00Z"),
    });
    const b = buildContextCapsule({
      topic: "fan",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1-fan",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir: dir,
      createdAt: new Date("2026-05-17T00:00:00Z"),
    });
    if (a.status !== "fresh" || b.status !== "fresh") throw new Error("build failed");
    expect(a.document).toBe(b.document);
    expect(a.sha).toBe(b.sha);
  });
});
```

**Verify:** `bun test tests/integration/context-capsule-v1-regression.test.ts`
**Commit:** `test(integration): v1 lifecycle path regression guard for v2 module changes`

---

### Task 4.5: Regression — resume_subagent / context-brief / Atlas / PM boundaries untouched
**File:** `tests/integration/context-capsule-v2-boundaries.test.ts` (NEW)
**Test:** self
**Depends:** 3.2, 3.5, 3.6, 3.7
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Verifies that v2 prompt additions do NOT:
  - mention or extend `resume_subagent`
  - replace or duplicate `<context-brief>`
  - write to Atlas vault or Project Memory directly from leaf agents
  - mention any new lifecycle recovery semantics
This catches accidental scope creep where a prompt edit drags in unrelated workflow surface.
**Review policy:** mandatory — boundary test; missing boundary checks let a single prompt edit silently rewrite multiple workflow contracts.

```typescript
// tests/integration/context-capsule-v2-boundaries.test.ts
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";

const primaries = [
  { name: "commander", prompt: commanderAgent.prompt ?? "" },
  { name: "brainstormer", prompt: brainstormerAgent.prompt ?? "" },
  { name: "octto", prompt: octtoAgent.prompt ?? "" },
];

describe("v2 hook does not extend resume_subagent or replace context-brief", () => {
  for (const { name, prompt } of primaries) {
    it(`${name} v2 hook does not mention extending resume_subagent`, () => {
      // capsule protocol itself contains "Do not extend resume_subagent" — that is allowed.
      // But the v2 hook block must not propose a new resume_subagent contract.
      const hookMatch = prompt.match(/<context-capsule-v2-hook[\s\S]*?<\/context-capsule-v2-hook>/);
      expect(hookMatch).not.toBeNull();
      const hook = hookMatch?.[0] ?? "";
      expect(hook).not.toContain("resume_subagent");
    });

    it(`${name} v2 hook does not replace context-brief contract`, () => {
      const hookMatch = prompt.match(/<context-capsule-v2-hook[\s\S]*?<\/context-capsule-v2-hook>/);
      const hook = hookMatch?.[0] ?? "";
      expect(hook).not.toContain("replace <context-brief>");
      expect(hook).not.toContain("supersede context-brief");
    });

    it(`${name} v2 hook does not authorize writing Atlas vault or Project Memory`, () => {
      const hookMatch = prompt.match(/<context-capsule-v2-hook[\s\S]*?<\/context-capsule-v2-hook>/);
      const hook = hookMatch?.[0] ?? "";
      expect(hook).not.toContain("project_memory_promote");
      expect(hook).not.toContain("atlas_write");
      expect(hook).not.toContain("write to Atlas");
    });

    it(`${name} v2 hook does not introduce new lifecycle recovery semantics`, () => {
      const hookMatch = prompt.match(/<context-capsule-v2-hook[\s\S]*?<\/context-capsule-v2-hook>/);
      const hook = hookMatch?.[0] ?? "";
      expect(hook).not.toContain("lifecycle_recovery_decision");
      expect(hook).not.toContain("Recovery hint");
    });
  }
});
```

**Verify:** `bun test tests/integration/context-capsule-v2-boundaries.test.ts`
**Commit:** `test(integration): v2 hook boundary guards (resume_subagent / context-brief / Atlas / PM / lifecycle untouched)`
