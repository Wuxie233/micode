---
date: 2026-05-07
topic: "Chinese Intent Classification and Coupling Philosophy"
issue: 50
scope: agents
contract: none
---

# Chinese Intent Classification and Coupling Philosophy Implementation Plan

**Goal:** Add user-visible Chinese intent classification (意图: 快速修复|设计|调试|运维) to brainstormer and commander, and centralize the low-coupling/high-reuse engineering philosophy in a single mindmodel file referenced from AGENTS.md.

**Architecture:** Two layers of change. (1) Primary prompt layer: brainstormer and commander each gain a new `<intent-classification>` block that produces a single Chinese declaration on the first turn of any new request, subordinate to the existing forbidden-surface and non-trivial detectors. (2) Mindmodel layer: a new `.mindmodel/architecture/coupling-reuse.md` becomes the single source of truth for module decoupling and reuse philosophy, registered in `manifest.yaml`, and referenced by a one-line note in `AGENTS.md` (no philosophy duplication).

**Design:** thoughts/shared/designs/2026-05-07-chinese-intent-and-coupling-philosophy-design.md

**Contract:** none (no frontend/backend split; all tasks are general-domain prompt and config edits)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation - all independent files]
```

All five micro-tasks edit independent files and can run in parallel. Task 1.5 (mindmodel test) depends only on the new mindmodel file path and AGENTS.md path being agreed upon, both of which are fixed by this plan; the test does not import any code, it reads files from disk.

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO inter-task code dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Coupling and reuse philosophy mindmodel constraint
**File:** `.mindmodel/architecture/coupling-reuse.md`
**Test:** `tests/mindmodel/coupling-reuse.test.ts`
**Depends:** none
**Domain:** general

**Decision notes (gap-filling):** The design lists four anti-patterns (shotgun business logic, utility duplication, future-proof abstraction, private-state coupling) and three usage stages (brainstormer/architect, planner, reviewer) but does not specify the exact section structure of the mindmodel file. I'm structuring it to match the existing `.mindmodel/architecture/*.md` convention seen in `layers.md` and `organization.md`: a top-level `## Rules` section, then `## Examples` with code-illustrated rules, then `## Anti-patterns` with code-illustrated bad cases. This keeps the new file consistent with the existing mindmodel surface and makes it discoverable via the existing `mindmodel_lookup` machinery without any loader changes. I'm placing the per-stage usage guidance (brainstormer/planner/reviewer) inside `## Rules` as numbered usage notes rather than inventing a new section.

```typescript
// tests/mindmodel/coupling-reuse.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const COUPLING_REUSE_PATH = join(REPO_ROOT, ".mindmodel", "architecture", "coupling-reuse.md");
const MANIFEST_PATH = join(REPO_ROOT, ".mindmodel", "manifest.yaml");
const AGENTS_PATH = join(REPO_ROOT, "AGENTS.md");

describe("coupling-reuse mindmodel constraint", () => {
  it("file exists at the expected path", () => {
    expect(existsSync(COUPLING_REUSE_PATH)).toBe(true);
  });

  it("contains the four core philosophy keywords", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8");
    expect(content).toContain("低耦合");
    expect(content).toContain("模块化");
    expect(content).toContain("复用");
    expect(content).toContain("轮子");
  });

  it("documents the four anti-patterns from the design", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8").toLowerCase();
    expect(content).toMatch(/shotgun.*business|business.*shotgun|散弹.*业务|业务.*散弹/);
    expect(content).toMatch(/utility duplication|工具.*重复|重复.*工具/);
    expect(content).toMatch(/future-proof|过度抽象|future.*abstraction/);
    expect(content).toMatch(/private[-\s]?state|私有状态/);
  });

  it("references the three usage stages: brainstormer/architect, planner, reviewer", () => {
    const content = readFileSync(COUPLING_REUSE_PATH, "utf-8").toLowerCase();
    expect(content).toContain("brainstormer");
    expect(content).toContain("planner");
    expect(content).toContain("reviewer");
  });

  it("is registered in .mindmodel/manifest.yaml under the architecture group", () => {
    const manifest = readFileSync(MANIFEST_PATH, "utf-8");
    expect(manifest).toContain("architecture/coupling-reuse.md");
    const couplingBlock = manifest.match(/-\s*path:\s*architecture\/coupling-reuse\.md[\s\S]*?group:\s*architecture/);
    expect(couplingBlock).not.toBeNull();
  });

  it("is referenced from project AGENTS.md as the single source", () => {
    expect(existsSync(AGENTS_PATH)).toBe(true);
    const agents = readFileSync(AGENTS_PATH, "utf-8");
    expect(agents).toContain(".mindmodel/architecture/coupling-reuse.md");
  });
});
```

```markdown
# 模块解耦与高复用 (Coupling and Reuse Philosophy)

This file is the SINGLE source of truth for module decoupling and reuse philosophy in this project.
AGENTS.md and agent prompts MUST reference this file rather than re-state the philosophy, to avoid drift.

## Rules

- 低耦合优先：模块之间通过显式接口、纯数据或工厂参数通信，禁止跨模块抓取私有状态或内部实现。
- 模块化分层：每个 src/ 子目录承担一个明确职责（agents 管 prompt、hooks 管生命周期、tools 管工具、utils 管纯工具函数），不混业务逻辑。
- 高复用："轮子"先行：业务功能由可复用的小工厂、小工具、共享 hook 拼装，而不是为每个需求新写一段一次性业务代码。
- 新轮子必须有正当性：只有当现有工具无法表达新需求且预期会被多处使用时，才允许新增公共抽象；其他情况优先扩展或组合现有工具。
- 三个使用阶段必须沿用同一份约束：
  1. brainstormer/architect 阶段：设计文档显式列出受影响的耦合面与可复用点，禁止"先做了再说"的临时业务堆积。
  2. planner 阶段：每个 task 标注它修改/新增的耦合面、复用了哪些现有工具、是否引入新轮子；引入新轮子时给出依据。
  3. reviewer 阶段：审查实现是否复用现有工具、是否引入了不必要的新抽象、是否泄露了私有状态或绕过了模块边界。

## Examples

### Reuse an existing utility instead of duplicating
```ts
// GOOD: business code composes existing wheels
import { extractErrorMessage } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("payments");

export function chargeUser(input: ChargeInput) {
  try {
    return processCharge(input);
  } catch (error) {
    log.error("charge failed", { reason: extractErrorMessage(error) });
    throw error;
  }
}
```

### Communicate across modules via explicit injected interfaces
```ts
// GOOD: hook factory takes ctx, no hidden singleton coupling
export function createSomeHook(ctx: PluginInput) {
  return {
    onEvent: async (event: Event) => {
      await ctx.client.session.message(event.sessionID, { text: "ok" });
    },
  };
}
```

### Extend an existing wheel rather than create a new one
```ts
// GOOD: reuse the shared schema-driven validator with a new pipe step
import * as v from "valibot";
import { ConfigSchema } from "@/config-loader";

const StrictConfigSchema = v.pipe(ConfigSchema, v.check((c) => c.timeoutMs > 0, "timeout must be positive"));
```

## Anti-patterns

### Shotgun business logic (散弹式业务堆积)
```ts
// BAD: each new requirement adds a new ad-hoc handler with copy-pasted glue
export function handleNewRequirementA(input: unknown) {
  const log = console.log; // duplicated logger
  try {
    /* one-shot business code, no reuse */
  } catch (error) {
    log("err", error instanceof Error ? error.message : String(error));
  }
}
```

### Utility duplication (工具重复)
```ts
// BAD: re-implements an existing helper
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
// already exists as extractErrorMessage in @/utils/errors
```

### Future-proof abstraction (过度抽象 / future-proof abstraction)
```ts
// BAD: introduces a generic registry plus plugin interface for ONE current caller
export interface PaymentProcessorPlugin<TIn, TOut> {
  readonly id: string;
  readonly version: number;
  process(input: TIn): Promise<TOut>;
}
export class PaymentProcessorRegistry { /* ... only used by stripe today ... */ }
```

### Private-state coupling (私有状态耦合)
```ts
// BAD: reaches into another module's internal cache through a non-exported path
import { _internalCache } from "@/octto/session/sessions";
_internalCache.clear();
```
```

**Verify:** `bun test tests/mindmodel/coupling-reuse.test.ts`
**Commit:** `docs(mindmodel): add coupling-reuse philosophy as single source`

### Task 1.2: Register coupling-reuse in mindmodel manifest
**File:** `.mindmodel/manifest.yaml`
**Test:** none (pure config registration; behavior is covered by Task 1.1's manifest assertion)
**Depends:** none
**Domain:** general

**Decision notes (gap-filling):** The design says "Mindmodel layer stores long-term engineering philosophy ... so planner/reviewer/implementer fetch it via the existing mindmodel_lookup machinery." The existing manifest entries each declare `path`, `description`, and `group`. I'm appending a new entry under the `architecture` group, matching the format of the two existing architecture entries (`layers.md`, `organization.md`). I'm appending after `architecture/organization.md` so the architecture entries stay contiguous. Description is one line in English to match existing entries.

This task is config-only and has no companion test file. The presence and shape of the entry are validated by Task 1.1's `is registered in .mindmodel/manifest.yaml under the architecture group` assertion.

```yaml
# .mindmodel/manifest.yaml — full file after edit
name: micode
version: 2
categories:
  - path: stack/backend.md
    description: Backend runtime and plugin foundations
    group: stack
  - path: stack/database.md
    description: SQLite usage and local persistence
    group: stack
  - path: stack/dependencies.md
    description: Approved external and internal dependencies
    group: stack
  - path: architecture/layers.md
    description: Layering and dependency direction
    group: architecture
  - path: architecture/organization.md
    description: Directory and module organization
    group: architecture
  - path: architecture/coupling-reuse.md
    description: Module decoupling and high-reuse engineering philosophy
    group: architecture
  - path: patterns/error-handling.md
    description: Error handling conventions
    group: patterns
  - path: patterns/logging.md
    description: Logging practices and logger usage
    group: patterns
  - path: patterns/validation.md
    description: Validation with schemas
    group: patterns
  - path: patterns/data-fetching.md
    description: Loading and parsing data files
    group: patterns
  - path: patterns/testing.md
    description: Testing patterns with bun:test
    group: patterns
  - path: style/naming.md
    description: Naming conventions for files and symbols
    group: style
  - path: style/imports.md
    description: Import ordering and module boundaries
    group: style
  - path: style/types.md
    description: TypeScript type usage guidelines
    group: style
  - path: components/shared.md
    description: Shared hooks, tools, and utilities
    group: components
  - path: domain/concepts.md
    description: Domain terminology and workflows
    group: domain
  - path: ops/database.md
    description: Operational database setup and lifecycle
    group: ops
```

**Verify:** `bun test tests/mindmodel/coupling-reuse.test.ts` (the manifest assertion lives there)
**Commit:** `chore(mindmodel): register coupling-reuse.md in manifest`

### Task 1.3: Project AGENTS.md with one-line philosophy reference
**File:** `AGENTS.md`
**Test:** none (covered by Task 1.1's `is referenced from project AGENTS.md as the single source` assertion)
**Depends:** none
**Domain:** general

**Decision notes (gap-filling):** No project-local AGENTS.md exists today (only the global `~/.config/opencode/AGENTS.md`). The design specifies "AGENTS.md 只补一条全局提示：设计哲学约束见 mindmodel 文件" and lists AGENTS.md as a deliverable component. I'm creating a new project-local `AGENTS.md` at the repo root with a minimal Chinese reference line plus a short context header. The file MUST NOT duplicate the philosophy itself: that would re-create the three-place drift the design explicitly forbids. The test in Task 1.1 enforces that `.mindmodel/architecture/coupling-reuse.md` appears as a literal substring; reviewers should reject any expansion that copies philosophy content into this file.

The implementer must NOT touch `~/.config/opencode/AGENTS.md`: that is the global host file, outside the worktree, and out of scope for this issue.

```markdown
# Micode Project AGENTS.md

This file holds project-local agent guidance. Global agent policy still lives in `~/.config/opencode/AGENTS.md` and applies on top of this file.

## Design Philosophy

设计哲学约束（低耦合 / 模块化 / 高复用 / 轮子优先）的唯一权威来源是 `.mindmodel/architecture/coupling-reuse.md`。任何 brainstormer / planner / reviewer 阶段的设计或实现决策都应通过 `mindmodel_lookup` 读取该文件，不要在 prompt 或本文件中复制粘贴完整内容，避免三处 drift。
```

**Verify:** `bun test tests/mindmodel/coupling-reuse.test.ts`
**Commit:** `docs(agents): add project AGENTS.md with mindmodel philosophy reference`

### Task 1.4: Add Chinese intent-classification block to brainstormer
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer.test.ts`
**Depends:** none
**Domain:** general

**Decision notes (gap-filling):** The design specifies four Chinese intents (快速修复/设计/调试/运维), the exact output template `意图: <类型>。理由: <一句话>。`, first-turn-only behavior, and a forbidden-surface worked example. The design does NOT specify the XML block name or its placement relative to existing blocks. I'm choosing:

- Block tag: `<intent-classification priority="HIGH">`. Priority is HIGH (not HIGHEST) because the existing `<non-trivial-detector priority="HIGHEST">` and forbidden-surface logic must dominate when they conflict (the design explicitly says "意图和 detector 冲突: detector 胜出"). Using HIGH here makes the priority ordering visible at the prompt level.
- Placement: immediately AFTER `</non-trivial-detector>` and BEFORE `<routing-by-requested-output>`. Rationale: the detector decides safety (may set the intent to 设计 even for typos on forbidden surfaces); the intent classification then renders the user-visible declaration; routing then picks the subagent. This ordering matches the design's data flow (forbidden surface → detector → intent declaration → routing).
- Worked example: a typo on `src/agents/commander.ts` MUST resolve to `意图: 设计。`, demonstrating that forbidden surface dominates "looks small". This directly mirrors the design's `Error Handling > 意图和 detector 冲突` rule.

The implementer MUST NOT delete, reorder, or weaken any existing block (`<non-trivial-detector>`, `<routing-by-requested-output>`, `<lifecycle>`, etc.). The block is purely additive.

```typescript
// tests/agents/brainstormer.test.ts — APPEND new describe block at the end of the file
//
// (Existing tests in this file remain unchanged; the new tests live in their own describe block.)

describe("brainstormer Chinese intent classification", () => {
  function brainstormerSource(): string {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );
  }

  it("declares an <intent-classification> block", () => {
    expect(brainstormerSource()).toMatch(/<intent-classification[^>]*>/);
    expect(brainstormerSource()).toContain("</intent-classification>");
  });

  it("intent-classification block is placed AFTER non-trivial-detector and BEFORE routing-by-requested-output", () => {
    const src = brainstormerSource();
    const detectorClose = src.indexOf("</non-trivial-detector>");
    const intentOpen = src.search(/<intent-classification[^>]*>/);
    const routingOpen = src.indexOf("<routing-by-requested-output");

    expect(detectorClose).toBeGreaterThan(-1);
    expect(intentOpen).toBeGreaterThan(-1);
    expect(routingOpen).toBeGreaterThan(-1);
    expect(intentOpen).toBeGreaterThan(detectorClose);
    expect(intentOpen).toBeLessThan(routingOpen);
  });

  it("declares the four Chinese intent enum values", () => {
    const src = brainstormerSource();
    expect(src).toContain("快速修复");
    expect(src).toContain("设计");
    expect(src).toContain("调试");
    expect(src).toContain("运维");
  });

  it("declares the user-visible output template with 意图 and 理由", () => {
    const src = brainstormerSource();
    expect(src).toContain("意图:");
    expect(src).toContain("理由:");
  });

  it("declares first-turn-only behavior", () => {
    const src = brainstormerSource().toLowerCase();
    expect(src).toMatch(/first[-\s]turn|第一回合|首回合|新请求.*第一/);
  });

  it("declares priority below forbidden-surface and non-trivial-detector", () => {
    const src = brainstormerSource();
    const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    expect(block).not.toBeNull();
    const body = (block?.[0] ?? "").toLowerCase();
    // Detector wins on conflict.
    expect(body).toMatch(/forbidden[-\s]surface|non-trivial[-\s]detector/);
    expect(body).toMatch(/detector.*胜|胜.*detector|detector wins|detector 优先/i);
  });

  it("includes a worked example where a forbidden-surface typo classifies as 设计", () => {
    const src = brainstormerSource();
    const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toContain("设计");
    expect(body.toLowerCase()).toMatch(/typo|拼写|错别字/);
    expect(body).toMatch(/src\/agents\/|agent\s+prompt|forbidden/i);
  });
});
```

```typescript
// src/agents/brainstormer.ts — INSERT this block immediately AFTER the closing
// </non-trivial-detector> tag and BEFORE the opening <routing-by-requested-output ...> tag.
// Do not modify any other part of the prompt. Indentation and surrounding blank lines
// must match the surrounding prompt style (one blank line above and below the new block).

<intent-classification priority="HIGH">
On the FIRST TURN of every NEW user request, before any subagent spawn or design work,
emit exactly one line at the very top of your response:

意图: <快速修复|设计|调试|运维>。理由: <一句话>。

四个意图的语义：
- 快速修复：小而局部、无 forbidden-surface 的低风险修补（typo、版本号、单行补丁、单文件本地操作）。
- 设计：新功能、架构变更、跨模块改造、或任何触及 forbidden-surface（agent prompt、slash 命令、runtime、deploy、workflow/lifecycle、cross-module）的改动，无论改动看起来多小。
- 调试：未知原因、故障诊断、需要 investigator 证据包；用户描述的是症状或异常。
- 运维：状态查询、部署、配置查阅、GitHub/仓库操作、ops 类纯只读或受控命令。

<priority-order>
本声明是 UX 层，不替代真实路由安全。优先级如下，写在 prompt 中是为了让用户看见冲突时谁胜出：
1. forbidden-surface（最高，触及即视为"设计"）
2. non-trivial-detector（其次，匹配即不能降级到 executor-direct）
3. intent-classification（本块，仅决定用户可见的中文声明）

意图和 detector 冲突时，detector 胜出。永远不能用"快速修复"覆盖 forbidden-surface。
</priority-order>

<rules>
<rule>仅在新请求的第一回合输出该行；同一对话的后续回合不重复输出。</rule>
<rule>请求混合多个意图时选择最高风险意图。例如"顺手改一下 agent prompt typo 并部署"应为"设计"，不是"快速修复"或"运维"。</rule>
<rule>该行必须是响应的最顶端（在 markdown 标题、子代理调用、任何分析之前）。</rule>
<rule>禁止使用 lane、缩写、半英文标签代替四个中文意图。</rule>
</rules>

<worked-example name="forbidden-surface-typo">
用户请求："顺手把 src/agents/commander.ts 里那个 typo 改一下。"
正确输出第一行："意图: 设计。理由: 触及 src/agents/ forbidden-surface，即使是 typo 也走 lifecycle + planner + executor。"
错误输出："意图: 快速修复。"——这是被 forbidden-surface 优先级显式禁止的降级。
</worked-example>

<worked-example name="state-query">
用户请求："看一下当前 issue #50 的 lifecycle 状态。"
正确输出第一行："意图: 运维。理由: 状态查询，纯只读，不需要 design 或 lifecycle 启动。"
</worked-example>

<worked-example name="symptom-without-cause">
用户请求："octto 上 brainstorm 偶尔会丢一个分支，不知道为什么。"
正确输出第一行："意图: 调试。理由: 未知原因的运行时症状，先派 investigator 出证据包再谈改动。"
</worked-example>
</intent-classification>
```

**Verify:** `bun test tests/agents/brainstormer.test.ts && bun run typecheck`
**Commit:** `feat(agents): add Chinese intent-classification block to brainstormer`

### Task 1.5: Add Chinese intent-classification block to commander
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander.test.ts`
**Depends:** none
**Domain:** general

**Decision notes (gap-filling):** The design REQUIRES brainstormer and commander to carry the SAME `<intent-classification>` block ("与 brainstormer 保持完全一致，避免 primary agents 表现分裂"). I'm therefore using BYTE-IDENTICAL block content as Task 1.4. Placement in commander mirrors the brainstormer placement: AFTER the existing detector / quick-mode / quick-op-lane blocks and BEFORE the existing `<routing-by-requested-output>` block. In commander.ts, `<routing-by-requested-output>` opens at line 211 (verified during planner research); the new block goes immediately above that opening tag, separated by one blank line. The implementer MUST keep the block content character-for-character identical to brainstormer's; reviewers should diff the two blocks to confirm.

Per the design's open question ("commander 是否应对所有 ops 输出意图"): the answer is "新请求第一回合输出即可，避免每条状态查询重复". The block already encodes this rule; no commander-specific carve-out is needed.

```typescript
// tests/agents/commander.test.ts — APPEND new describe block at the end of the file.
//
// (Existing tests in this file remain unchanged.)

describe("commander Chinese intent classification", () => {
  function commanderSource(): string {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );
  }

  function brainstormerSource(): string {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );
  }

  it("declares an <intent-classification> block", () => {
    expect(commanderSource()).toMatch(/<intent-classification[^>]*>/);
    expect(commanderSource()).toContain("</intent-classification>");
  });

  it("intent-classification block is placed BEFORE routing-by-requested-output", () => {
    const src = commanderSource();
    const intentOpen = src.search(/<intent-classification[^>]*>/);
    const routingOpen = src.indexOf("<routing-by-requested-output");

    expect(intentOpen).toBeGreaterThan(-1);
    expect(routingOpen).toBeGreaterThan(-1);
    expect(intentOpen).toBeLessThan(routingOpen);
  });

  it("declares the four Chinese intent enum values", () => {
    const src = commanderSource();
    expect(src).toContain("快速修复");
    expect(src).toContain("设计");
    expect(src).toContain("调试");
    expect(src).toContain("运维");
  });

  it("declares the user-visible output template with 意图 and 理由", () => {
    const src = commanderSource();
    expect(src).toContain("意图:");
    expect(src).toContain("理由:");
  });

  it("declares first-turn-only behavior", () => {
    const src = commanderSource().toLowerCase();
    expect(src).toMatch(/first[-\s]turn|第一回合|首回合|新请求.*第一/);
  });

  it("includes a worked example where a forbidden-surface typo classifies as 设计", () => {
    const src = commanderSource();
    const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";
    expect(body).toContain("设计");
    expect(body.toLowerCase()).toMatch(/typo|拼写|错别字/);
    expect(body).toMatch(/src\/agents\/|agent\s+prompt|forbidden/i);
  });

  it("intent-classification block is byte-identical to the brainstormer block (no drift)", () => {
    const commanderBlock = commanderSource().match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    const brainstormerBlock = brainstormerSource().match(/<intent-classification[\s\S]*?<\/intent-classification>/);

    expect(commanderBlock).not.toBeNull();
    expect(brainstormerBlock).not.toBeNull();
    expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
  });
});
```

```typescript
// src/agents/commander.ts — INSERT this block immediately BEFORE the existing
// <routing-by-requested-output ...> opening tag (currently around line 211).
// Separate from the surrounding blocks with one blank line above and below.
// The block content MUST be byte-identical to the block inserted into brainstormer.ts
// in Task 1.4. Do not modify any other part of the prompt.

<intent-classification priority="HIGH">
On the FIRST TURN of every NEW user request, before any subagent spawn or design work,
emit exactly one line at the very top of your response:

意图: <快速修复|设计|调试|运维>。理由: <一句话>。

四个意图的语义：
- 快速修复：小而局部、无 forbidden-surface 的低风险修补（typo、版本号、单行补丁、单文件本地操作）。
- 设计：新功能、架构变更、跨模块改造、或任何触及 forbidden-surface（agent prompt、slash 命令、runtime、deploy、workflow/lifecycle、cross-module）的改动，无论改动看起来多小。
- 调试：未知原因、故障诊断、需要 investigator 证据包；用户描述的是症状或异常。
- 运维：状态查询、部署、配置查阅、GitHub/仓库操作、ops 类纯只读或受控命令。

<priority-order>
本声明是 UX 层，不替代真实路由安全。优先级如下，写在 prompt 中是为了让用户看见冲突时谁胜出：
1. forbidden-surface（最高，触及即视为"设计"）
2. non-trivial-detector（其次，匹配即不能降级到 executor-direct）
3. intent-classification（本块，仅决定用户可见的中文声明）

意图和 detector 冲突时，detector 胜出。永远不能用"快速修复"覆盖 forbidden-surface。
</priority-order>

<rules>
<rule>仅在新请求的第一回合输出该行；同一对话的后续回合不重复输出。</rule>
<rule>请求混合多个意图时选择最高风险意图。例如"顺手改一下 agent prompt typo 并部署"应为"设计"，不是"快速修复"或"运维"。</rule>
<rule>该行必须是响应的最顶端（在 markdown 标题、子代理调用、任何分析之前）。</rule>
<rule>禁止使用 lane、缩写、半英文标签代替四个中文意图。</rule>
</rules>

<worked-example name="forbidden-surface-typo">
用户请求："顺手把 src/agents/commander.ts 里那个 typo 改一下。"
正确输出第一行："意图: 设计。理由: 触及 src/agents/ forbidden-surface，即使是 typo 也走 lifecycle + planner + executor。"
错误输出："意图: 快速修复。"——这是被 forbidden-surface 优先级显式禁止的降级。
</worked-example>

<worked-example name="state-query">
用户请求："看一下当前 issue #50 的 lifecycle 状态。"
正确输出第一行："意图: 运维。理由: 状态查询，纯只读，不需要 design 或 lifecycle 启动。"
</worked-example>

<worked-example name="symptom-without-cause">
用户请求："octto 上 brainstorm 偶尔会丢一个分支，不知道为什么。"
正确输出第一行："意图: 调试。理由: 未知原因的运行时症状，先派 investigator 出证据包再谈改动。"
</worked-example>
</intent-classification>
```

**Verify:** `bun test tests/agents/commander.test.ts tests/agents/brainstormer.test.ts && bun run typecheck`
**Commit:** `feat(agents): add Chinese intent-classification block to commander`
