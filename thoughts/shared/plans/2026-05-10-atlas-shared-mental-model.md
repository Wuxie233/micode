---
date: 2026-05-10
topic: "Atlas Shared Mental Model Maintenance"
issue: 60
scope: atlas
contract: none
---

# Atlas Shared Mental Model Maintenance Implementation Plan

**Goal:** 把 Project Atlas 重新定位为人和 AI 共享的项目心智模型，并落地 Agent-owned Atlas Maintenance Protocol（Consult / Detect / Propose / Merge），把 Atlas 更新触发权从 lifecycle finish 副作用迁移到 agent workflow，同时保证中文优先和 lifecycle 仅作 source provider。

**Architecture:** 在 brainstormer / planner / executor / reviewer 等 primary 与协调 agent 的 prompt 中加入一段权威单源的 `<atlas-mental-model>` 协议块（drift-guarded），由 hook 层负责把现有 `getAtlasSummary` 自动注入扩展到 brainstormer / planner（保持现状）并新增轻量的 status 报告约定。Atlas delta 走 `thoughts/shared/atlas-deltas/` 文件 + `lifecycle_log_artifact(kind=delta)` 指针的最小路径，不引入新工具；现有 `atlas-compiler` / `atlas-worker-*` / finish-spawn 助手降级为用户显式触发或废弃存根，不被 lifecycle 自动调用。中文内容守卫加在 `atlas-translator` 与新增的 `chinese-content-guard` 工具中，并在 prompt 内写明 machine-syntax 白名单。

**Design:** [thoughts/shared/designs/2026-05-10-atlas-shared-mental-model-design.md](../designs/2026-05-10-atlas-shared-mental-model-design.md)

**Contract:** none（micode plugin 内部全部为 `general` 域，无 frontend↔backend 跨域接口）

---

## Dependency Graph

```
Batch 1 (parallel, foundation, no deps): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
  - 1.1 atlas-mental-model 协议单源块（plain string export + drift-guard fixture）
  - 1.2 atlas-status 类型与渲染助手（types + render）
  - 1.3 chinese-content-guard 检测器（pure function）
  - 1.4 atlas-delta artifact 路径与模板助手
  - 1.5 atlas-compiler / atlas-worker-* / finish-spawn 文档化为 user-triggered-only（doc comment + RECONCILE_OWNER 字符串重写）
  - 1.6 设计文档与 AGENTS.md 镜像段落（人类可读单源）

Batch 2 (parallel, agent prompts, depends 1.1, 1.2, 1.3, 1.4): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
  - 2.1 brainstormer.ts 注入 <atlas-mental-model> 块
  - 2.2 planner.ts 注入 <atlas-mental-model> 块 + 新 task 字段约定
  - 2.3 executor.ts 注入精简版 <atlas-mental-model> 块（consult + propagate-only）
  - 2.4 reviewer.ts 注入 detect-only 子集
  - 2.5 commander.ts 注入 consult-only 子集 + 镜像 dispatch 描述
  - 2.6 octto.ts 注入 brainstormer 等价的中文版（语义对齐，不强制 byte-identical）

Batch 3 (parallel, hooks & atlas surface, depends 1.1, 1.2, 1.4): 3.1, 3.2, 3.3, 3.4
  - 3.1 atlas-auto-inject hook 扩展：在 system 块尾部追加 protocol header 行
  - 3.2 atlas-translator agent 加入 chinese-content-guard 引用
  - 3.3 src/tools/atlas/init.ts RECONCILE_OWNER 字符串重写
  - 3.4 src/atlas/finish-spawn.ts / spawn-receipt-marker.ts 顶部 doc-comment：标注为 user-triggered-only，不被 lifecycle 自动调用

Batch 4 (parallel, drift-guard + integration tests, depends 2.x and 3.x): 4.1, 4.2, 4.3, 4.4
  - 4.1 atlas-mental-model drift-guard test
  - 4.2 lifecycle boundary test（grep 断言 lifecycle 不调 atlas-compiler / finish-spawn / handoff）
  - 4.3 chinese-content-guard 在 brainstormer/planner prompt 中可被识别（prompt-string 测试）
  - 4.4 effect-first reporting 与 atlas-status 兼容性测试
```

---

## Batch 1: Foundation (parallel — 6 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6

### Task 1.1: Atlas Mental Model 协议单源块
**File:** `src/agents/atlas-mental-model.ts`
**Test:** `tests/agents/atlas-mental-model.test.ts`
**Depends:** none
**Domain:** general

设计要求 brainstormer / planner / executor / reviewer / commander / octto 这六个 agent 在 prompt 中携带统一的 Atlas Maintenance Protocol。设计未指定单源载体，我决定实现为一个导出单一字符串常量 `ATLAS_MENTAL_MODEL_PROTOCOL` 的纯模块，prompt 通过模板字面量 `${ATLAS_MENTAL_MODEL_PROTOCOL}` 注入。drift-guard 测试只验证字符串被正确注入，不强制整段 prompt byte-identical（避免 R1 改一处需同步六处的维护噩梦）。

协议字符串本身分为四个 section（Consult / Detect / Propose / Merge），加四个状态字面量（`consulted` / `no-change` / `delta-created` / `stale-detected` / `blocked` / `cannot-assess`），并显式列出 atlas-context 与 `atlas_lookup` 的使用边界以及 lifecycle 仅作 source provider 的硬规则。

```typescript
// tests/agents/atlas-mental-model.test.ts
import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL, ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";

describe("ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  it("contains all four protocol sections", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Consult");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Detect");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Propose");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Merge");
  });

  it("declares lifecycle as source provider only, not update owner", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("source provider");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("lifecycle_finish auto-spawn");
  });

  it("requires Chinese-first project information in delta prose", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("中文优先");
    // machine syntax allowlist must be explicit
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("frontmatter");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("wikilink");
  });

  it("exports the canonical status value list", () => {
    expect(ATLAS_STATUS_VALUES).toEqual([
      "consulted",
      "no-change",
      "delta-created",
      "stale-detected",
      "blocked",
      "cannot-assess",
    ]);
  });

  it("references the delta artifact path convention", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("thoughts/shared/atlas-deltas/");
  });
});
```

```typescript
// src/agents/atlas-mental-model.ts
/**
 * Single source of truth for the Atlas Mental Model Maintenance Protocol.
 *
 * This string is injected into brainstormer / planner / executor / reviewer /
 * commander / octto prompts via template-literal interpolation. Drift-guard
 * tests verify presence; they do NOT enforce byte-identical surrounding prompt.
 *
 * Lifecycle is a source provider only. This module does NOT register any
 * lifecycle-finish auto-spawn behaviour. See R2 / R7 in the plan.
 */

export const ATLAS_STATUS_VALUES = [
  "consulted",
  "no-change",
  "delta-created",
  "stale-detected",
  "blocked",
  "cannot-assess",
] as const;

export type AtlasStatus = (typeof ATLAS_STATUS_VALUES)[number];

export const ATLAS_MENTAL_MODEL_PROTOCOL = `<atlas-mental-model priority="critical" description="Project Atlas as the shared human+AI mental model">
<purpose>
Project Atlas (atlas/) 是人和 AI 共享的项目心智模型，不是 AI 私有缓存、代码索引或 lifecycle 副作用。
任何想要全局理解 micode 的人或 agent，最该先读 Atlas。
本协议规定 agent 在工作过程中如何 Consult / Detect / Propose / Merge Atlas，并在终态报告里给出 Atlas status。
</purpose>

<role-of-lifecycle priority="hard">
Lifecycle 只是 source provider。它提供 issue / design / plan / commit / PR / ledger 等来源材料，
但不拥有 Atlas 更新触发权。绝对不允许通过 lifecycle_finish 隐式自动 spawn atlas-compiler 或写入 Atlas vault。
Atlas update 必须由 agent 显式产生 delta 并通过 atlas-compiler / atlas-worker-* / /atlas-refresh 这些用户可见入口归并。
</role-of-lifecycle>

<protocol>
<step name="Consult">
非平凡任务（设计 / 计划 / 跨模块改动 / 引入新机制）开始时，必须 consult Atlas：
读取 brainstormer/planner 自动注入的 atlas-context；按需调用 atlas_lookup(query, layer?) 获取更深入的节点。
优先关注：00-index、相关 10-impl、20-behavior、40-decisions、50-risks。
若 atlas-context 缺失或 atlas_lookup 返回 vault 未初始化，记录 status=cannot-assess 并继续主任务，不阻塞。
</step>

<step name="Detect">
工作中若发现代码事实 / 用户行为 / 架构决策与 Atlas 节点冲突：
- 证据充分（例如能给出 git source link 或 design 文档反例）→ 标记 status=stale-detected，并把冲突点摘要写进终态报告。
- 证据不足 → 标记 status=cannot-assess，不要把旧 claim 当事实使用，也不要静默覆盖。
人工编辑过的节点（atlas/_meta 标注或 mtime 漂移）一律走 challenge 路线，禁止直接 overwrite。
</step>

<step name="Propose">
任务结束前，根据"是否改变高级工程师解释项目的方式"判断：
- 改变了模块职责 / 用户行为规则 / workflow contract / 关键决策 / 长期风险 → status=delta-created，写一份 delta 文件。
- 仅改了局部实现细节、bug 修复、prompt 微调、测试用例 → status=no-change。
delta 文件路径：thoughts/shared/atlas-deltas/YYYY-MM-DD-{topic}-delta.md
delta 内容包含：目标层（10-impl / 20-behavior / 40-decisions / 50-risks）、claim 中文正文、source pointer、影响范围、stale/uncertain 标记。
中文优先：节点名、H1/H2、prose、summary、rationale、risk、behavior 描述用中文。
机器语法保留英文：frontmatter keys、IDs、wikilink syntax (\\[\\[...\\]\\])、file paths、tool names、command names、source pointers (code:.../lifecycle:.../thoughts:...)、test names、code symbols。
若 lifecycle 处于 active 状态，调用 lifecycle_log_artifact(kind=delta, pointer=<path>) 把 delta 注册到 issue body；否则只把 delta 路径写进终态报告，由用户决定何时 merge。
</step>

<step name="Merge">
delta 不由 primary agent 直接写入 Atlas vault。Merge 由 atlas-compiler 或 /atlas-refresh 走 staging → reconcile → atomic-rename，
保留人工编辑保护、challenge 路由和写锁。本协议下 merge 永远是用户显式触发或后续会话显式触发，禁止自动调用。
</step>
</protocol>

<status-reporting priority="critical">
终态用户可见汇报（effect-first 第四段 "实现记录"）必须包含一行 Atlas status，取值之一：
${ATLAS_STATUS_VALUES.join(" | ")}
缺省时由 primary agent 从已知证据补全，不能省略。
- consulted：读了 atlas-context 但本任务未触发 detect/propose 后续动作（极少；通常会跟一个 no-change）。
- no-change：本任务不改变长期心智模型。
- delta-created：本任务已产出 delta 文件，附路径。
- stale-detected：发现 Atlas 与现状冲突但本任务不修，已记录到终态报告由用户决定如何处理。
- blocked：delta 已产出但 merge 失败 / atlas vault 写锁占用 / atlas-compiler 不可用。
- cannot-assess：atlas-context 读取失败或 vault 未初始化。
</status-reporting>

<chinese-content-guard>
传递项目信息（节点名 / 标题 / 正文 / summary / behavior 描述 / decision rationale / risk 描述）必须中文优先。
机器语法白名单（保留英文，禁止误翻）：frontmatter keys、IDs、wikilink syntax、file paths、tool names（atlas_lookup / lifecycle_finish / spawn_agent 等）、command names（/atlas-init / /atlas-refresh / /ledger 等）、source pointers (code:... / lifecycle:... / thoughts:...)、test names、code symbols (function/class/variable identifiers)、fenced code blocks 内全部内容。
违反时由 atlas-compiler / atlas-worker-* 在 reconcile 阶段标记并 challenge，不要在 primary agent 内强行翻译。
</chinese-content-guard>

<anti-patterns>
- 把 lifecycle_finish 当作 Atlas 更新入口。
- 在没有证据的情况下静默覆盖 Atlas stale claim。
- 把每次 bug 修复或 prompt 微调都产出 delta（应当是 no-change）。
- 把节点名 / H1 / 正文用英文，但机器语法（wikilink / path / code symbol）被翻译成中文。
- 在 implementer / reviewer 等 leaf agent 里调用 atlas_lookup 工具（leaf agent 只接受父层传递的 atlas excerpt）。
</anti-patterns>
</atlas-mental-model>`;
```

**Verify:** `bun test tests/agents/atlas-mental-model.test.ts && bun typecheck`
**Commit:** `feat(atlas): add atlas-mental-model protocol single source`

---

### Task 1.2: Atlas status 类型与渲染助手
**File:** `src/atlas/atlas-status.ts`
**Test:** `tests/atlas/atlas-status.test.ts`
**Depends:** none
**Domain:** general

为 effect-first "实现记录" 段提供一个轻量 status 渲染器，让 primary agent 不用手拼字符串。设计未指定接口；我决定实现为一个 pure function `renderAtlasStatusLine(status, detail?)` 输出 `Atlas status: <status>` 或 `Atlas status: <status> — <detail>`，并对 status 取值做 union-type 校验（复用 1.1 的 `AtlasStatus`）。

```typescript
// tests/atlas/atlas-status.test.ts
import { describe, expect, it } from "bun:test";
import { renderAtlasStatusLine } from "@/atlas/atlas-status";

describe("renderAtlasStatusLine", () => {
  it("renders bare status without detail", () => {
    expect(renderAtlasStatusLine("no-change")).toBe("Atlas status: no-change");
  });

  it("appends detail with em-dash separator", () => {
    expect(renderAtlasStatusLine("delta-created", "thoughts/shared/atlas-deltas/2026-05-10-x-delta.md"))
      .toBe("Atlas status: delta-created — thoughts/shared/atlas-deltas/2026-05-10-x-delta.md");
  });

  it("trims whitespace in detail", () => {
    expect(renderAtlasStatusLine("stale-detected", "  10-impl/foo.md conflict  "))
      .toBe("Atlas status: stale-detected — 10-impl/foo.md conflict");
  });

  it("treats empty / whitespace-only detail as bare", () => {
    expect(renderAtlasStatusLine("cannot-assess", "")).toBe("Atlas status: cannot-assess");
    expect(renderAtlasStatusLine("cannot-assess", "   ")).toBe("Atlas status: cannot-assess");
  });
});
```

```typescript
// src/atlas/atlas-status.ts
import type { AtlasStatus } from "@/agents/atlas-mental-model";

export function renderAtlasStatusLine(status: AtlasStatus, detail?: string): string {
  const trimmed = detail?.trim() ?? "";
  if (trimmed.length === 0) return `Atlas status: ${status}`;
  return `Atlas status: ${status} — ${trimmed}`;
}
```

**Verify:** `bun test tests/atlas/atlas-status.test.ts && bun typecheck`
**Commit:** `feat(atlas): add atlas-status line renderer for terminal reports`

---

### Task 1.3: Chinese-content guard 检测器
**File:** `src/atlas/chinese-content-guard.ts`
**Test:** `tests/atlas/chinese-content-guard.test.ts`
**Depends:** none
**Domain:** general

设计要求节点名 / 正文 / summary 中文优先，但保留 frontmatter / wikilink / path / tool name / code symbol 等机器语法。我决定实现为一个 pure inspector：输入是 atlas markdown 节点的原文，输出是 `{ ok: boolean; offenders: readonly Offender[] }`。守卫只检测 prose 行（H1 后正文、H2 段标题下首句、无序列表行首句），跳过 frontmatter / fenced code / wikilink-only / inline-code-only 行。Offender 是 hint，不阻塞写入；由 atlas-translator / atlas-compiler 在 reconcile 阶段消费。

判断"是否中文优先"：把 prose 行去除 fenced code / inline code / wikilink / inline path / 已知 tool 与 command name 后，剩余文本中 CJK 统一表意文字（U+4E00–U+9FFF）字符占比 ≥ 30%。低于阈值且剩余文本长度 ≥ 20 字符则记为 offender。阈值与最小长度由 R6 风险驱动，不强检；testing 直接断言阈值常量。

```typescript
// tests/atlas/chinese-content-guard.test.ts
import { describe, expect, it } from "bun:test";
import { inspectAtlasNode, MIN_PROSE_LENGTH, CJK_RATIO_THRESHOLD } from "@/atlas/chinese-content-guard";

describe("inspectAtlasNode", () => {
  it("passes a Chinese-first node", () => {
    const md = [
      "---",
      "tags: [atlas, impl]",
      "---",
      "# 插件组合",
      "",
      "src/index.ts 是 micode OpenCode plugin 的组合入口，负责装配 agents、hooks、tools。",
      "",
      "## Sources",
      "- code:src/index.ts",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
    expect(result.offenders).toEqual([]);
  });

  it("flags an English-only prose line", () => {
    const md = [
      "# Plugin Composition",
      "",
      "This module composes the entire micode plugin from agents and hooks at startup.",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(false);
    expect(result.offenders.length).toBe(1);
    expect(result.offenders[0].line).toContain("This module composes");
  });

  it("ignores frontmatter, fenced code, and wikilink-only lines", () => {
    const md = [
      "---",
      "tags: [atlas]",
      "id: plugin-composition",
      "---",
      "# 插件组合",
      "",
      "插件组合负责装配。",
      "",
      "[[10-impl/agent-registry]]",
      "",
      "\`\`\`ts",
      "export const x = 1;",
      "\`\`\`",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
  });

  it("does not flag short prose below MIN_PROSE_LENGTH", () => {
    const md = ["# 标题", "", "ok"].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
  });

  it("reports the offending line content and 1-based line number", () => {
    const md = [
      "# 标题",
      "",
      "中文段落。",
      "",
      "This is a long English-only paragraph that clearly fails the Chinese-first rule.",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(false);
    expect(result.offenders[0].lineNumber).toBe(5);
  });

  it("exposes the threshold constants for downstream tuning", () => {
    expect(MIN_PROSE_LENGTH).toBeGreaterThanOrEqual(20);
    expect(CJK_RATIO_THRESHOLD).toBeGreaterThanOrEqual(0.3);
    expect(CJK_RATIO_THRESHOLD).toBeLessThanOrEqual(0.5);
  });
});
```

```typescript
// src/atlas/chinese-content-guard.ts
/**
 * Chinese-content guard for atlas nodes.
 *
 * Inspects atlas markdown prose for "Chinese-first" compliance. This is a hint
 * generator: it returns offenders for downstream tools (atlas-translator,
 * atlas-compiler) to surface; it never blocks writes itself. See R6 in plan.
 *
 * Machine syntax is intentionally exempt: frontmatter, fenced code, inline
 * code, wikilinks, file paths, and well-known tool/command names are stripped
 * before the CJK-ratio check.
 */

export const MIN_PROSE_LENGTH = 20;
export const CJK_RATIO_THRESHOLD = 0.3;

const CJK_REGEX = /[\u4E00-\u9FFF]/gu;
const FRONTMATTER_DELIM = "---";

export interface Offender {
  readonly lineNumber: number;
  readonly line: string;
  readonly cjkRatio: number;
}

export interface InspectResult {
  readonly ok: boolean;
  readonly offenders: readonly Offender[];
}

const stripMachineSyntax = (line: string): string =>
  line
    .replace(/\\[\\[[^\\]]+\\]\\]/gu, "") // wikilinks
    .replace(/\`[^\`]+\`/gu, "")          // inline code
    .replace(/\\b[a-zA-Z_][a-zA-Z0-9_./-]*\\.[a-zA-Z]{1,5}\\b/gu, "") // file paths
    .replace(/\\/[a-z][a-z0-9-]*/gu, "")  // slash commands
    .replace(/\\b[a-z][a-z0-9_]*_[a-z0-9_]+\\b/gu, ""); // snake_case tool names

const cjkRatio = (text: string): number => {
  const stripped = text.replace(/\\s+/gu, "");
  if (stripped.length === 0) return 1;
  const matches = stripped.match(CJK_REGEX);
  return (matches?.length ?? 0) / stripped.length;
};

const isProseLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith("#")) return false;
  if (trimmed.startsWith("```")) return false;
  if (trimmed.startsWith(">")) return false;
  if (/^[-*+]\\s/u.test(trimmed) === false && /^\\d+\\.\\s/u.test(trimmed) === false && trimmed.startsWith("[[")) return false;
  return true;
};

export function inspectAtlasNode(markdown: string): InspectResult {
  const lines = markdown.split("\n");
  let inFrontmatter = false;
  let inFence = false;
  const offenders: Offender[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (i === 0 && trimmed === FRONTMATTER_DELIM) {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === FRONTMATTER_DELIM) inFrontmatter = false;
      continue;
    }
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!isProseLine(raw)) continue;

    const stripped = stripMachineSyntax(trimmed);
    if (stripped.length < MIN_PROSE_LENGTH) continue;

    const ratio = cjkRatio(stripped);
    if (ratio < CJK_RATIO_THRESHOLD) {
      offenders.push({ lineNumber: i + 1, line: raw, cjkRatio: ratio });
    }
  }

  return { ok: offenders.length === 0, offenders };
}
```

**Verify:** `bun test tests/atlas/chinese-content-guard.test.ts && bun typecheck`
**Commit:** `feat(atlas): add chinese-content-guard inspector for atlas prose`

---

### Task 1.4: Atlas delta 路径与模板助手
**File:** `src/atlas/atlas-delta.ts`
**Test:** `tests/atlas/atlas-delta.test.ts`
**Depends:** none
**Domain:** general

设计要求 agent 把 delta 写到 `thoughts/shared/atlas-deltas/YYYY-MM-DD-{topic}-delta.md`，并通过 `lifecycle_log_artifact(kind=delta, pointer=<path>)` 注册。我决定实现两个 pure helper：`buildAtlasDeltaPath(date, topic)` 与 `renderAtlasDeltaTemplate(input)`。

模板包含 frontmatter（date / topic / source-issue / status）+ 中文章节（目标层 / Claims / Sources / Impact / Stale-or-Uncertain Notes）。frontmatter key 与 target-layer 标识保持英文（machine syntax）；正文中文。

```typescript
// tests/atlas/atlas-delta.test.ts
import { describe, expect, it } from "bun:test";
import { buildAtlasDeltaPath, renderAtlasDeltaTemplate } from "@/atlas/atlas-delta";

describe("buildAtlasDeltaPath", () => {
  it("composes the canonical path", () => {
    expect(buildAtlasDeltaPath("2026-05-10", "atlas-shared-mental-model"))
      .toBe("thoughts/shared/atlas-deltas/2026-05-10-atlas-shared-mental-model-delta.md");
  });

  it("rejects topic with whitespace", () => {
    expect(() => buildAtlasDeltaPath("2026-05-10", "atlas shared")).toThrow(/whitespace/u);
  });

  it("rejects date that is not ISO YYYY-MM-DD", () => {
    expect(() => buildAtlasDeltaPath("2026/5/10", "x")).toThrow(/date/u);
  });
});

describe("renderAtlasDeltaTemplate", () => {
  it("renders frontmatter + Chinese sections", () => {
    const md = renderAtlasDeltaTemplate({
      date: "2026-05-10",
      topic: "atlas-shared-mental-model",
      sourceIssue: 60,
      claims: [
        { targetLayer: "10-impl", claim: "atlas 是共享心智模型层", sources: ["thoughts:shared/designs/2026-05-10-atlas-shared-mental-model-design.md"] },
      ],
      impact: "影响 brainstormer / planner / executor / reviewer 等 6 个 agent prompt 与 atlas 自动注入 hook。",
      staleOrUncertain: [],
    });
    expect(md).toContain("date: 2026-05-10");
    expect(md).toContain("source-issue: 60");
    expect(md).toContain("status: draft");
    expect(md).toContain("## Claims");
    expect(md).toContain("**Target:** 10-impl");
    expect(md).toContain("atlas 是共享心智模型层");
    expect(md).toContain("thoughts:shared/designs/2026-05-10-atlas-shared-mental-model-design.md");
    expect(md).toContain("## Impact");
  });

  it("includes the Stale-or-Uncertain section when entries exist", () => {
    const md = renderAtlasDeltaTemplate({
      date: "2026-05-10",
      topic: "x",
      sourceIssue: 60,
      claims: [{ targetLayer: "20-behavior", claim: "c", sources: ["lifecycle:60"] }],
      impact: "i",
      staleOrUncertain: [{ node: "10-impl/foo.md", note: "claim 与现状冲突", evidence: "code:src/foo.ts" }],
    });
    expect(md).toContain("## Stale or Uncertain");
    expect(md).toContain("10-impl/foo.md");
    expect(md).toContain("claim 与现状冲突");
  });
});
```

```typescript
// src/atlas/atlas-delta.ts
/**
 * Atlas delta artifact helpers.
 *
 * Atlas deltas are written by primary agents to thoughts/shared/atlas-deltas/
 * and registered as lifecycle artifacts (kind=delta) so atlas-compiler can
 * later merge them. This module is a pure path/string builder; it does not
 * read or write the filesystem.
 */

const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/u;

export type AtlasDeltaLayer = "10-impl" | "20-behavior" | "30-context" | "40-decisions" | "50-risks" | "60-timeline";

export interface AtlasDeltaClaim {
  readonly targetLayer: AtlasDeltaLayer;
  readonly claim: string;
  readonly sources: readonly string[];
}

export interface AtlasDeltaStaleEntry {
  readonly node: string;
  readonly note: string;
  readonly evidence: string;
}

export interface AtlasDeltaInput {
  readonly date: string;
  readonly topic: string;
  readonly sourceIssue: number;
  readonly claims: readonly AtlasDeltaClaim[];
  readonly impact: string;
  readonly staleOrUncertain: readonly AtlasDeltaStaleEntry[];
}

export function buildAtlasDeltaPath(date: string, topic: string): string {
  if (!DATE_RE.test(date)) throw new Error(\`invalid date: \${date}\`);
  if (/\\s/u.test(topic)) throw new Error(\`topic contains whitespace: \${topic}\`);
  return \`thoughts/shared/atlas-deltas/\${date}-\${topic}-delta.md\`;
}

const renderClaim = (c: AtlasDeltaClaim): string =>
  [
    \`### \${c.targetLayer}\`,
    "",
    \`**Target:** \${c.targetLayer}\`,
    "",
    c.claim,
    "",
    "**Sources:**",
    ...c.sources.map((s) => \`- \${s}\`),
  ].join("\\n");

const renderStaleSection = (entries: readonly AtlasDeltaStaleEntry[]): string => {
  if (entries.length === 0) return "";
  const lines = ["## Stale or Uncertain", ""];
  for (const e of entries) {
    lines.push(\`- **\${e.node}** — \${e.note}\`);
    lines.push(\`  - 证据: \${e.evidence}\`);
  }
  lines.push("");
  return lines.join("\\n");
};

export function renderAtlasDeltaTemplate(input: AtlasDeltaInput): string {
  const frontmatter = [
    "---",
    \`date: \${input.date}\`,
    \`topic: "\${input.topic}"\`,
    \`source-issue: \${input.sourceIssue}\`,
    "status: draft",
    "---",
    "",
  ].join("\\n");

  const claimsBlock = input.claims.length === 0 ? "_(no claims)_" : input.claims.map(renderClaim).join("\\n\\n");
  const stale = renderStaleSection(input.staleOrUncertain);

  return [
    frontmatter,
    \`# Atlas Delta — \${input.topic}\`,
    "",
    "本 delta 由 primary agent 在 issue/" + input.sourceIssue + " 工作过程中产出，用于通知 atlas-compiler 归并。",
    "",
    "## Claims",
    "",
    claimsBlock,
    "",
    "## Impact",
    "",
    input.impact,
    "",
    stale,
  ].join("\\n").replace(/\\n{3,}/gu, "\\n\\n");
}
```

**Verify:** `bun test tests/atlas/atlas-delta.test.ts && bun typecheck`
**Commit:** `feat(atlas): add atlas-delta path and template helpers`

---

### Task 1.5: 把 atlas-compiler / atlas-worker-* / finish-spawn 文档化为 user-triggered-only
**File:** `src/atlas/finish-spawn.ts`
**Test:** none（纯 doc-comment + 字符串重写；行为不变；现有 `tests/atlas/finish-spawn.test.ts` 已覆盖行为，必须继续通过）
**Depends:** none
**Domain:** general

设计要求 lifecycle 不再 own Atlas 更新触发。我决定保留 `shouldSpawnAgent2` / `buildHandoffFromLifecycle` / `buildSpawnReceipt` 这些 helper（删除会破坏 14+ 测试且后续 `/atlas-refresh` 扩展可复用），但在文件顶部加 deprecation-style doc：标注它们仅在用户显式触发 atlas-compiler 时使用，禁止被 lifecycle finish 自动调用。同时 `shouldSpawnAgent2` 函数本身保留但加内联 JSDoc 说明 caller 必须是用户显式入口。

```typescript
// src/atlas/finish-spawn.ts (顶部新增 doc 块；现有 export 不变)
/**
 * Atlas-compiler spawn helpers.
 *
 * These helpers are USER-TRIGGERED ONLY. They are NOT invoked by
 * lifecycle_finish or any other lifecycle-owned event. The earlier design
 * sketched a "lifecycle finish auto-spawns atlas-compiler" path; that path
 * was never wired and is now explicitly forbidden. See the
 * "Atlas Shared Mental Model Maintenance" design (2026-05-10) and AGENTS.md.
 *
 * Valid callers:
 *   - /atlas-refresh slash command (user-typed)
 *   - explicit user request to run atlas-compiler against an existing
 *     thoughts/shared/atlas-deltas/*.md file
 *
 * Forbidden callers:
 *   - src/lifecycle/runner.ts
 *   - src/lifecycle/transitions.ts
 *   - src/tools/lifecycle/*
 *   - any hook invoked from chat.params / event.tool / event.message
 *
 * The grep-based lifecycle boundary test (Batch 4) enforces this rule.
 */

import { ATLAS_SPAWN_OUTCOMES, type AtlasHandoff, type AtlasSpawnReceipt } from "./types";

export interface SpawnGate {
  readonly quickMode: boolean;
  readonly terminal: boolean;
}

/**
 * @deprecated for use as a lifecycle-finish gate. Retained for user-triggered
 * /atlas-refresh and manual atlas-compiler runs only. See module doc above.
 */
export function shouldSpawnAgent2(gate: SpawnGate): boolean {
  return gate.terminal && !gate.quickMode;
}

// ... rest of file unchanged ...
```

**Verify:** `bun test tests/atlas/finish-spawn.test.ts`（行为测试必须仍然 PASS）和 `bun typecheck`
**Commit:** `docs(atlas): mark finish-spawn helpers as user-triggered-only`

---

### Task 1.6: AGENTS.md 镜像段落（人类可读单源）
**File:** `AGENTS.md`
**Test:** none（文档变更；drift-guard 由 4.1 与 4.4 覆盖）
**Depends:** none
**Domain:** general

在 AGENTS.md 中追加 `## Atlas Shared Mental Model` 段落，按现有 "Effect-First User-Facing Reports" 镜像写法描述协议四步、status 取值、lifecycle 边界、以及指向 `src/agents/atlas-mental-model.ts` 的单源声明。

```markdown
## Atlas Shared Mental Model

Project Atlas (`atlas/`) 是人和 AI 共享的项目心智模型。任何想要全局理解 micode 的人或 agent，最该先读 Atlas。Atlas 不是 AI 私有缓存、代码索引或 lifecycle 副作用。

完整 prompt 协议块在 `src/agents/atlas-mental-model.ts` 导出的 `ATLAS_MENTAL_MODEL_PROTOCOL` 字符串中，brainstormer / planner / executor / reviewer / commander / octto 通过模板字面量统一注入。本节是 markdown 镜像，不复制完整协议文本，避免与 prompt 单源 drift（drift-guard 由 `tests/agents/atlas-mental-model.test.ts` 与 `tests/agents/atlas-protocol-injection.test.ts` 强制）。

### 协议四步

1. **Consult**：非平凡任务开始时读取 atlas-context（自动注入）和按需 `atlas_lookup`，优先关注 `00-index`、`10-impl`、`20-behavior`、`40-decisions`、`50-risks`。
2. **Detect**：发现代码 / 行为 / 决策与 Atlas 节点冲突时，证据充分标记 `stale-detected`，证据不足标记 `cannot-assess`，禁止静默覆盖。
3. **Propose**：任务结束前判断"是否改变高级工程师解释项目的方式"。改变 → 写 `thoughts/shared/atlas-deltas/YYYY-MM-DD-{topic}-delta.md` 并 `lifecycle_log_artifact(kind=delta, pointer=<path>)`；不变 → status=`no-change`。
4. **Merge**：delta 由用户显式触发的 `atlas-compiler` 或 `/atlas-refresh` 走 staging → reconcile → atomic-rename 归并。Lifecycle 不自动调用 atlas-compiler。

### 状态取值

终态 "实现记录" 段必须包含一行 `Atlas status: <value>`，取值之一：`consulted` / `no-change` / `delta-created` / `stale-detected` / `blocked` / `cannot-assess`。

### Lifecycle 边界

Lifecycle 是 source provider only。`lifecycle_finish`、`lifecycle_commit` 与任何 hook 都不允许自动 spawn `atlas-compiler` 或写 Atlas vault。`src/atlas/finish-spawn.ts`、`src/atlas/spawn-receipt-marker.ts`、`src/atlas/handoff-marker.ts` 与 `atlas-compiler` / `atlas-worker-*` agent 均为 user-triggered-only，由 `/atlas-refresh` 或人工指令触发；grep-based boundary 测试见 `tests/lifecycle/atlas-boundary.test.ts`。

### 中文优先

节点名 / H1 / H2 / 正文 / summary / behavior / rationale / risk 中文优先。机器语法保留英文：frontmatter keys、IDs、wikilink syntax、file paths、tool names、command names、source pointers、test names、code symbols、fenced code 内容。Chinese-content guard 由 `src/atlas/chinese-content-guard.ts` 提供，是 hint，不阻塞写入。

### Drift guard

`src/agents/atlas-mental-model.ts` 是协议唯一权威来源；本节是 markdown 镜像，命名和段落顺序需保持一致。
```

**Verify:** `git diff AGENTS.md` 确认追加位置在 "Effect-First User-Facing Reports" 之后，无意外修改。
**Commit:** `docs(agents): mirror atlas mental model protocol in AGENTS.md`

---

## Batch 2: Agent Prompt Wiring (parallel — 6 implementers)

All tasks in this batch depend on Batch 1.1-1.4 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

### Task 2.1: brainstormer.ts 注入 atlas-mental-model 协议块
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

在 `brainstormer.ts` 的 prompt 模板字面量中注入 `${ATLAS_MENTAL_MODEL_PROTOCOL}`，位置：`<effect-first-reporting>` 块之后、`<output-format>` 之前。理由：consult 协议要在用户终态汇报与设计文档落盘之前生效，但要在 process / phases 之后，让 brainstormer 把 Atlas status 自然写进 effect-first 汇报第四段。

```typescript
// tests/agents/brainstormer-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("brainstormer prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(brainstormerAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("places the protocol block after effect-first-reporting and before output-format", () => {
    const p = brainstormerAgent.prompt ?? "";
    const effectFirstIdx = p.indexOf("</effect-first-reporting>");
    const protocolIdx = p.indexOf("<atlas-mental-model");
    const outputFormatIdx = p.indexOf("<output-format");
    expect(effectFirstIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBeGreaterThan(effectFirstIdx);
    expect(outputFormatIdx).toBeGreaterThan(protocolIdx);
  });

  it("does not duplicate the protocol block", () => {
    const p = brainstormerAgent.prompt ?? "";
    const matches = p.match(/<atlas-mental-model/gu) ?? [];
    expect(matches.length).toBe(1);
  });
});
```

**Implementation steps（无需粘贴整文件）：**
1. 在 `brainstormer.ts` 顶部 import：`import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";`
2. 在 prompt 模板字面量中，紧接 `</effect-first-reporting>` 之后插入一个空行 + `${ATLAS_MENTAL_MODEL_PROTOCOL}` + 空行。
3. 不修改任何其它内容；prompt 其余部分保持现状。

**Verify:** `bun test tests/agents/brainstormer-atlas-protocol.test.ts && bun test tests/agents/brainstormer.test.ts`
**Commit:** `feat(brainstormer): inject atlas-mental-model protocol into prompt`

---

### Task 2.2: planner.ts 注入 atlas-mental-model 块 + 新 task 字段约定
**File:** `src/agents/planner.ts`
**Test:** `tests/agents/planner-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

在 planner prompt 中除了注入协议块（紧接 `<project-memory>` 块之后、`<process>` 之前），还需新增 task 字段建议：每个 task 在 `**Domain:**` 之后可选地追加 `**Atlas-impact:** none | layer-update | new-node`，方便 executor / reviewer 在 task 级判断是否需要 propose delta。这是 prompt 文本扩展，不改 plan schema 验证（保持向后兼容）。

```typescript
// tests/agents/planner-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { plannerAgent } from "@/agents/planner";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("planner prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(plannerAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("places the protocol block after project-memory and before process", () => {
    const p = plannerAgent.prompt ?? "";
    const memIdx = p.indexOf("</project-memory>");
    const protocolIdx = p.indexOf("<atlas-mental-model");
    const processIdx = p.indexOf("<process>");
    expect(memIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBeGreaterThan(memIdx);
    expect(processIdx).toBeGreaterThan(protocolIdx);
  });

  it("documents the optional Atlas-impact task field", () => {
    expect(plannerAgent.prompt).toContain("Atlas-impact");
    expect(plannerAgent.prompt).toContain("layer-update");
    expect(plannerAgent.prompt).toContain("new-node");
  });

  it("does not duplicate the protocol block", () => {
    const p = plannerAgent.prompt ?? "";
    const matches = p.match(/<atlas-mental-model/gu) ?? [];
    expect(matches.length).toBe(1);
  });
});
```

**Implementation steps：**
1. 顶部 import `ATLAS_MENTAL_MODEL_PROTOCOL`。
2. 在 prompt 中 `</project-memory>` 之后插入 `${ATLAS_MENTAL_MODEL_PROTOCOL}`。
3. 在 `<task-node-format>` 区块中，把当前 `**Domain:**` 行后面追加一行可选字段说明：
   ```
   **Atlas-impact:** none | layer-update | new-node (optional; defaults to none if omitted)
   ```
4. 在 `<principles>` 中追加一条：`<principle name="atlas-aware">Tasks that touch agent prompts, lifecycle behaviour, atlas vault, or workflow contracts SHOULD set **Atlas-impact** explicitly. Default none.</principle>`

**Verify:** `bun test tests/agents/planner-atlas-protocol.test.ts && bun test tests/agents/planner.test.ts`
**Commit:** `feat(planner): inject atlas-mental-model protocol and Atlas-impact field`

---

### Task 2.3: executor.ts 注入精简 atlas-mental-model 子集
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

executor 不直接产 delta（它协调 implementer / reviewer），但需要：(a) 把 atlas excerpt 透传给 implementer 当 task 涉及边界 / 行为 / 决策；(b) 收集 reviewer 在循环中报告的 stale-detected，汇总到终态报告。我决定仍然注入完整 `${ATLAS_MENTAL_MODEL_PROTOCOL}`（保持单源），位置：`<contract-propagation>` 块之后；同时新增一个 executor-specific 的 `<atlas-propagation>` 块说明何时把 atlas excerpt 拼进 spawn prompt。

```typescript
// tests/agents/executor-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { executorAgent } from "@/agents/executor";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("executor prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(executorAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("appends an executor-specific atlas-propagation block", () => {
    const p = executorAgent.prompt ?? "";
    expect(p).toContain("<atlas-propagation");
    // executor must not grant atlas_lookup to leaf agents
    expect(p).toContain("atlas_lookup");
    expect(p).toContain("leaf agents");
  });

  it("places protocol after contract-propagation", () => {
    const p = executorAgent.prompt ?? "";
    const cpIdx = p.indexOf("</contract-propagation>");
    const protocolIdx = p.indexOf("<atlas-mental-model");
    expect(cpIdx).toBeGreaterThan(0);
    expect(protocolIdx).toBeGreaterThan(cpIdx);
  });
});
```

**Implementation steps：**
1. import `ATLAS_MENTAL_MODEL_PROTOCOL`。
2. 在 prompt 中 `</contract-propagation>` 之后注入 `${ATLAS_MENTAL_MODEL_PROTOCOL}`。
3. 紧跟一个 executor-specific 静态块（不进 protocol 单源，因 executor 行为特殊）：
   ```
   <atlas-propagation priority="high">
   <rule>Leaf agents (implementer-*, reviewer) do NOT have access to the atlas_lookup tool. They receive atlas excerpts only when you (executor) decide a task touches module boundaries, user-visible behaviour, decisions, or risks.</rule>
   <rule>When a plan task has **Atlas-impact:** layer-update or new-node, append a ≤500-char excerpt from atlas-context to the implementer spawn prompt. The excerpt MUST be a verbatim slice; do not paraphrase.</rule>
   <rule>When implementer/reviewer reports back with a stale-detected observation, surface it in your terminal report under "Atlas observations". Do NOT auto-write a delta.</rule>
   <rule>Atlas delta proposal is the responsibility of the primary agent that called you (brainstormer / planner / commander), not yours.</rule>
   </atlas-propagation>
   ```

**Verify:** `bun test tests/agents/executor-atlas-protocol.test.ts && bun test tests/agents/executor.test.ts && bun test tests/agents/executor-prompt.test.ts`
**Commit:** `feat(executor): inject atlas protocol and propagation rules`

---

### Task 2.4: reviewer.ts 注入 detect-only 子集
**File:** `src/agents/reviewer.ts`
**Test:** `tests/agents/reviewer-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

reviewer 是 leaf agent，不写 delta、不调 atlas_lookup（受 executor 传入的 excerpt 约束）。仍然需要让 reviewer 知道协议存在、能识别 stale 模式并把它报告给 executor。我决定仍然注入完整协议块（保持单源），并紧跟一个 reviewer-specific `<atlas-detect-role>` 块说明只做 detect。

```typescript
// tests/agents/reviewer-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { reviewerAgent } from "@/agents/reviewer";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("reviewer prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(reviewerAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("appends a reviewer-specific detect-only block", () => {
    const p = reviewerAgent.prompt ?? "";
    expect(p).toContain("<atlas-detect-role");
    expect(p).toContain("do NOT write atlas deltas");
  });
});
```

**Implementation steps：**
1. import `ATLAS_MENTAL_MODEL_PROTOCOL`。
2. 注入位置：现有 `<process>` 之前。
3. 紧跟：
   ```
   <atlas-detect-role priority="medium">
   <rule>You are a leaf agent. You do NOT write atlas deltas, do NOT call atlas_lookup, do NOT modify atlas/ vault.</rule>
   <rule>If you detect a contradiction between atlas-context (or atlas excerpts in your spawn prompt) and the implementation under review, include a one-line "Atlas observation: stale-detected — <node> — <reason>" in your reviewer report so executor can surface it.</rule>
   <rule>If atlas-context is missing or empty, do not block the review; this is informational only.</rule>
   </atlas-detect-role>
   ```

**Verify:** `bun test tests/agents/reviewer-atlas-protocol.test.ts && bun test tests/agents/reviewer-prompt.test.ts`
**Commit:** `feat(reviewer): inject atlas protocol and detect-only role block`

---

### Task 2.5: commander.ts 注入 consult-only 子集 + 镜像 dispatch 描述
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

commander 是 triage / 路由 agent，多数 quick-op 不需要 delta，但仍然要遵守协议（避免静默忽略 atlas）。我决定注入完整协议块以保持单源，并新增一段 commander-specific 说明：在 quick-op 路径下默认 status=no-change（除非显式触发了改 prompt / agent / lifecycle 的工作）。

```typescript
// tests/agents/commander-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { commanderAgent } from "@/agents/commander";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("commander prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(commanderAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("documents quick-op default of no-change", () => {
    const p = commanderAgent.prompt ?? "";
    expect(p).toContain("quick-op");
    expect(p).toContain("no-change");
  });
});
```

**Implementation steps：**
1. import `ATLAS_MENTAL_MODEL_PROTOCOL`。
2. 注入位置：现有 effect-first reporting 块之后（与 brainstormer 镜像）。
3. 紧跟 commander-specific：
   ```
   <atlas-commander-rule priority="low">
   <rule>For quick-op routes (lookup / status / single-line patch / version bump), the default Atlas status is no-change. Do not consult atlas_lookup unless the request actually touches modules, behaviour, decisions, or risks.</rule>
   <rule>For routes that delegate to brainstormer / planner / executor, atlas consultation is owned by the delegated agent; commander only relays the eventual Atlas status into its terminal user-facing summary.</rule>
   </atlas-commander-rule>
   ```

**Verify:** `bun test tests/agents/commander-atlas-protocol.test.ts && bun test tests/agents/commander.test.ts && bun test tests/agents/commander-quick-op.test.ts`
**Commit:** `feat(commander): inject atlas protocol with quick-op no-change default`

---

### Task 2.6: octto.ts 注入 brainstormer-equivalent 中文协议
**File:** `src/agents/octto.ts`
**Test:** `tests/agents/octto-atlas-protocol.test.ts`
**Depends:** 1.1
**Domain:** general

octto 与 brainstormer 是同层 primary，但 octto prompt 使用语义对齐而非 byte-identical 的中文 effect-first（参考 AGENTS.md 现有规则）。我决定同样注入完整 `${ATLAS_MENTAL_MODEL_PROTOCOL}`（协议本身已经是中文优先的，无需另写中文版），位置：octto effect-first 类似块之后。drift-guard 仅断言注入存在，不强制位置 byte-identical。

```typescript
// tests/agents/octto-atlas-protocol.test.ts
import { describe, expect, it } from "bun:test";
import { octtoAgent } from "@/agents/octto";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";

describe("octto prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(octtoAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("does not duplicate the protocol block", () => {
    const p = octtoAgent.prompt ?? "";
    const matches = p.match(/<atlas-mental-model/gu) ?? [];
    expect(matches.length).toBe(1);
  });
});
```

**Implementation steps：**
1. import `ATLAS_MENTAL_MODEL_PROTOCOL`。
2. 注入位置：octto prompt 末尾的 output-format 之前；如 octto 没有 output-format 段则放在 prompt 末尾倒数第二段。
3. 不修改其它 octto 行为。

**Verify:** `bun test tests/agents/octto-atlas-protocol.test.ts && bun test tests/agents/octto-notify.test.ts`
**Commit:** `feat(octto): inject atlas-mental-model protocol`

---

## Batch 3: Hooks and Atlas Surface (parallel — 4 implementers)

All tasks in this batch depend on Batch 1.1, 1.2, 1.4 completing.
Tasks: 3.1, 3.2, 3.3, 3.4

### Task 3.1: atlas-auto-inject hook 扩展 — 追加 protocol header 行
**File:** `src/hooks/atlas-auto-inject.ts`
**Test:** `tests/hooks/atlas-auto-inject.test.ts`（新建；仓内目前没有 hook test 目录，需新建）
**Depends:** 1.1, 1.2
**Domain:** general

设计要求 brainstormer / planner 在 atlas-context 注入之外还能识别"协议正在生效"。我决定在 `wrapAtlasContext` 输出末尾追加一行 `Atlas mental model protocol: active. Report final status with renderAtlasStatusLine.` 这是 hook 层的轻量 marker，与 prompt 内 `${ATLAS_MENTAL_MODEL_PROTOCOL}` 互不冲突，目的是让 agent 即便协议块被未来某次 prompt 重构误删，也能从 hook header 得到提示。

```typescript
// tests/hooks/atlas-auto-inject.test.ts
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAtlasAutoInjectHook } from "@/hooks/atlas-auto-inject";

const writeMinimalVault = (root: string): void => {
  mkdirSync(join(root, "atlas"), { recursive: true });
  writeFileSync(
    join(root, "atlas", "00-index.md"),
    "---\ntags: [atlas, index]\n---\n# 索引\n\n这是一个最小 atlas vault 用于测试。\n",
  );
};

describe("createAtlasAutoInjectHook", () => {
  it("appends protocol-active marker after the atlas-context block for brainstormer", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-auto-inject-"));
    writeMinimalVault(root);
    const hook = createAtlasAutoInjectHook({ directory: root } as never);
    const out: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
    };
    await hook["chat.params"]({ sessionID: "s1" }, out);
    expect(out.system).toContain("<atlas-context>");
    expect(out.system).toContain("Atlas mental model protocol: active");
  });

  it("does not inject when agent is not brainstormer or planner", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-auto-inject-"));
    writeMinimalVault(root);
    const hook = createAtlasAutoInjectHook({ directory: root } as never);
    const out: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "executor" },
    };
    await hook["chat.params"]({ sessionID: "s2" }, out);
    expect(out.system).toBeUndefined();
  });
});
```

```typescript
// src/hooks/atlas-auto-inject.ts (modified wrapAtlasContext)
const ATLAS_PROTOCOL_FOOTER =
  "Atlas mental model protocol: active. Report final status with one of: " +
  "consulted | no-change | delta-created | stale-detected | blocked | cannot-assess.";

const wrapAtlasContext = (summary: string): string =>
  `<atlas-context>\n${ATLAS_CONTEXT_HEADER}\n\n${summary}\n\n${ATLAS_PROTOCOL_FOOTER}\n</atlas-context>`;
```

**Verify:** `bun test tests/hooks/atlas-auto-inject.test.ts && bun test tests/atlas/auto-inject.test.ts`
**Commit:** `feat(hooks): add atlas protocol footer to atlas-context block`

---

### Task 3.2: atlas-translator agent 引用 chinese-content-guard
**File:** `src/agents/atlas-translator.ts`
**Test:** `tests/agents/atlas-translator-guard-ref.test.ts`
**Depends:** 1.3
**Domain:** general

atlas-translator 已经存在并负责英文→中文批量翻译。我决定在它的 prompt `<reading-flow>` 或 `<constraints>` 段中追加一句明确的 reference："本 agent 在每次写入前可调用 `chinese-content-guard` (`src/atlas/chinese-content-guard.ts`) 的 `inspectAtlasNode` 复核，但 guard 仅产生 hint，不阻塞写入。" 这把 1.3 的检测器接入翻译流程，但保持 hint-only 语义（R6）。

```typescript
// tests/agents/atlas-translator-guard-ref.test.ts
import { describe, expect, it } from "bun:test";
import { atlasTranslatorAgent } from "@/agents/atlas-translator";

describe("atlas-translator references chinese-content-guard", () => {
  it("mentions inspectAtlasNode by name", () => {
    expect(atlasTranslatorAgent.prompt).toContain("inspectAtlasNode");
  });

  it("documents guard as hint-only, non-blocking", () => {
    expect(atlasTranslatorAgent.prompt).toContain("hint");
    expect(atlasTranslatorAgent.prompt).toContain("not block");
  });
});
```

**Implementation steps：** 在 `atlas-translator.ts` prompt 的 `<constraints>` 段尾部追加：
```
<rule>翻译前可调用 chinese-content-guard (src/atlas/chinese-content-guard.ts → inspectAtlasNode) 复核源文与译文。Guard 输出仅是 hint，不会阻塞写入；offender 应记录到 maintenance log 的 challenges 段。</rule>
```

**Verify:** `bun test tests/agents/atlas-translator-guard-ref.test.ts && bun test tests/agents/atlas-translator.test.ts`
**Commit:** `docs(atlas-translator): reference chinese-content-guard as hint-only`

---

### Task 3.3: src/tools/atlas/init.ts 字符串重写
**File:** `src/tools/atlas/init.ts`
**Test:** `tests/tools/atlas/init-reconcile-owner.test.ts`（新建）
**Depends:** none（独立字符串改动；放本批保持与其它 doc 改动一起）
**Domain:** general

目前 `RECONCILE_OWNER = "lifecycle-finish atlas-compiler owns reconcile"` 暗示 lifecycle 拥有 reconcile 触发权，与新设计冲突。我决定改写为 `"user-triggered atlas-compiler owns reconcile (run /atlas-refresh or invoke atlas-compiler manually)"`。

```typescript
// tests/tools/atlas/init-reconcile-owner.test.ts
import { describe, expect, it } from "bun:test";
import { runAtlasInit } from "@/tools/atlas/init";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runAtlasInit reconcile owner string", () => {
  it("reports user-triggered ownership in dry-run report (not lifecycle-finish)", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-init-"));
    mkdirSync(join(root, "atlas"));
    const result = await runAtlasInit({ projectRoot: root, mode: "reconcile", projectName: "x", projectType: "server" });
    expect(result.outcome).toBe("dry-run");
    expect(result.report).toContain("user-triggered");
    expect(result.report).not.toContain("lifecycle-finish");
  });
});
```

**Implementation steps：** 单行替换 `const RECONCILE_OWNER = "lifecycle-finish atlas-compiler owns reconcile";` → `const RECONCILE_OWNER = "user-triggered atlas-compiler owns reconcile (run /atlas-refresh or invoke atlas-compiler manually)";`

**Verify:** `bun test tests/tools/atlas/init-reconcile-owner.test.ts && bun test tests/tools/atlas/`（如果存在；如果整目录无测试，单独跑新增）
**Commit:** `fix(atlas-init): reword RECONCILE_OWNER as user-triggered`

---

### Task 3.4: finish-spawn / spawn-receipt-marker doc-comment
**File:** `src/atlas/spawn-receipt-marker.ts`
**Test:** none（doc-only，行为不变）
**Depends:** none（与 1.5 平行；1.5 改 `finish-spawn.ts`，本任务改 `spawn-receipt-marker.ts` 与 `handoff-marker.ts`）
**Domain:** general

与 1.5 同质：在 `src/atlas/spawn-receipt-marker.ts` 与 `src/atlas/handoff-marker.ts` 顶部追加同一段 doc：

```
/**
 * USER-TRIGGERED ONLY. These markers describe atlas-compiler spawn receipts /
 * lifecycle handoffs. They are NOT written or read by lifecycle_finish or any
 * lifecycle-owned event. Valid callers: /atlas-refresh, manual atlas-compiler
 * runs. See plan thoughts/shared/plans/2026-05-10-atlas-shared-mental-model.md
 * Batch 1.5 / 3.4 and the lifecycle boundary test in Batch 4.2.
 */
```

并在 `src/atlas/handoff-marker.ts` 同步加入相同 doc。

> 该任务仅触碰文件顶部 doc 注释，不动 export，行为测试 (`tests/atlas/spawn-receipt-marker.test.ts`、`tests/atlas/handoff-marker.test.ts`) 必须保持全绿。

**Verify:** `bun test tests/atlas/spawn-receipt-marker.test.ts && bun test tests/atlas/handoff-marker.test.ts && bun typecheck`
**Commit:** `docs(atlas): mark spawn-receipt-marker and handoff-marker as user-triggered-only`

---

## Batch 4: Drift Guards and Integration Tests (parallel — 4 implementers)

All tasks in this batch depend on Batch 2 and Batch 3 completing.
Tasks: 4.1, 4.2, 4.3, 4.4

### Task 4.1: atlas-mental-model drift-guard 综合测试
**File:** `tests/agents/atlas-protocol-injection.test.ts`
**Test:** 本任务即为 test 文件
**Depends:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Domain:** general

聚合断言：六个 agent prompt 都包含 `ATLAS_MENTAL_MODEL_PROTOCOL` 单源字符串。这是 R1 缓解：drift-guard 不强制整段 prompt byte-identical，只验证单源已被注入。

```typescript
// tests/agents/atlas-protocol-injection.test.ts
import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { brainstormerAgent } from "@/agents/brainstormer";
import { plannerAgent } from "@/agents/planner";
import { executorAgent } from "@/agents/executor";
import { reviewerAgent } from "@/agents/reviewer";
import { commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";

describe("atlas-mental-model protocol drift guard", () => {
  const cases: ReadonlyArray<readonly [string, { readonly prompt?: string }]> = [
    ["brainstormer", brainstormerAgent],
    ["planner", plannerAgent],
    ["executor", executorAgent],
    ["reviewer", reviewerAgent],
    ["commander", commanderAgent],
    ["octto", octtoAgent],
  ];

  for (const [name, agent] of cases) {
    it(`${name} injects ATLAS_MENTAL_MODEL_PROTOCOL exactly once`, () => {
      expect(agent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
      const matches = (agent.prompt ?? "").match(/<atlas-mental-model/gu) ?? [];
      expect(matches.length).toBe(1);
    });
  }

  it("ATLAS_MENTAL_MODEL_PROTOCOL itself contains all required status values", () => {
    const required = ["consulted", "no-change", "delta-created", "stale-detected", "blocked", "cannot-assess"];
    for (const v of required) {
      expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain(v);
    }
  });
});
```

**Verify:** `bun test tests/agents/atlas-protocol-injection.test.ts`
**Commit:** `test(agents): add atlas protocol drift guard for all six prompts`

---

### Task 4.2: lifecycle boundary 测试 — 静态 grep 断言
**File:** `tests/lifecycle/atlas-boundary.test.ts`
**Test:** 本任务即为 test 文件
**Depends:** 1.5, 3.3, 3.4
**Domain:** general

设计硬规则：lifecycle 不调 atlas-compiler / finish-spawn / handoff-marker / spawn-receipt-marker。本测试用文件级 grep 静态断言：`src/lifecycle/**/*.ts` 与 `src/tools/lifecycle/**/*.ts` 中不出现指向这些模块的 import 或 string reference。

```typescript
// tests/lifecycle/atlas-boundary.test.ts
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_PATTERNS = [
  /from\\s+["']@\\/atlas\\/finish-spawn["']/u,
  /from\\s+["']@\\/atlas\\/spawn-receipt-marker["']/u,
  /from\\s+["']@\\/atlas\\/handoff-marker["']/u,
  /from\\s+["']@\\/agents\\/atlas-compiler["']/u,
  /shouldSpawnAgent2\\s*\\(/u,
  /buildHandoffFromLifecycle\\s*\\(/u,
  /buildSpawnReceipt\\s*\\(/u,
  /atlasCompilerAgent/u,
];

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"];

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

describe("lifecycle does not depend on atlas auto-spawn plumbing", () => {
  for (const dir of SCAN_DIRS) {
    it(`${dir} is free of atlas-compiler / finish-spawn references`, () => {
      const files: string[] = [];
      walk(dir, files);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, "utf8");
        for (const pat of FORBIDDEN_PATTERNS) {
          expect({ file: f, matched: pat.toString(), hit: pat.test(src) }).toEqual({
            file: f,
            matched: pat.toString(),
            hit: false,
          });
        }
      }
    });
  }

  it("RECONCILE_OWNER no longer says lifecycle-finish", () => {
    const src = readFileSync("src/tools/atlas/init.ts", "utf8");
    expect(src).not.toContain("lifecycle-finish atlas-compiler owns reconcile");
    expect(src).toContain("user-triggered atlas-compiler owns reconcile");
  });
});
```

**Verify:** `bun test tests/lifecycle/atlas-boundary.test.ts`
**Commit:** `test(lifecycle): assert lifecycle has no atlas auto-spawn dependency`

---

### Task 4.3: chinese-content-guard prompt-string 集成测试
**File:** `tests/agents/atlas-protocol-chinese-guard.test.ts`
**Test:** 本任务即为 test 文件
**Depends:** 1.1, 2.1, 2.2
**Domain:** general

确认协议块内的中文优先 + machine syntax 白名单内容真正在 brainstormer / planner prompt 中可被 LLM 看到（防止未来重构误删 `<chinese-content-guard>` 子段）。

```typescript
// tests/agents/atlas-protocol-chinese-guard.test.ts
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { plannerAgent } from "@/agents/planner";

describe("atlas chinese-content-guard reach", () => {
  const checks = ["中文优先", "frontmatter", "wikilink", "file paths", "tool names", "code symbols"];

  it("brainstormer prompt contains all chinese-guard keywords", () => {
    for (const key of checks) {
      expect(brainstormerAgent.prompt).toContain(key);
    }
  });

  it("planner prompt contains all chinese-guard keywords", () => {
    for (const key of checks) {
      expect(plannerAgent.prompt).toContain(key);
    }
  });
});
```

**Verify:** `bun test tests/agents/atlas-protocol-chinese-guard.test.ts`
**Commit:** `test(agents): assert chinese-content-guard reach in brainstormer and planner`

---

### Task 4.4: effect-first 与 atlas-status 兼容性测试
**File:** `tests/agents/atlas-status-effect-first.test.ts`
**Test:** 本任务即为 test 文件
**Depends:** 1.1, 1.2, 2.1, 2.5, 2.6
**Domain:** general

确认 `<effect-first-reporting>` 与 `<atlas-mental-model>` 协议在 brainstormer / commander / octto 中并存且不冲突；并断言 `renderAtlasStatusLine` 输出的格式与协议中 status-reporting 段对得上（避免未来 status enum 漂移）。

```typescript
// tests/agents/atlas-status-effect-first.test.ts
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { octtoAgent } from "@/agents/octto";
import { ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";
import { renderAtlasStatusLine } from "@/atlas/atlas-status";

describe("effect-first + atlas-status coexistence", () => {
  for (const [name, agent] of [
    ["brainstormer", brainstormerAgent] as const,
    ["commander", commanderAgent] as const,
    ["octto", octtoAgent] as const,
  ]) {
    it(`${name} carries both effect-first and atlas-mental-model blocks`, () => {
      const p = agent.prompt ?? "";
      // brainstormer + commander 强制中文 effect-first；octto 语义对齐
      const hasEffectFirst = p.includes("effect-first-reporting") || p.includes("预期表现");
      expect(hasEffectFirst).toBe(true);
      expect(p).toContain("<atlas-mental-model");
    });
  }

  it("renderAtlasStatusLine emits values from ATLAS_STATUS_VALUES", () => {
    for (const v of ATLAS_STATUS_VALUES) {
      expect(renderAtlasStatusLine(v)).toBe(`Atlas status: ${v}`);
    }
  });
});
```

**Verify:** `bun test tests/agents/atlas-status-effect-first.test.ts && bun test`（全量回归）&& `bun typecheck && bun run build && bun lint`
**Commit:** `test(agents): assert effect-first and atlas-status coexistence`

---

## Risks and Mitigations

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | drift-guard 把 6 份 prompt 锁成 byte-identical 后，未来修改任意一份都需要同步更新六处 | High | Med | 单源 export 字符串 (`ATLAS_MENTAL_MODEL_PROTOCOL`) 由 `src/agents/atlas-mental-model.ts` 提供，agent prompts 用模板字面量 `${...}` 注入；drift-guard 测试只断言注入存在，不强制 byte-identical 整个 prompt。 |
| R2 | `<atlas-mental-model>` 块本身意外触发 atlas auto-inject 进一步注入额外 atlas 摘要，导致重复 | Med | Low | 不改 `ATLAS_AUTO_INJECT_AGENTS` 集合；新协议块只是 prompt 文本，与 hook 层互不影响。新增 hook 行为为单一 header 行，不再读 vault。 |
| R3 | `lifecycle_log_artifact(kind=delta)` 之前未被使用，可能在 issue body schema 中没有对应 row | Med | Med | 实施前确认 `src/lifecycle/issue-body.ts` 的 artifact kind 白名单；如果不接受 `delta`，先在白名单加一行（small backwards-compatible patch）；如果加不进，回退到把 delta 路径写进现有 ledger pointer 段。 |
| R4 | `atlas-compiler` 与 `atlas-worker-*` agent 仍在 registry，但永远不被 spawn，造成认知噪音 | Low | Low | doc comment 明确标注 user-triggered only；保留 agent 为后续 `/atlas-refresh` 扩展或手动触发使用；不删除以免破坏 17 个相关测试。 |
| R5 | brainstormer/planner 在协议要求 consult atlas 后误以为 atlas 缺失就阻塞主任务 | Med | Med | 协议块明确要求 atlas 失败 → status=cannot-assess + 主任务继续；drift-guard 测试断言 `cannot-assess` 字面量在协议中。 |
| R6 | 中文内容守卫误判 wikilink/path/code symbol 为英文项目说明并提示翻译 | Med | Med | 守卫只检测 prose 段（H1 后正文、Summary 段、列表项首句），跳过 frontmatter / fenced code / wikilink / inline code / 已知机器语法白名单。守卫输出仅是 hint，不阻塞写入。 |
| R7 | 已经被 14+ 测试覆盖的 finish-spawn / spawn-receipt-marker 助手在不动其行为只动 doc 时仍可能被误以为是新协议入口 | Low | Low | 在文件顶端加双层 doc：`@deprecated for lifecycle-finish auto-spawn use; available for user-triggered atlas-compiler runs only`，并在 AGENTS.md / 设计文档中明确说明保留原因。 |
| R8 | executor 给 implementer 传递的 atlas 摘要过大，挤占 task prompt 预算 | Med | Med | executor 协议子集只在 task 涉及"模块边界 / 用户行为 / 决策"时附加一段 ≤500 字符的 atlas excerpt；其它 task 一律无 excerpt。 |

---

## Rollback Notes

整个变更面是 prompt + 单源协议字符串 + 一个 hook header 行 + 文档/注释更新，不动数据结构、不改 lifecycle 状态机、不引入新外部依赖；任何阶段卡住都可以原子回滚到 issue/60 父 commit。

- **Batch 1 失败：** 删除 `src/agents/atlas-mental-model.ts`、`src/atlas/atlas-status.ts`、`src/atlas/chinese-content-guard.ts`、`src/atlas/atlas-delta.ts`；所有后续 batch 因 import 失败自然不会落地。
- **Batch 2 失败：** 在受影响 agent 文件里搜索并删除 `${ATLAS_MENTAL_MODEL_PROTOCOL}` 与 `<atlas-mental-model>` 字符串；保留 Batch 1 的 helper（不被引用就是 dead code，不影响运行）。
- **Batch 3 失败：** 还原 `src/hooks/atlas-auto-inject.ts` 中新增的 header 行；还原 `src/tools/atlas/init.ts` 的 `RECONCILE_OWNER` 字符串；还原 `src/atlas/finish-spawn.ts` 与 `src/atlas/spawn-receipt-marker.ts` 的 doc comment。
- **Batch 4 失败：** 删除新增的 4 个 test 文件；其它代码无依赖。
- **整个 issue 回退：** `git reset --hard <父 commit>` 即可，因为本 plan 全部走 lifecycle_commit 增量提交，无破坏性 merge / migration / data-shape change。

合并前必须通过：`bun test`、`bun typecheck`、`bun run build`，以及人工抽查 brainstormer/planner/executor/reviewer/commander/octto 六处 prompt 注入是否真的渲染出 `<atlas-mental-model>` 块。

---

## Verification Plan

- 所有 batch 完成后运行：
  - `bun test`（必须全绿，含 4 个新 drift-guard / boundary 测试）
  - `bun typecheck`
  - `bun run build`
  - `bun lint`
- 手工冒烟：在 issue/60 worktree 启动 OpenCode → 召唤 brainstormer → 检查 system prompt 包含 `<atlas-mental-model>` 与 atlas-context 两段；召唤 planner → 检查同上；召唤 executor → 检查只包含 consult-only 简化版；召唤 reviewer → 检查 detect-only 子集。
- lifecycle 边界手工冒烟：跑 `lifecycle_finish` 一次，确认 issue body 中没有出现 `<!-- micode:atlas:handoff:begin -->` 或 spawn receipt 写入（v9 lifecycle 不应该自动写入）。
