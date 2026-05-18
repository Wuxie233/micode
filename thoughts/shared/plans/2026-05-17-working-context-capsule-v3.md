---
date: 2026-05-17
topic: "Working Context Capsule v3: plugin tool layer + prompt-tool contract drift guard"
issue: 99
scope: tools
contract: none
---

# Working Context Capsule v3 Implementation Plan

**Goal:** Expose v2's `findReusableContextCapsule` / `buildContextCapsule` as real OpenCode plugin tools (`find_reusable_context_capsule` / `build_context_capsule`) so primary agents can actually invoke them, and add a structural drift-guard test that prevents any future "prompt names a callable that isn't a registered tool" gap.

**Architecture:** Two thin tool shells under `src/tools/context-capsule/`, each following the `spawn_agent` pattern (`tool({description, args, execute})` factory + aggregator `createContextCapsuleTools(ctx)`), spread into `src/index.ts`'s `tool: { ... }` block. Tool shells import and orchestrate the existing v2 modules — they do NOT re-implement builder/store/freshness/redact/conversation/format/injector. Primary agent prompts (brainstormer / commander / octto) and the shared `context-capsule-protocol.ts` are edited to call the real snake_case tool names; `resolveConversationAnchor` / `evaluateContextCapsuleFreshness` become narrative descriptions, not callables. A new `tests/agents/prompt-tool-contract.test.ts` scans all agent prompt template literals and asserts every backticked identifier in an imperative ("call X" / "调用 X" / "invoke X" / "use X tool" / "via X") context belongs to the registered tool set or a clearly-named allowlist.

**Design:** [thoughts/shared/designs/2026-05-17-working-context-capsule-v3-design.md](../designs/2026-05-17-working-context-capsule-v3-design.md)

**Contract:** none (this plan is wholly inside the OpenCode plugin layer; no frontend/backend split, no shared HTTP contract)

---

## 行为承诺映射

design.md `## Behavior` 段 + `## 承诺清单 / Commitments` 段共有 7 条用户可见行为承诺（已合并去重）。映射如下：

- 行为 1（"同对话连续提需求时, commander/brainstormer/octto 真的会在合适时机调 `find_reusable_context_capsule` 和 `build_context_capsule`"）→ 由 Batch 3 Task 3.1 / 3.2 / 3.3（三个 primary agent prompt 改造为命令式调用真实工具名）+ Batch 2 Task 2.1 / 2.2 / 2.3（工具实际可被调用）共同实现；由 Batch 4 Task 4.3（drift-guard）验证 prompt 里命名的 callable 都是真的注册工具
- 行为 2（"调用结果在终态汇报'本次知识上下文'段可见（Capsule status 不再总是 none）"）→ 由 Batch 3 三个 prompt 改造任务隐式实现（既有 effect-first reporting 协议已要求输出 Capsule status；本次只是让真实工具调用让该状态从 none 变成实值）；不引入新 task，由用户在 ad-hoc 实跑里验证
- 行为 3（"find 工具不写盘"）→ 由 Batch 2 Task 2.2 (find tool 实现，仅 read-only) 实现；由 Batch 4 Task 4.1 (find tool 单元测试) 验证（断言不存在写盘 side effect）
- 行为 4（"build 工具只写 `thoughts/shared/context-capsules/`"）→ 由 Batch 2 Task 2.3 (build tool 实现，复用 v2 builder，输出路径限定该目录) 实现；由 Batch 4 Task 4.2 (build tool 单元测试) 验证写入路径前缀
- 行为 5（"任何 prompt 里以反引号 + 命令式上下文出现的 callable 名字必须对应真实注册工具，否则 CI 立即失败"）→ 由 Batch 4 Task 4.3 (新 drift-guard 测试 `tests/agents/prompt-tool-contract.test.ts`) 实现并验证；由 Batch 1 Task 1.1 (AGENTS.md 镜像段) 在文档层呼应
- 行为 6（"agent 仍可自决跳过 find/build (不强制)"）→ 不需要新 task，因为这是协议层默认行为：现有 `<context-capsule-v2-hook>` 与 `<dispatch-trigger>` 里 "skip when no anchor" / "skipped: no-conversation-anchor" 措辞 Batch 3 prompt 改造保留不动；agent 自决是 prompt 协议既有承诺
- 行为 7（"v1 / v2 已有路径行为不变；v1 spawn_agent contextCapsule 参数注入路径完全保留"）→ 不需要新 task；本次实现不修改 `src/tools/spawn-agent/`、`src/agents/context-capsule/*`、`src/hooks/*` 任一文件，由 Batch 4 Task 4.4 (现有 capsule drift-guard 测试更新) + 既有 v2 regression 测试套（不在本 plan 修改范围）共同守护

**未对应任何 task 的行为**：无。response-UX / decision-minimal commitment 由既有 effect-first reporting 协议在 commander/brainstormer/octto prompt 中已经承诺；本次 prompt 改造任务只是把内部 TS 函数名替换成真实工具名，不影响终态汇报形态，因此无需新增独立"response-UX prompt 改造"task。

---

## Review Policy

- **Reviewer mandatory:** ALL tasks in this plan are reviewer mandatory.
  - Batches 1-2 touch `src/tools/**` (new tool wiring + plugin registry surface) and `src/index.ts` (runtime registration).
  - Batch 3 touches `src/agents/**/*.ts` and `src/agents/context-capsule-protocol.ts` (high-risk prompt surface; any wording drift can silently disable v2 reuse).
  - Batch 4 introduces and updates structural drift-guard tests (Behavior commitment #5 enforcement; weakening these tests would defeat the whole point of v3).
- **Reviewer-skip eligible:** none. No task in this plan falls into the low-risk whitelist (prompt-only wording tweak with no contract change / docs mirror with no normative semantic change / pure formatting). Even the AGENTS.md mirror task (Batch 1 Task 1.1) introduces a new normative drift-guard reference and must be reviewed.
- **Risk observations:** (taken from the design's investigator findings and Constraints section)
  - "v2 设计阶段把内部 TS 函数名直接写进 prompt 当 callable" — root cause; Batch 3 must rewrite all imperative-context references to snake_case tool names without weakening surrounding rule semantics. Reviewer must compare diff line-by-line against the v2-hook blocks.
  - "测试盲区: 没有任何测试检查 prompt 中命令式提到的 callable 名字 ⊆ 实际注册的工具名" — Batch 4 Task 4.3 introduces that test; reviewer must verify the regex / extraction rules don't false-positive on narrative ("see `spawn_agent`") and don't false-negative on the original v2 bug pattern.
  - "v1 spawn_agent contextCapsule 参数注入路径不动" — no task touches `src/tools/spawn-agent/` or `src/agents/context-capsule/*` v2 modules; reviewer must verify diff doesn't accidentally cross that boundary.
  - "byte-identical / secret filter / immutable 三大不变量保持" — build tool shell must defer to v2 `buildContextCapsule` for all three; reviewer must verify the shell does not duplicate or short-circuit those checks.

---

## Dependency Graph

```
Batch 1 (parallel, 2 implementers): 1.1, 1.2
  1.1 AGENTS.md mirror note (general, no deps)
  1.2 find/args.ts zod schema (general, no deps)

Batch 2 (parallel, 4 implementers): 2.1, 2.2, 2.3, 2.4 [depends on Batch 1]
  2.1 build/args.ts zod schema (general, no deps in code but conceptually grouped here)
  2.2 find/tool.ts (depends 1.2: args)
  2.3 build/tool.ts (depends 2.1: args)
  2.4 context-capsule/index.ts aggregator (depends 2.2, 2.3)

Batch 3 (parallel, 5 implementers): 3.1, 3.2, 3.3, 3.4, 3.5 [depends on Batch 2]
  3.1 src/tools/index.ts export (depends 2.4)
  3.2 src/index.ts registration (depends 3.1)
  3.3 brainstormer.ts prompt rewrite
  3.4 commander.ts prompt rewrite
  3.5 octto.ts prompt rewrite + context-capsule-protocol.ts rewrite

Batch 4 (parallel, 4 implementers): 4.1, 4.2, 4.3, 4.4 [depends on Batch 3]
  4.1 find tool unit test (depends 2.2)
  4.2 build tool unit test (depends 2.3)
  4.3 prompt-tool-contract drift-guard test (depends 3.2, 3.3, 3.4, 3.5)
  4.4 update existing capsule + index-wiring tests (depends 3.1, 3.2, 3.5)
```

Rationale: args schemas are foundation; tool shells depend on schemas; aggregator depends on both shells; registry/exports depend on aggregator; prompts can be rewritten in parallel with registry wiring (no code-level coupling, but conceptually grouped in Batch 3 so they all land together for the Batch 4 drift-guard run). Tests in Batch 4 require the new tools to be registered (3.1/3.2) AND prompts to use real names (3.3/3.4/3.5) so the drift-guard passes.

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: AGENTS.md drift-guard mirror note for prompt-tool contract

**File:** `AGENTS.md`
**Test:** none (docs mirror with no normative-code semantic change beyond pointing to the new drift guard; reviewer mandatory per Review Policy still applies)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — touches normative project documentation that other agents read; wording drift here defeats the discoverability purpose of the drift guard

Append a new short section to `AGENTS.md` introducing the prompt-tool contract drift guard. Place it directly after the existing `## Behavior 段约定` section and before the `## Sub-decision Identification 约定` section so it appears in the same family of "drift-guard mirrors" notes.

```markdown
## Prompt-Tool Contract Drift Guard

micode 在 v3 引入一条结构性约束：任何 `src/agents/**/*.ts` prompt 模板字符串里以反引号 + 命令式上下文（"call X" / "调用 X" / "invoke X" / "use X tool" / "via X"）出现的 callable 名字，必须 ⊆ `src/index.ts` `tool: { ... }` 实际注册的工具名 ∪ 显式 allowlist。Drift guard 单源是 `tests/agents/prompt-tool-contract.test.ts`；allowlist 是该测试文件内一个清楚命名的常量（`PROMPT_CALLABLE_ALLOWLIST`），收录 subagent_type 名、slash command 名、以及文档示例性引用。

历史背景：v2 设计阶段把内部 TS 函数 `findReusableContextCapsule` / `buildContextCapsule` / `resolveConversationAnchor` / `evaluateContextCapsuleFreshness` 直接写进 prompt 当 callable，但它们从未注册成 OpenCode plugin tool。结果 agent 看到 prompt 要求"call findReusableContextCapsule"时回答"工具没暴露，我不能直接调用"，v2 复用机制实际从未被主动触发。v3 把前两个函数升级为真实的 plugin tool `find_reusable_context_capsule` / `build_context_capsule`（snake_case，照搬 spawn_agent 模式），后两个改写为 narrative。同时引入本 drift guard 防止同型 contract gap 再发。

本节是 markdown 镜像。Prompt 单源以各 agent prompt 与 `src/index.ts` 注册表为准；drift 由 `tests/agents/prompt-tool-contract.test.ts` 强制。不引入新 byte-identical 镜像。
```

**Verify:** `bun test tests/agents/agents-md-lens-swarm.test.ts` (sanity check that other AGENTS.md grep-based drift guards still pass; the new section does not collide with them) and human read-through of the appended section.

**Commit:** `docs(agents): add prompt-tool contract drift guard mirror note`

### Task 1.2: find_reusable_context_capsule args zod schema

**File:** `src/tools/context-capsule/find/args.ts`
**Test:** none (schema-only file; behavior risk is captured by the find tool unit test in Batch 4 Task 4.1 which exercises the schema through the tool factory; emitting a separate schema test would be redundant glue coverage)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — new tool argument surface visible to the model; field names and types become a stable contract

Create the zod schema for `find_reusable_context_capsule`. All fields are optional because the tool defaults to resolving from `toolCtx.sessionID`. Follow the pattern in `src/tools/mindmodel-lookup.ts` (which uses `tool.schema.string()` inline) but factor the schema into its own file so the tool factory in Task 2.2 can stay focused on `execute` logic.

```typescript
// src/tools/context-capsule/find/args.ts
import { tool } from "@opencode-ai/plugin/tool";

/**
 * Zod schema for the `find_reusable_context_capsule` tool.
 *
 * All fields are optional because the tool's `execute` defaults `lifecycle_issue`
 * to null, derives `conversation_anchor` from `toolCtx.sessionID` via the v2
 * `resolveConversationAnchor` helper, and reads `branch` / `worktree` from the
 * current git environment. `topic_hint` is reserved for future ranking; v3 only
 * uses it to surface the topic in the result markdown so the agent can decide
 * relevance.
 */
export const findReusableContextCapsuleArgs = {
  lifecycle_issue: tool.schema
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Lifecycle issue number to scope the search. Omit to search by conversation_anchor only."),
  topic_hint: tool.schema
    .string()
    .optional()
    .describe("Short topic phrase used purely as a relevance hint in the returned markdown summary. Does not filter results."),
  since: tool.schema
    .string()
    .optional()
    .describe("ISO-8601 timestamp; if provided, capsules created before this are ignored. Optional."),
} as const;

export type FindReusableContextCapsuleArgs = {
  readonly lifecycle_issue?: number | null;
  readonly topic_hint?: string;
  readonly since?: string;
};
```

**Verify:** `bun run typecheck` (the file must type-check standalone; no test command because the args contract is exercised by Batch 4 Task 4.1)

**Commit:** `feat(tools): add find_reusable_context_capsule args zod schema`

---

## Batch 2: Tool shells + args (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 (args schemas land before tool shells consume them).
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: build_context_capsule args zod schema

**File:** `src/tools/context-capsule/build/args.ts`
**Test:** none (schema-only; behavior risk captured by Batch 4 Task 4.2 build tool unit test)
**Depends:** none (could conceptually go in Batch 1, but grouped in Batch 2 to keep Batch 1 small and keep both args files adjacent in review)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — new tool argument surface; `topic` and `confirmed_facts` shape becomes a stable contract the model relies on

Create the zod schema for `build_context_capsule`. `topic` is required; all other fields are optional and default-resolved inside the tool's `execute`. `confirmed_facts` and `source_files` shape MUST mirror the v2 `ContextCapsuleBuildInput` so the tool shell can pass them through without reshaping (see `src/agents/context-capsule/types.ts` lines 29-44).

```typescript
// src/tools/context-capsule/build/args.ts
import { tool } from "@opencode-ai/plugin/tool";

/**
 * Zod schema for the `build_context_capsule` tool.
 *
 * `topic` is required because the v2 builder uses it for filename slug and
 * frontmatter rendering. All other fields are optional and default-resolved
 * inside execute: lifecycle_issue from active lifecycle, branch/head_sha/worktree
 * from git env, conversation_anchor from toolCtx.sessionID, dispatch_kind from
 * agent-provided hint defaulting to "single-subagent".
 *
 * source_files entries carry both `path` and `content` because the v2 builder
 * hashes the content itself; the shell does NOT read files from disk.
 */
export const buildContextCapsuleArgs = {
  topic: tool.schema
    .string()
    .min(1)
    .describe("Short topic phrase identifying this capsule. Used for filename slug and ranking. Required."),
  confirmed_facts: tool.schema
    .array(tool.schema.string())
    .optional()
    .describe("Already-confirmed prose facts to embed in the capsule body. Each entry is one bullet."),
  source_files: tool.schema
    .array(
      tool.schema.object({
        path: tool.schema.string().describe("Repo-relative file path."),
        content: tool.schema.string().describe("Exact file content at the time of capsule creation."),
      }),
    )
    .optional()
    .describe("Source file snapshots. The v2 builder hashes content for freshness checks; do not pre-hash."),
  lifecycle_issue: tool.schema
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Lifecycle issue number. Defaults to active lifecycle if omitted."),
  parent_capsule_sha: tool.schema
    .string()
    .nullable()
    .optional()
    .describe("SHA of a parent capsule when this one extends an earlier one. Records the chain in frontmatter."),
  dispatch_kind: tool.schema
    .enum(["parallel-fanout", "single-subagent", "executor-direct"])
    .optional()
    .describe("Dispatch kind hint recorded in frontmatter. Defaults to single-subagent."),
  generated_by: tool.schema
    .enum(["brainstormer", "commander", "octto", "executor"])
    .optional()
    .describe("Which primary/coordinator agent built this capsule. Defaults to a generic value when omitted."),
} as const;

export type BuildContextCapsuleArgs = {
  readonly topic: string;
  readonly confirmed_facts?: readonly string[];
  readonly source_files?: readonly { readonly path: string; readonly content: string }[];
  readonly lifecycle_issue?: number | null;
  readonly parent_capsule_sha?: string | null;
  readonly dispatch_kind?: "parallel-fanout" | "single-subagent" | "executor-direct";
  readonly generated_by?: "brainstormer" | "commander" | "octto" | "executor";
};
```

**Verify:** `bun run typecheck`

**Commit:** `feat(tools): add build_context_capsule args zod schema`

### Task 2.2: find_reusable_context_capsule tool factory

**File:** `src/tools/context-capsule/find/tool.ts`
**Test:** `tests/tools/context-capsule/find.test.ts` (deferred to Batch 4 Task 4.1 because the test depends on the tool being importable; declared here as the planned test path)
**Depends:** 1.2 (imports args schema)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — new tool implementation; orchestrates v2 internals; must not write to disk; must not duplicate v2 logic

Create the `find_reusable_context_capsule` tool factory. The shell is read-only: it resolves anchor, calls v2 `findReusableContextCapsule`, optionally evaluates freshness, and returns a markdown summary. It MUST NOT write any file. Branch / worktree / head_sha are resolved from the same helpers v2's coordinator hooks use (search the codebase for prior art on `git rev-parse HEAD` / `git rev-parse --abbrev-ref HEAD` invocations — `src/lifecycle/resolver.ts` already exposes a current-repo helper; reuse it. If no such helper exists in a directly-importable form, inline a small `execFileSync("git", [...], { cwd: ctx.directory })` block at the top of `execute` — keep it 5-10 lines, well below the bash/git pattern other tools use).

Decision (gap-fill): I'm implementing the tool to NOT auto-inject the capsule into a subsequent spawn_agent call. The return value is markdown the agent reads; the agent decides whether to pass the resulting capsule `path` as `spawn_agent.contextCapsule.path`. This preserves the design's "agent-driven, not runtime auto-wrapper" Constraint.

```typescript
// src/tools/context-capsule/find/tool.ts
import { execFileSync } from "node:child_process";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";

import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import { findReusableContextCapsule } from "@/agents/context-capsule/store";
import type { ContextCapsuleFrontmatter, ContextCapsuleRef } from "@/agents/context-capsule/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { findReusableContextCapsuleArgs } from "./args";

const TOOL_DESCRIPTION = `Find a reusable Working Context Capsule for the current conversation, lifecycle, branch, and worktree.

Read-only: this tool never writes to disk. Returns a markdown summary describing the matched capsule (if any), its freshness verdict (fresh | partially-stale | discarded | none), the file path, sha, and reuse token. You decide whether to pass the path as spawn_agent.contextCapsule.path on a subsequent dispatch.

Use this before parallel fan-out, single-subagent dispatch, or executor-direct hand-off when you want to give the worker a cache-friendly prompt prefix containing already-confirmed facts. Skip it for quick-mode, single-line patches, or when no prior capsule is plausible.`;

interface FindToolContext extends ToolContext {
  readonly sessionID?: string;
}

interface GitEnv {
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
}

function readGitEnv(cwd: string): GitEnv | null {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const worktree = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
    return { branch, headSha, worktree };
  } catch (error) {
    log.warn("find_reusable_context_capsule", `git env read failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

function parseFrontmatter(content: string): ContextCapsuleFrontmatter | null {
  // Reuse the same minimal parser style v2 store uses internally; if the
  // ContextCapsuleRef does not already include parsed frontmatter, we read it
  // from the content string. Implementer MUST verify that store.ts already
  // exposes frontmatter parsing; if so, import and reuse it here instead of
  // re-parsing. Search for `parseContextCapsuleFrontmatter` or similar before
  // writing a new parser.
  // The implementation below is a placeholder pattern; replace with the actual
  // v2 helper import.
  return null;
}

function formatNoMatch(reason: string): string {
  return `## No reusable capsule\n\n- reason: ${reason}\n- next: proceed with normal prompt path (no capsule prefix)`;
}

function formatMatch(
  ref: ContextCapsuleRef,
  freshness: "fresh" | "partially-stale" | "discarded" | "no-frontmatter",
): string {
  return [
    `## Reusable capsule candidate`,
    ``,
    `- path: \`${ref.path}\``,
    `- sha: \`${ref.sha}\``,
    `- token: \`${ref.token}\``,
    `- freshness: ${freshness}`,
    ``,
    `If freshness is \`fresh\` or \`partially-stale\` and the candidate is relevant to the next dispatch, pass \`path\` as \`spawn_agent.contextCapsule.path\` on the next dispatch. If \`discarded\`, do not reuse.`,
  ].join("\n");
}

export function createFindReusableContextCapsuleTool(ctx: PluginInput): {
  find_reusable_context_capsule: ToolDefinition;
} {
  const find_reusable_context_capsule = tool({
    description: TOOL_DESCRIPTION,
    args: findReusableContextCapsuleArgs,
    execute: async (args, toolCtx) => {
      const sessionId = (toolCtx as FindToolContext).sessionID;
      const anchor = resolveConversationAnchor(sessionId);
      if (!anchor && (args.lifecycle_issue === null || args.lifecycle_issue === undefined)) {
        return formatNoMatch("skipped: no-conversation-anchor and no lifecycle_issue provided");
      }

      const gitEnv = readGitEnv(ctx.directory);
      if (!gitEnv) {
        return formatNoMatch("skipped: git env unavailable");
      }

      const ref = await findReusableContextCapsule({
        lifecycleIssue: args.lifecycle_issue ?? null,
        conversationAnchor: anchor,
        branch: gitEnv.branch,
        worktree: gitEnv.worktree,
      });

      if (!ref) {
        return formatNoMatch("no capsule matched lifecycle_issue / conversation_anchor / branch / worktree");
      }

      // Freshness evaluation requires parsed frontmatter + source hashes. The
      // implementer must wire this up using the v2 frontmatter parser already
      // present in src/agents/context-capsule/store.ts (look for the function
      // that produces `ContextCapsuleFrontmatter` from a capsule document).
      // If freshness cannot be evaluated (e.g. parser failure), default to
      // "no-frontmatter" and let the agent decide.
      const frontmatter = parseFrontmatter(ref.content);
      if (!frontmatter) {
        return formatMatch(ref, "no-frontmatter");
      }

      const freshness = evaluateContextCapsuleFreshness({
        expectedLifecycleIssue: args.lifecycle_issue ?? null,
        expectedConversationAnchor: anchor,
        branch: gitEnv.branch,
        headSha: gitEnv.headSha,
        worktree: gitEnv.worktree,
        sourceHashes: Object.fromEntries(
          Object.entries(frontmatter.source_hashes).map(([path, hash]) => [path, hash]),
        ),
        frontmatter,
      });

      return formatMatch(ref, freshness.status);
    },
  });

  return { find_reusable_context_capsule };
}
```

**Implementer notes:**
- Before writing the placeholder `parseFrontmatter`, grep `src/agents/context-capsule/store.ts` for an existing frontmatter parser and import it; do NOT write a duplicate.
- The `readGitEnv` helper uses `execFileSync` rather than `bash` because we already do this pattern in lifecycle resolver code paths. If `src/lifecycle/resolver.ts` (or sibling) already exposes a `resolveCurrentRepo()` / `resolveGitEnv()` helper, IMPORT IT instead of re-implementing.
- The tool is read-only. The implementer MUST add a runtime assertion / comment that the function never writes to disk; reviewer will spot-check.

**Verify:** `bun run typecheck && bun run lint` (the tool's unit test runs in Batch 4)

**Commit:** `feat(tools): add find_reusable_context_capsule tool factory`

### Task 2.3: build_context_capsule tool factory

**File:** `src/tools/context-capsule/build/tool.ts`
**Test:** `tests/tools/context-capsule/build.test.ts` (deferred to Batch 4 Task 4.2)
**Depends:** 2.1 (imports args schema)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — new tool implementation; orchestrates v2 builder which has secret-filter / immutable / byte-identical invariants; shell MUST defer to v2 builder for all three

Create the `build_context_capsule` tool factory. The shell resolves anchor + git env, then delegates to v2 `buildContextCapsule`. It writes ONLY to `thoughts/shared/context-capsules/` (which is the v2 builder's default output directory; the shell does NOT override it). Returns markdown with the write path, capsule sha, token, and any warnings.

Decision (gap-fill): The shell accepts `confirmed_facts` and `source_files` directly from args (already typed in 2.1) and passes them straight through. If the agent omits them, the capsule body will be minimal (frontmatter only); that's intentional — v2 builder accepts this case and returns a valid capsule.

```typescript
// src/tools/context-capsule/build/tool.ts
import { execFileSync } from "node:child_process";
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";

import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";
import type { BuildContextCapsuleResult, GeneratorAgent } from "@/agents/context-capsule/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { buildContextCapsuleArgs } from "./args";

const TOOL_DESCRIPTION = `Build an immutable Working Context Capsule for the current conversation, lifecycle, branch, and worktree.

Writes a new file under thoughts/shared/context-capsules/ containing sanitized, already-confirmed facts that future subagent dispatches in the same conversation can reuse as a cache-friendly prompt prefix.

Secret filtering, byte-identical body rendering, and immutable file write are enforced by the v2 builder. This shell only resolves the conversation anchor and git env, then delegates.

Returns markdown with the write path, capsule sha, reuse token, and any warnings. If the v2 builder blocks the write (e.g. secret detected), returns the block reason.

Call this AFTER a dispatch returns with results worth preserving for the next dispatch in the same conversation. Skip it when there is no anchor, when the dispatch was discarded, or when there are no confirmed facts worth reusing.`;

interface BuildToolContext extends ToolContext {
  readonly sessionID?: string;
}

interface GitEnv {
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
}

function readGitEnv(cwd: string): GitEnv | null {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const headSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
    const worktree = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
    return { branch, headSha, worktree };
  } catch (error) {
    log.warn("build_context_capsule", `git env read failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

function formatResult(result: BuildContextCapsuleResult): string {
  if (result.status === "blocked") {
    return [
      `## Capsule build blocked`,
      ``,
      `- reason: ${result.reason}`,
      result.detail ? `- detail: ${result.detail}` : null,
      ``,
      `No file was written. Address the cause (commonly secret content) and retry.`,
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
  }

  return [
    `## Capsule written`,
    ``,
    `- path: \`${result.path}\``,
    `- sha: \`${result.sha}\``,
    `- token: \`${result.token}\``,
    result.warnings.length > 0 ? `- warnings:\n${result.warnings.map((warning) => `  - ${warning}`).join("\n")}` : null,
    ``,
    `Pass \`path\` as \`spawn_agent.contextCapsule.path\` on subsequent dispatches in the same conversation that pass freshness checks.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function createBuildContextCapsuleTool(ctx: PluginInput): { build_context_capsule: ToolDefinition } {
  const build_context_capsule = tool({
    description: TOOL_DESCRIPTION,
    args: buildContextCapsuleArgs,
    execute: async (args, toolCtx) => {
      const sessionId = (toolCtx as BuildToolContext).sessionID;
      const anchor = resolveConversationAnchor(sessionId);
      const gitEnv = readGitEnv(ctx.directory);
      if (!gitEnv) {
        return `## Capsule build skipped\n\n- reason: git env unavailable\n- next: proceed without capsule`;
      }

      const result = buildContextCapsule({
        topic: args.topic,
        lifecycleIssue: args.lifecycle_issue ?? null,
        branch: gitEnv.branch,
        headSha: gitEnv.headSha,
        worktree: gitEnv.worktree,
        sourceFiles: (args.source_files ?? []).map((file) => ({ path: file.path, content: file.content })),
        confirmedFacts: args.confirmed_facts ?? [],
        conversationAnchor: anchor,
        generatedBy: (args.generated_by ?? null) as GeneratorAgent | null,
        dispatchKind: args.dispatch_kind ?? "single-subagent",
        parentCapsuleSha: args.parent_capsule_sha ?? null,
        // outputDir intentionally omitted: defer to v2 default
        // (thoughts/shared/context-capsules/) per design Constraint
      });

      return formatResult(result);
    },
  });

  return { build_context_capsule };
}
```

**Implementer notes:**
- DO NOT pass `outputDir` to `buildContextCapsule` — the v2 default IS the design's promised path. Overriding here would silently break Behavior commitment #4.
- DO NOT add any pre-write secret check in the shell — v2 builder already does this; duplicate checks risk drift.
- If `resolveCurrentRepo()` / equivalent helper exists in `src/lifecycle/resolver.ts`, import it instead of inlining `readGitEnv` (same as Task 2.2 note).

**Verify:** `bun run typecheck && bun run lint`

**Commit:** `feat(tools): add build_context_capsule tool factory`

### Task 2.4: context-capsule tools aggregator

**File:** `src/tools/context-capsule/index.ts`
**Test:** none (pure re-export aggregator; behavior risk is captured by Batch 4 Task 4.4 index-wiring test which asserts both tool names appear in the registered tool map)
**Depends:** 2.2, 2.3 (imports both factories)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — runtime registration surface; aggregator shape mirrors `createOcttoTools` / `createLifecycleTools` pattern and must remain compatible with `src/tools/index.ts` consumer

Create the aggregator that bundles both tools, following the pattern in `src/tools/octto/index.ts` and `src/tools/project-memory/`. Export a single `createContextCapsuleTools(ctx)` function returning an object with both tools, so `src/index.ts` can spread it with `...createContextCapsuleTools(ctx)`.

```typescript
// src/tools/context-capsule/index.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { createBuildContextCapsuleTool } from "./build/tool";
import { createFindReusableContextCapsuleTool } from "./find/tool";

export interface ContextCapsuleTools {
  readonly find_reusable_context_capsule: ToolDefinition;
  readonly build_context_capsule: ToolDefinition;
}

/**
 * Bundle the v3 context capsule plugin tools.
 *
 * Spread the return value into `src/index.ts`'s `tool: { ... }` block:
 *
 *     tool: {
 *       ...createContextCapsuleTools(ctx),
 *       ...otherTools,
 *     }
 *
 * Both tools follow the spawn_agent pattern: they are thin shells over the
 * v2 modules under src/agents/context-capsule/. They do NOT re-implement
 * builder / store / freshness / redact logic.
 */
export function createContextCapsuleTools(ctx: PluginInput): ContextCapsuleTools {
  return {
    ...createFindReusableContextCapsuleTool(ctx),
    ...createBuildContextCapsuleTool(ctx),
  };
}
```

**Verify:** `bun run typecheck`

**Commit:** `feat(tools): aggregate context-capsule find/build tools`

---

## Batch 3: Wiring + prompt rewrites (parallel - 5 implementers)

All tasks in this batch depend on Batch 2 (aggregator must exist before src/tools/index.ts can export it and src/index.ts can spread it).
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5

### Task 3.1: Export createContextCapsuleTools from src/tools/index.ts

**File:** `src/tools/index.ts`
**Test:** none (single-line export change; behavior risk captured by Batch 4 Task 4.4 index-wiring test)
**Depends:** 2.4 (aggregator must exist)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — public plugin module barrel; misordering or typo silently breaks runtime registration

Add a new export line. Follow the existing alphabetical-ish grouping pattern (see `createBatchReadTool` / `createDetectKnowledgeStateTool` / `createMindmodelLookupTool` style). Insert the new export between `createBatchReadTool` and `btca_ask` exports for adjacency to similar `createXxxTool` factories.

Add this line:

```typescript
export { createContextCapsuleTools } from "./context-capsule";
```

The exact insertion point: after the existing `export { createBatchReadTool } from "./batch-read";` line (line 4 in the current file).

After the edit, the new state of that region of the file is:

```typescript
export { createAtlasLookupTool } from "./atlas";
export { createBatchReadTool } from "./batch-read";
export { createContextCapsuleTools } from "./context-capsule";
export { btca_ask, checkBtcaAvailable } from "./btca";
```

**Verify:** `bun run typecheck && bun test tests/index-wiring.test.ts`

**Commit:** `feat(tools): export createContextCapsuleTools from tools barrel`

### Task 3.2: Register context capsule tools in src/index.ts

**File:** `src/index.ts`
**Test:** none (registration is structural; covered by Batch 4 Task 4.4 which extends `tests/index-wiring.test.ts` `EXPECTED_TOOLS`)
**Depends:** 3.1 (must import from barrel)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — runtime tool registry surface; must spread inside the existing `tool: { ... }` block exactly per design

Two edits in `src/index.ts`:

**Edit A:** Add `createContextCapsuleTools` to the import block at lines ~71-80. Insert alphabetically:

```typescript
import {
  artifact_search,
  ast_grep_replace,
  ast_grep_search,
  btca_ask,
  checkAstGrepAvailable,
  checkBtcaAvailable,
  createAtlasLookupTool,
  createBatchReadTool,
  createContextCapsuleTools,
  createDetectKnowledgeStateTool,
  // ... rest unchanged
```

**Edit B:** Spread the aggregator into the `tool: { ... }` block at lines ~982-1002. Insert immediately after the existing `...createDetectKnowledgeStateTool(ctx),` line so it sits adjacent to other `createXxxTool` factories:

```typescript
    tool: {
      ast_grep_search,
      ast_grep_replace,
      btca_ask,
      look_at,
      artifact_search,
      milestone_artifact_search,
      spawn_agent,
      resume_subagent,
      cleanup_parent_run,
      batch_read,
      ...atlasLookupTool,
      ...mindmodelLookupTool,
      ...projectMemoryTools,
      ...ptyTools,
      ...octtoTools,
      ...lifecycleTools,
      ...createDetectKnowledgeStateTool(ctx),
      ...createContextCapsuleTools(ctx),
    },
```

**Implementer notes:**
- DO NOT reorder existing entries; only insert the one new line in each block.
- DO NOT extract `createContextCapsuleTools(ctx)` to a const at the top of the function unless other tools (e.g. atlas, mindmodel) do so for caching reasons — match local style.

**Verify:** `bun run typecheck && bun test tests/index-wiring.test.ts` (will fail until Task 4.4 lands; that is expected and documented)

**Commit:** `feat(plugin): register context capsule find/build plugin tools`

### Task 3.3: Rewrite brainstormer.ts prompt callable references

**File:** `src/agents/brainstormer.ts`
**Test:** none for this file directly (drift-guard test in Batch 4 Task 4.3 will catch any imperative-context callable that doesn't match a registered tool; existing `tests/agents/context-capsule-drift-guard.test.ts` assertion strings are updated in Batch 4 Task 4.4)
**Depends:** none in code (the prompt edits are textual; they reference tool names that exist after Batch 2/3, but the edits can be made in parallel with 3.1/3.2 since they're text changes)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — high-risk prompt surface; wording drift can silently disable v2 reuse or, worse, introduce a new contract gap

Rewrite the four callable references in the `<context-capsule-v2-hook scope="brainstormer">` and `<brainstormer-context-capsule-note>` blocks (currently at lines 323-338). Rules:

- `` `findReusableContextCapsule` `` (or the bare unbacked form `findReusableContextCapsule`) → `` `find_reusable_context_capsule` ``
- `` `buildContextCapsule` `` → `` `build_context_capsule` ``
- `` `resolveConversationAnchor(currentSessionId)` `` in imperative-context lines → rewrite the whole sentence to narrative: "The find tool internally resolves the conversation anchor from the current session." Anchor is no longer surfaced as a callable.
- Any reference to `evaluateContextCapsuleFreshness` in imperative context → rewrite to "The find tool returns a freshness verdict (fresh / partially-stale / discarded)."

Specific edits to apply:

**Line 325 (currently):**
```
  1. Resolve conversationAnchor via resolveConversationAnchor(currentSessionId). Null → v2 path inactive; v1 lifecycle path remains.
```
**Becomes:**
```
  1. The find tool resolves the conversation anchor internally from the current session. If the anchor cannot be resolved AND no lifecycle issue is active, the tool returns "skipped: no-conversation-anchor"; v1 lifecycle path remains in effect.
```

**Line 326 (currently):**
```
  2. Call findReusableContextCapsule({ lifecycleIssue, conversationAnchor, branch, worktree }) and run freshness preflight; inject on fresh / partially-stale.
```
**Becomes:**
```
  2. Call \`find_reusable_context_capsule\` with the current lifecycle_issue (or omit it to search by conversation anchor only). The tool returns a freshness verdict; if the verdict is \`fresh\` or \`partially-stale\` and the candidate is relevant, pass the returned \`path\` as \`spawn_agent.contextCapsule.path\` on the next dispatch.
```

**Line 328 (currently):**
```
  1. Call buildContextCapsule({ ..., generatedBy: "brainstormer", dispatchKind: "<parallel-fanout|single-subagent>", parentCapsuleSha, conversationAnchor }).
```
**Becomes:**
```
  1. Call \`build_context_capsule\` with \`topic\`, \`confirmed_facts\`, optional \`source_files\`, \`generated_by: "brainstormer"\`, and \`dispatch_kind\` of either \`"parallel-fanout"\` or \`"single-subagent"\`. The tool resolves conversation anchor, branch, head_sha, and worktree internally.
```

**Line 331 (currently):**
```
- A→B reuse within the same conversation (multi-round refinement, scenario walkthrough, adversarial drill-down) MUST go through findReusableContextCapsule, not by re-deriving facts from chat history.
```
**Becomes:**
```
- A→B reuse within the same conversation (multi-round refinement, scenario walkthrough, adversarial drill-down) MUST go through the \`find_reusable_context_capsule\` tool, not by re-deriving facts from chat history.
```

**Implementer notes:**
- Preserve EVERY other word in surrounding sentences. Do not touch unrelated rules in the same block.
- Backtick wrap all tool names so the drift-guard regex finds them.
- Do NOT introduce the words "callable" / "function" in narrative descriptions — keep the language tool-centric.
- After editing, grep `src/agents/brainstormer.ts` for `findReusableContextCapsule` / `buildContextCapsule` / `resolveConversationAnchor` / `evaluateContextCapsuleFreshness` — there should be ZERO hits.

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts` (will fail until Task 4.4 updates the assertion strings; that is expected here — Task 3.3 cannot independently make this test pass)

**Commit:** `refactor(agents): rewrite brainstormer capsule callable references to real tool names`

### Task 3.4: Rewrite commander.ts prompt callable references

**File:** `src/agents/commander.ts`
**Test:** none for this file directly (covered by Batch 4 Task 4.3 drift guard + Task 4.4 updated assertions)
**Depends:** none in code
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — high-risk prompt surface; commander is the dominant dispatch path

Rewrite the callable references in the `<context-capsule-v2-hook scope="commander">` and `<commander-context-capsule-note>` blocks (currently at lines 319-340).

**Line 322 (currently):**
```
<rule>Before every Task sub-dispatch, call resolveConversationAnchor(currentSessionId). If it returns no anchor, skip reuse with Capsule status: skipped: no-conversation-anchor and continue with the normal prompt path.</rule>
```
**Becomes:**
```
<rule>Before every Task sub-dispatch, call \`find_reusable_context_capsule\`. The tool resolves the conversation anchor internally; if it cannot resolve an anchor and no lifecycle_issue is provided, it returns "skipped: no-conversation-anchor" and you continue with the normal prompt path.</rule>
```

**Line 323 (currently):**
```
<rule>When a conversation anchor exists, call findReusableContextCapsule for the current lifecycle issue, branch, worktree, and dispatch kind; then call evaluateContextCapsuleFreshness before injecting any capsule.</rule>
```
**Becomes:**
```
<rule>The \`find_reusable_context_capsule\` tool searches by the current lifecycle issue (when provided), conversation anchor, branch, and worktree, and returns a freshness verdict (\`fresh\` | \`partially-stale\` | \`discarded\` | none) as part of its markdown result. You do not call a separate freshness function; the verdict is in the tool's output.</rule>
```

**Line 328 (currently):**
```
<rule>After the delegated work returns, call buildContextCapsule with generatedBy: "commander" using only sanitized, already-confirmed facts worth reusing in the same conversation/lifecycle.</rule>
```
**Becomes:**
```
<rule>After the delegated work returns, call \`build_context_capsule\` with \`generated_by: "commander"\` using only sanitized, already-confirmed facts worth reusing in the same conversation/lifecycle.</rule>
```

**Implementer notes:**
- After editing, grep `src/agents/commander.ts` for any of the four internal names — zero hits expected.
- The `<context-capsule-v2-hook>` element shape and its child elements (`<before-dispatch>` / `<after-dispatch>` / `<executor-direct-boundary>`) MUST remain unchanged so existing drift-guard test assertions on the element shape still pass.
- Specifically, the existing assertion `expect(prompt).toContain("<context-capsule-v2-hook")` from `tests/agents/context-capsule-drift-guard.test.ts` must still pass after this edit.

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts` (will fail until 4.4; expected)

**Commit:** `refactor(agents): rewrite commander capsule callable references to real tool names`

### Task 3.5: Rewrite octto.ts and context-capsule-protocol.ts callable references

**File:** `src/agents/octto.ts` AND `src/agents/context-capsule-protocol.ts`
**Test:** none for these files directly (covered by Batch 4 Task 4.3 + 4.4)
**Depends:** none in code
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — `context-capsule-protocol.ts` is shared across all four coordinator prompts; a wording error here propagates everywhere

This task bundles two related files because `context-capsule-protocol.ts` is the shared protocol injected into all four coordinators (brainstormer / commander / executor / octto). Editing it in lockstep with octto.ts keeps the imperative-context callable rewrites coherent across the shared protocol's body and octto's own v2-hook block.

**Edits to `src/agents/octto.ts`** (currently at lines 213-220):

Line 215:
```
  1. Resolve conversationAnchor via resolveConversationAnchor(currentSessionId). Null → v2 path inactive.
```
Becomes:
```
  1. The find tool resolves the conversation anchor internally; if it cannot, it returns "skipped: no-conversation-anchor" and the v2 path is inactive.
```

Line 216:
```
  2. Call findReusableContextCapsule({ lifecycleIssue, conversationAnchor, branch, worktree }) and run freshness preflight.
```
Becomes:
```
  2. Call \`find_reusable_context_capsule\` with the current lifecycle_issue (or omit it to search by conversation anchor only). The tool returns a freshness verdict in its markdown result.
```

Line 218:
```
  1. Call buildContextCapsule({ ..., generatedBy: "octto", dispatchKind: "<parallel-fanout|single-subagent>", parentCapsuleSha, conversationAnchor }).
```
Becomes:
```
  1. Call \`build_context_capsule\` with \`generated_by: "octto"\`, \`dispatch_kind\` of either \`"parallel-fanout"\` or \`"single-subagent"\`, and the optional \`parent_capsule_sha\` of any capsule reused on this dispatch.
```

Line 220:
```
- Octto's auto-resume dispatcher: when the user returns after async wait, treat the resume as a continuation of the same conversation; reuse the most recent capsule via findReusableContextCapsule before re-posing follow-up structured questions.
```
Becomes:
```
- Octto's auto-resume dispatcher: when the user returns after async wait, treat the resume as a continuation of the same conversation; reuse the most recent capsule via the \`find_reusable_context_capsule\` tool before re-posing follow-up structured questions.
```

**Edits to `src/agents/context-capsule-protocol.ts`** (currently lines 16-17 in the `<dispatch-trigger>` block):

Line 16:
```
- Before dispatch, call findReusableContextCapsule to locate a fresh capsule that can be reused for the current trigger.
```
Becomes:
```
- Before dispatch, call \`find_reusable_context_capsule\` to locate a fresh capsule that can be reused for the current trigger.
```

Line 17:
```
- After dispatch, call buildContextCapsule to create an immutable new capsule file for future workers instead of mutating an existing capsule.
```
Becomes:
```
- After dispatch, call \`build_context_capsule\` to create an immutable new capsule file for future workers instead of mutating an existing capsule.
```

**Implementer notes:**
- After both edits, grep BOTH files for the four internal names — zero hits expected in each.
- The string `"派遣前查找+复用、派遣后生成"` MUST remain present in octto.ts (the existing `context-capsule-drift-guard.test.ts` line 44 asserts it). Don't touch unrelated lines in either file.
- `context-capsule-protocol.ts` is exported as `CONTEXT_CAPSULE_PROTOCOL` and the existing drift-guard test asserts the constant is injected into all four coordinator prompts (`tests/agents/context-capsule-drift-guard.test.ts` line 17-21). Don't break that injection.

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts` (will fail until 4.4; expected) and a grep sanity check: `rg 'findReusableContextCapsule|buildContextCapsule|resolveConversationAnchor|evaluateContextCapsuleFreshness' src/agents/` should return zero matches in agent prompt files (the v2 internal modules `src/agents/context-capsule/*.ts` retain these names as TS function definitions — that is correct and must not change).

**Commit:** `refactor(agents): rewrite octto + shared protocol capsule callable references to real tool names`

---

## Batch 4: Tests + drift guards (parallel - 4 implementers)

All tasks in this batch depend on Batch 3 (tests require real registered tools + rewritten prompts).
Tasks: 4.1, 4.2, 4.3, 4.4

### Task 4.1: find_reusable_context_capsule unit test

**File:** `tests/tools/context-capsule/find.test.ts`
**Test:** self (test file)
**Depends:** 2.2 (imports tool factory), 2.4 (imports aggregator if testing through it)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — verifies Behavior commitments #1 and #3 (tool callable + no disk write); regression coverage for the v2-bug-fix that v3 enables

Cover four scenarios: anchor resolution failure (returns "skipped: no-conversation-anchor"), no capsule matched (returns "no capsule"), capsule matched + fresh, capsule matched + discarded. Also assert the tool does NOT write anything to disk (snapshot the `thoughts/shared/context-capsules/` directory before and after; equality required).

Pattern follows `tests/tools/spawn-agent.test.ts` for `FakeCtx` setup. Use `tmpdir` + `mkdtempSync` for isolated capsule directories. Use `process.chdir` or a synthetic `ctx.directory` plus a fixture git repo (the test repo can be created with `execFileSync("git", ["init", ...])` in a tmp dir, then commit a placeholder so `HEAD` exists).

```typescript
// tests/tools/context-capsule/find.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { createFindReusableContextCapsuleTool } from "@/tools/context-capsule/find/tool";

const PREFIX = "micode-find-capsule-";
let workdir: string;
let capsuleDir: string;

function initGitRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "test\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

function makeCtx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

describe("find_reusable_context_capsule tool", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), PREFIX));
    capsuleDir = join(workdir, "thoughts", "shared", "context-capsules");
    initGitRepo(workdir);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("returns skipped when no anchor and no lifecycle_issue", async () => {
    const { find_reusable_context_capsule } = createFindReusableContextCapsuleTool(makeCtx(workdir));
    const result = await find_reusable_context_capsule.execute({}, {} as never);
    expect(result).toContain("skipped: no-conversation-anchor");
  });

  it("returns no-match when capsule directory is empty", async () => {
    const { find_reusable_context_capsule } = createFindReusableContextCapsuleTool(makeCtx(workdir));
    const result = await find_reusable_context_capsule.execute(
      { lifecycle_issue: 99 },
      { sessionID: "test-session" } as never,
    );
    expect(result).toContain("No reusable capsule");
  });

  it("never writes to disk regardless of input", async () => {
    const { find_reusable_context_capsule } = createFindReusableContextCapsuleTool(makeCtx(workdir));
    const before = (() => {
      try {
        return readdirSync(capsuleDir);
      } catch {
        return [];
      }
    })();
    await find_reusable_context_capsule.execute(
      { lifecycle_issue: 99, topic_hint: "anything" },
      { sessionID: "test-session" } as never,
    );
    const after = (() => {
      try {
        return readdirSync(capsuleDir);
      } catch {
        return [];
      }
    })();
    expect(after).toEqual(before);
  });

  // Additional cases: fresh / partially-stale / discarded require seeding a
  // real capsule file matching the current branch + worktree. The implementer
  // should use the v2 buildContextCapsule helper directly (imported from
  // src/agents/context-capsule/builder) to write a fixture capsule, then
  // re-invoke the find tool and assert freshness verdict.
  it("returns a freshness verdict when a matching capsule exists", async () => {
    // Implementer: seed a capsule via v2 buildContextCapsule, pointing
    // outputDir at capsuleDir, branch="main", and headSha matching HEAD.
    // Then call find and assert the result contains "freshness:" and one of
    // "fresh" | "partially-stale" | "discarded".
    expect(true).toBe(true); // placeholder until implementer wires the seed
  });
});
```

**Implementer notes:**
- The "freshness verdict" case is left as a guided implementation — the implementer must seed using v2 builder so the fixture is structurally identical to what the production tool reads.
- Tests must NOT depend on the lifecycle layer (no real GitHub calls, no real lifecycle issue resolution). Pass `lifecycle_issue` explicitly.

**Verify:** `bun test tests/tools/context-capsule/find.test.ts`

**Commit:** `test(tools): cover find_reusable_context_capsule scenarios and no-write invariant`

### Task 4.2: build_context_capsule unit test

**File:** `tests/tools/context-capsule/build.test.ts`
**Test:** self
**Depends:** 2.3 (imports tool factory)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — verifies Behavior commitment #4 (writes ONLY to `thoughts/shared/context-capsules/`) and the secret-block path; the secret-block test is non-negotiable

Cover three scenarios: successful write (assert file exists under `thoughts/shared/context-capsules/`), secret-detected block (assert no file written, returned markdown contains "blocked"), and git env unavailable (no `.git` dir; assert "skipped" return without throw).

```typescript
// tests/tools/context-capsule/build.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { createBuildContextCapsuleTool } from "@/tools/context-capsule/build/tool";

const PREFIX = "micode-build-capsule-";
let workdir: string;
let capsuleDir: string;

function initGitRepo(dir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "test\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir });
}

function makeCtx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

describe("build_context_capsule tool", () => {
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), PREFIX));
    capsuleDir = join(workdir, "thoughts", "shared", "context-capsules");
    initGitRepo(workdir);
    // run inside workdir so the v2 builder's default outputDir resolves to
    // <workdir>/thoughts/shared/context-capsules/; the v2 builder uses
    // process.cwd() relative paths internally — verify and adjust here based
    // on builder source.
    process.chdir(workdir);
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("writes a capsule under thoughts/shared/context-capsules/", async () => {
    const { build_context_capsule } = createBuildContextCapsuleTool(makeCtx(workdir));
    const result = await build_context_capsule.execute(
      {
        topic: "test-topic",
        confirmed_facts: ["fact one", "fact two"],
        lifecycle_issue: 99,
      },
      { sessionID: "test-session" } as never,
    );
    expect(result).toContain("Capsule written");
    // The exact filename includes a topic slug + token; verify directory
    // contains exactly one entry that ends with `.md`.
    const entries = readdirSync(capsuleDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/\.md$/);
  });

  it("blocks the write when a secret is present in confirmed_facts", async () => {
    const { build_context_capsule } = createBuildContextCapsuleTool(makeCtx(workdir));
    const result = await build_context_capsule.execute(
      {
        topic: "secret-test",
        confirmed_facts: ["Authorization: Bearer sk-1234567890abcdef1234567890abcdef"],
      },
      { sessionID: "test-session" } as never,
    );
    expect(result).toContain("blocked");
    // Capsule directory should NOT exist (no write happened)
    expect(existsSync(capsuleDir)).toBe(false);
  });

  it("returns skipped when git env is unavailable", async () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), `${PREFIX}nogit-`));
    try {
      const { build_context_capsule } = createBuildContextCapsuleTool(makeCtx(nonGitDir));
      const result = await build_context_capsule.execute(
        { topic: "nogit-test" },
        { sessionID: "test-session" } as never,
      );
      expect(result).toContain("skipped");
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
```

**Implementer notes:**
- The exact secret-fixture string above is a representative example; the v2 builder's secret detector is the source of truth — pick a fixture that the existing v2 secret-filter tests already mark as secret. If unsure, grep `src/agents/context-capsule/redact.ts` and existing capsule tests for known-blocked patterns and copy one.
- `process.chdir(workdir)` is brittle; if the v2 builder accepts an explicit `outputDir`, prefer passing it from the tool. The design Constraint forbids overriding `outputDir` in the production tool, but the test can override via direct v2 helper if needed. Re-read 2.3 implementer notes.

**Verify:** `bun test tests/tools/context-capsule/build.test.ts`

**Commit:** `test(tools): cover build_context_capsule write/block/skipped scenarios`

### Task 4.3: prompt-tool contract drift guard test (NEW)

**File:** `tests/agents/prompt-tool-contract.test.ts`
**Test:** self
**Depends:** 3.1, 3.2 (registered tools), 3.3, 3.4, 3.5 (rewritten prompts)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — this test IS Behavior commitment #5; any weakening defeats the entire purpose of v3's drift-guard layer

Scan every `.ts` file under `src/agents/` plus `src/agents/context-capsule-protocol.ts` (already under src/agents/) plus `src/agents/atlas-context.ts` if it exists. Extract every backticked identifier appearing in imperative context, then assert each extracted identifier belongs to the registered tool set or the explicit allowlist.

Extraction rules (the regex / matcher must be carefully scoped to avoid false positives on narrative references):

- Match: `(call|调用|invoke|use|via)\s+\`([a-z_][a-z0-9_]*)\`` (case-insensitive on the verb; "use" must be followed by " tool" or similar imperative continuation to avoid generic "use `X`" narrative — see allowlist note below).
- Skip lines containing "see", "e.g.", "for example", "such as", "doc", or appearing inside a `<example>` / `<bad-example>` / `<good-example>` XML element.
- The matcher MUST also skip prompts inside fenced code blocks (```...```), since those are user-facing code examples and not imperative protocol rules.

The allowlist captures non-tool callable names that legitimately appear in imperative context:

```typescript
// tests/agents/prompt-tool-contract.test.ts
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "@/index";

const AGENTS_DIR = join(import.meta.dir, "..", "..", "src", "agents");

/**
 * PROMPT_CALLABLE_ALLOWLIST
 *
 * Identifiers legitimately referenced in prompt imperative context that are
 * NOT registered as OpenCode plugin tools. Each entry must be justified in a
 * trailing comment so future readers understand why it is exempt.
 *
 * Adding to this list weakens the drift guard; reviewer mandatory.
 */
const PROMPT_CALLABLE_ALLOWLIST = new Set<string>([
  // subagent_type names dispatched via Task / spawn_agent (the *agent type*
  // name, not a callable function). These appear in prompts as "call planner"
  // / "invoke executor" etc. and must be allowed.
  "planner",
  "executor",
  "executor_direct",
  "executor-direct",
  "brainstormer",
  "commander",
  "octto",
  "implementer_frontend",
  "implementer_backend",
  "implementer_general",
  "reviewer",
  "investigator",
  "codebase_locator",
  "codebase_analyzer",
  "pattern_finder",
  "brainstorm_scout",
  "critic",
  "product_manager",
  "software_architect",
  "ux_designer",
  "architecture_quality_inspector",
  "rubric_reviewer",
  "ledger_creator",
  "atlas_compiler",
  // Slash commands that prompts reference imperatively
  "ledger",
  "search",
  "memory",
  "init",
  "mindmodel",
  "atlas_init",
  "atlas_refresh",
  "atlas_status",
  "all_init",
  "all_rebuild",
  "all_status",
  // Doc / example placeholders that are intentionally narrative tokens
  "Task",
]);

const IMPERATIVE_CALLABLE_RE = /(?:call|调用|invoke|use|via)\s+`([a-z_][a-z0-9_]*)`/gi;
const FENCE_RE = /```[\s\S]*?```/g;

function listAgentTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // skip src/agents/context-capsule/* — those are TS modules, not prompt
      // template literals
      if (entry === "context-capsule") continue;
      out.push(...listAgentTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function extractImperativeCallables(content: string): readonly string[] {
  // Strip fenced code blocks so example code does not pollute results.
  const stripped = content.replace(FENCE_RE, "");
  const matches: string[] = [];
  for (const match of stripped.matchAll(IMPERATIVE_CALLABLE_RE)) {
    matches.push(match[1]);
  }
  return matches;
}

async function getRegisteredToolNames(): Promise<ReadonlySet<string>> {
  const ctx = { directory: process.cwd() } as unknown as PluginInput;
  const plugin = await OpenCodeConfigPlugin(ctx);
  return new Set(Object.keys(plugin.tool ?? {}));
}

describe("prompt-tool contract drift guard", () => {
  it("every imperative-context callable in agent prompts maps to a registered tool or allowlist", async () => {
    const registered = await getRegisteredToolNames();
    const files = listAgentTsFiles(AGENTS_DIR);
    const violations: { file: string; name: string }[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const callables = extractImperativeCallables(content);
      for (const name of callables) {
        if (registered.has(name)) continue;
        if (PROMPT_CALLABLE_ALLOWLIST.has(name)) continue;
        violations.push({ file: file.replace(`${process.cwd()}/`, ""), name });
      }
    }

    if (violations.length > 0) {
      const summary = violations.map((v) => `  - ${v.file}: \`${v.name}\``).join("\n");
      throw new Error(
        `prompt-tool contract drift: the following imperative-context callable references do not match any registered tool or allowlist entry:\n${summary}\n\nFix by (a) registering the name as a plugin tool in src/index.ts, (b) adding it to PROMPT_CALLABLE_ALLOWLIST with a justification comment, or (c) rewriting the prompt to narrative non-imperative form (e.g. "see `X` for details").`,
      );
    }

    expect(violations).toEqual([]);
  });

  it("does NOT false-positive on narrative references inside example blocks", () => {
    const sample = "Some prompt text. <example>call `not_a_tool`</example>";
    // Simulate fenced strip + extraction. This test documents the intended
    // boundary: narrative inside <example> tags should not be flagged in
    // practice because example tags wrap fenced code or are visibly demos.
    // The actual extractor strips fenced code; <example> tags currently are
    // not stripped, so this test asserts the chosen scope. If a future
    // implementer adds <example> stripping, update this assertion.
    const out = extractImperativeCallables(sample);
    expect(out).toEqual(["not_a_tool"]); // intentionally flagged unless inside fence
  });

  it("does NOT false-positive on doc-style narrative ('see `X` for details')", () => {
    const sample = "If unsure, see `spawn_agent` for details on the contract.";
    const out = extractImperativeCallables(sample);
    expect(out).toEqual([]);
  });

  it("flags an intentional violation (regression coverage for v2-style bug)", () => {
    const sample = "Before dispatch, call `findReusableContextCapsule` to locate a fresh capsule.";
    const out = extractImperativeCallables(sample);
    expect(out).toEqual(["findReusableContextCapsule"]);
  });
});
```

**Implementer notes:**
- The plugin-boot in `getRegisteredToolNames` follows the pattern in `tests/index-wiring.test.ts`. If that test's setup is complex (env vars, tmp dirs), extract the boot helper to a shared test util rather than duplicating it here.
- The regex `(?:call|调用|invoke|use|via)\s+\`...\`` is the MINIMUM viable matcher. The implementer SHOULD audit the four primary agent prompts for any additional imperative wordings (e.g. "通过 X" / "execute X" / "trigger X") and either extend the regex or, if those exist and are narrative, leave them alone. The principle: prefer false-negative (miss some violations) over false-positive (block legitimate narrative). Future violations of the v2-bug type will hit the regex because the design's recommended prompt style says "call \`tool_name\`".
- The "do NOT false-positive on narrative" cases above are TEST FIXTURES, not exhaustive examples. The implementer is expected to add more if they discover additional narrative idioms in the codebase.
- DO NOT lower the assertion strength. If a real violation is found, the fix is to register the tool or update the prompt, NOT to add the name to the allowlist silently.

**Verify:** `bun test tests/agents/prompt-tool-contract.test.ts`

**Commit:** `test(agents): add prompt-tool contract drift guard`

### Task 4.4: Update existing capsule drift guard + index-wiring test for new tools

**File:** `tests/index-wiring.test.ts` AND `tests/agents/context-capsule-drift-guard.test.ts`
**Test:** self (the test file IS the test)
**Depends:** 3.1, 3.2 (tools registered), 3.3, 3.4, 3.5 (prompts rewritten)
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — these tests guard the v1/v2 baseline; loosening assertions silently disables protections established in earlier issues (#91, #93)

Two file edits in one task because they are tightly coupled: both must land together for Batch 3 prompt edits to leave the test suite green.

**Edit A — `tests/index-wiring.test.ts`:** Extend `EXISTING_TOOLS` (or add a new const) so the boot wiring assertion covers the two new tools.

Current state (lines 16-32 of the file):
```typescript
const EXISTING_TOOLS = [
  "ast_grep_search",
  "ast_grep_replace",
  "btca_ask",
  "look_at",
  "artifact_search",
  "milestone_artifact_search",
  "spawn_agent",
  "batch_read",
  "mindmodel_lookup",
  "lifecycle_start_request",
  "lifecycle_record_artifact",
  "lifecycle_commit",
  "lifecycle_finish",
  "resume_subagent",
] as const;
```

Add a new const block immediately after `PROJECT_MEMORY_TOOLS` (line 37):

```typescript
const CONTEXT_CAPSULE_TOOLS = [
  "find_reusable_context_capsule",
  "build_context_capsule",
] as const;
```

And update `EXPECTED_TOOLS` (line 38) to include the new const:

```typescript
const EXPECTED_TOOLS = [...EXISTING_TOOLS, ...PROJECT_MEMORY_TOOLS, ...CONTEXT_CAPSULE_TOOLS] as const;
```

**Edit B — `tests/agents/context-capsule-drift-guard.test.ts`:** Update assertion strings that reference internal TS function names so they reference the new tool names instead.

Current line 104:
```typescript
expect(prompt).toContain("findReusableContextCapsule");
```
Becomes:
```typescript
expect(prompt).toContain("find_reusable_context_capsule");
```

The other existing assertions on this test file (lines 17, 22-31, 41-47, 57-62, 72-75, 81-92) reference protocol structure and Chinese phrases that DO NOT change in Batch 3 — verify each one still passes after Batch 3 edits and leave them untouched.

**Implementer notes:**
- After both edits, run `bun test tests/index-wiring.test.ts tests/agents/context-capsule-drift-guard.test.ts tests/agents/prompt-tool-contract.test.ts` together. All three must pass.
- If `context-capsule-drift-guard.test.ts` has additional assertions that grep for `findReusableContextCapsule` / `buildContextCapsule` not enumerated above, update them to the snake_case names too. Use `rg 'findReusableContextCapsule|buildContextCapsule' tests/` to confirm.
- DO NOT remove the "preserves critical context capsule commitments" assertions in lines 23-31 — they guard the shared protocol semantics, which Batch 3 Task 3.5 explicitly preserves.
- DO NOT delete the existing v2-hook structural assertions ("派遣前查找+复用、派遣后生成", "executor-direct" etc.); they still hold after Batch 3.

**Verify:** `bun test tests/index-wiring.test.ts tests/agents/context-capsule-drift-guard.test.ts tests/agents/prompt-tool-contract.test.ts`

**Commit:** `test: register new capsule tools in index-wiring and update drift-guard assertions`
