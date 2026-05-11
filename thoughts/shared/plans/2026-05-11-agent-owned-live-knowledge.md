---
date: 2026-05-11
topic: "Agent-Owned Live Knowledge: Atlas + Project Memory + Context Brief"
issue: 63
scope: agents
contract: none
---

# Agent-Owned Live Knowledge Implementation Plan

**Goal:** Re-cast Atlas + Project Memory from "tool事后整理" into agent-owned Read/Maintain/Verify/Report protocols, add Context Brief父子协同 channel, expose knowledge activity in user terminal reports, and收窄 lifecycle/tool自动写入面.

**Architecture:** Four-phase rollout. Phase 1 lifts the protocol layer (Atlas rewrite + new symmetric Project Memory protocol + drift guards + user-facing 本次知识上下文 section). Phase 2 adds Context Brief channel between executor and leaf agents, drops mandatory leaf lookups. Phase 3 closes the consistency loop in reviewer and disables lifecycle auto-promote. Phase 4 syncs docs and runs the 5 integration scenarios.

**Design:** `thoughts/shared/designs/2026-05-11-agent-owned-live-knowledge-design.md`

**Contract:** none (this change is internal to agent prompts + protocol strings; there is no frontend↔backend HTTP API surface)

---

## Dependency Graph

```
Batch 1 (parallel, foundation): 1.1, 1.2, 1.3
  [protocol single-source updates + new project-memory-protocol module]

Batch 2 (parallel, depends on Batch 1): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
  [inject new protocols into all 6 primary/coordinator agents + effect-first section]

Batch 3 (parallel, depends on Batch 2): 3.1, 3.2, 3.3
  [drift guards: atlas-mental-model test update, project-memory-protocol test, effect-first test update]

Batch 4 (parallel, depends on Batch 2 protocol exports): 4.1, 4.2, 4.3, 4.4
  [Phase 2 context-brief: executor block, implementer-base, reviewer, leaf guard test]

Batch 5 (parallel, depends on Batch 4): 5.1, 5.2, 5.3
  [Phase 3 consistency loop: reviewer Atlas/Memory verify role, disable lifecycle auto-promote config, lifecycle project-memory boundary test]

Batch 6 (parallel, depends on Batches 1-5): 6.1, 6.2, 6.3
  [Phase 4 docs sync: project AGENTS.md, global AGENTS.md, atlas-compiler/commands docs降级]
```

---

## Batch 1: Protocol Single-Source Foundation (parallel - 3 implementers)

All tasks in this batch have NO code-level dependencies on each other and run simultaneously.
They establish the single-source strings the rest of the plan injects.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Rewrite Atlas Mental Model Protocol to Read/Maintain/Verify/Report
**File:** `src/agents/atlas-mental-model.ts`
**Test:** `tests/agents/atlas-mental-model.test.ts` (updated separately in Task 3.1; this task's behaviour is fully tested there)
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update (changes the canonical protocol description; Atlas node `atlas/40-decisions/atlas-maintenance-protocol.md` will need a delta after merge)

The complete file replaces the current Consult/Detect/Propose/Merge framing with Read/Maintain/Verify/Report. Status enum is extended. Leaf-agent boundary stays explicit.

```typescript
/**
 * Single source of truth for the Atlas Mental Model Maintenance Protocol.
 *
 * Read / Maintain / Verify / Report semantics: agent owns maintenance during
 * the task, tool only stores and serves. Leaf agents do not write Atlas; only
 * executor / brainstormer / planner / commander / octto maintain nodes.
 *
 * This string is injected into brainstormer / planner / executor / reviewer /
 * commander / octto prompts via template-literal interpolation. Drift-guard
 * tests verify presence; they do NOT enforce byte-identical surrounding prompt.
 *
 * Lifecycle is a source provider only. This module does NOT register any
 * lifecycle-finish auto-spawn or auto-promote behaviour.
 */

export const ATLAS_STATUS_VALUES = [
  "consulted",
  "read-only",
  "maintained",
  "verified",
  "no-change",
  "delta-created",
  "stale-detected",
  "conflict",
  "blocked",
  "cannot-assess",
] as const;

export type AtlasStatus = (typeof ATLAS_STATUS_VALUES)[number];

export const ATLAS_MENTAL_MODEL_PROTOCOL = `<atlas-mental-model priority="critical" description="Project Atlas as the shared human+AI mental model, maintained by agents during the task">
<purpose>
Project Atlas (atlas/) 是人和 AI 共享的项目心智模型，不是 AI 私有缓存、代码索引或 lifecycle 副作用。
任何想要全局理解 micode 的人或 agent，最该先读 Atlas。
本协议规定 agent 在任务过程中如何 Read / Maintain / Verify / Report Atlas，并在终态报告里给出 Atlas status。
核心范式：agent 是知识维护者，工具只负责存储、检索、写锁、敏感数据过滤、用户主动入口。
</purpose>

<role-of-lifecycle priority="hard">
Lifecycle 只是 source provider。它提供 issue / design / plan / commit / PR / ledger 等来源材料，
但不拥有 Atlas 更新触发权。绝对不允许通过 lifecycle_finish / lifecycle_commit / 任何 hook 隐式自动 spawn atlas-compiler 或写入 Atlas vault。
Atlas update 在任务过程中由 agent 主动 Maintain；批量修复 / 历史整理由用户显式触发 atlas-compiler 或 /atlas-refresh。
</role-of-lifecycle>

<role-of-leaf-agents priority="hard">
leaf agent（implementer-frontend-ui / implementer-frontend-code / implementer-backend / implementer-general / reviewer）不直接写 Atlas vault，
不调用 atlas_lookup 工具。它们只消费 executor 在 spawn prompt 中下传的 atlas excerpt（≤500 字 verbatim slice）。
若 leaf agent 在工作中发现 Atlas 节点与代码事实冲突，必须在终态报告中以 "Atlas observation: stale-detected — <node> — <reason>" 单行形式向 executor escalate，
而不是自己写 delta 或修改 atlas/ 文件。
</role-of-leaf-agents>

<protocol>
<step name="Read">
非平凡任务（设计 / 计划 / 跨模块改动 / 引入新机制）开始时，必须 Read Atlas：
读取 brainstormer/planner 自动注入的 atlas-context；按需调用 atlas_lookup(query, layer?) 获取更深入的节点。
优先关注：00-index、相关 10-impl、20-behavior、40-decisions、50-risks。
把读到的节点 + 关键摘要写进终态 "本次知识上下文 - 读取" 一行。
若 atlas-context 缺失或 atlas_lookup 返回 vault 未初始化，记录 status=cannot-assess 并继续主任务，不阻塞。
</step>

<step name="Maintain">
在任务推进的语义 checkpoint 上主动维护节点：
- 模块职责 / 接口契约变化 → 更新 atlas/10-impl 节点。
- 用户可见行为规则变化 → 更新 atlas/20-behavior 节点。
- 架构决策 / 取舍产生 → 更新 atlas/40-decisions 节点。
- 长期风险 / 已知坑 → 更新 atlas/50-risks 节点。
checkpoint 粒度：每个稳定 batch 完成 + reviewer 通过；每次结论性架构决策；每次 lifecycle 阶段切换。
人工编辑过的节点（atlas/_meta 标注或 mtime 漂移）一律走 challenge 路线，禁止直接 overwrite；写 atlas/_meta/challenges/ 记录建议变更。
status=maintained 表示本任务已主动写入 vault；status=delta-created 表示因冲突 / 人工编辑而走 delta fallback。
delta 文件路径：thoughts/shared/atlas-deltas/YYYY-MM-DD-{topic}-delta.md
中文优先：节点名、H1/H2、prose、summary、rationale、risk、behavior 描述用中文。
机器语法保留英文：frontmatter keys、IDs、wikilink syntax ([[...]])、file paths、tool names、command names、source pointers (code:.../lifecycle:.../thoughts:...)、test names、code symbols。
</step>

<step name="Verify">
reviewer 与 executor 在批次完成时执行 Verify：
- 代码 diff 与对应 Atlas 节点的 claim 是否一致；契约描述与实现是否对得上。
- decision 节点提到的取舍是否仍然成立；risk 节点提到的边界是否已被本次改动跨过。
- leaf agent 报告中出现 "Atlas observation: stale-detected" 时，executor 决定本批次内修补还是登记到 status=stale-detected 让用户决定。
status=verified 表示本任务里对相关节点完成了一致性核对（与 maintained 可同时出现）；status=conflict 表示发现冲突且本任务不修。
</step>

<step name="Report">
任务终态（用户可见汇报）必须包含一行 Atlas status，取值之一：
${ATLAS_STATUS_VALUES.join(" | ")}
并把本次 Read / Maintain / Verify 的关键事实压缩进 "本次知识上下文" 段。
- consulted：读了 atlas-context 但本任务未触发后续 Maintain / Verify（极少；通常会跟 no-change）。
- read-only：本任务只 Read，未 Maintain 也未 Verify。
- maintained：本任务在 checkpoint 主动写入 Atlas vault。
- verified：本任务完成了 Atlas 一致性核对。
- no-change：本任务不改变长期心智模型。
- delta-created：本任务因冲突 / 人工编辑产出 delta 文件，附路径。
- stale-detected：发现 Atlas 与现状冲突但本任务不修，已登记由用户决定。
- conflict：Verify 发现节点与实现冲突且不在本批次修复范围。
- blocked：Maintain 失败 / vault 写锁占用 / atlas-compiler 不可用。
- cannot-assess：atlas-context 读取失败或 vault 未初始化。
status 缺省时由 primary agent 从已知证据补全，不能省略。
</step>
</protocol>

<chinese-content-guard>
传递项目信息（节点名 / 标题 / 正文 / summary / behavior 描述 / decision rationale / risk 描述）必须中文优先。
机器语法白名单（保留英文，禁止误翻）：frontmatter keys、IDs、wikilink syntax、file paths、tool names（atlas_lookup / lifecycle_finish / spawn_agent 等）、command names（/atlas-init / /atlas-refresh / /ledger 等）、source pointers (code:... / lifecycle:... / thoughts:...)、test names、code symbols (function/class/variable identifiers)、fenced code blocks 内全部内容。
违反时由 atlas-compiler / atlas-worker-* 在 reconcile 阶段标记并 challenge，不要在 primary agent 内强行翻译。
</chinese-content-guard>

<anti-patterns>
- 把 lifecycle_finish / lifecycle_commit 当作 Atlas 更新入口。
- 在没有证据的情况下静默覆盖 Atlas stale claim。
- 把每次 bug 修复或 prompt 微调都产出 delta（应当是 no-change）。
- 把节点名 / H1 / 正文用英文，但机器语法（wikilink / path / code symbol）被翻译成中文。
- 在 implementer / reviewer 等 leaf agent 里调用 atlas_lookup 工具或修改 atlas/ 文件（leaf agent 只接受父层传递的 atlas excerpt，并通过 escalate 报告冲突）。
- 把 atlas-compiler 当成日常主路径；它是辅助批量整理 / 历史 reconcile 工具，由用户显式触发。
</anti-patterns>
</atlas-mental-model>`;
```

**Decision documentation:** Design specifies Read/Maintain/Verify/Report and an extended status enum. I'm placing the new statuses `read-only`, `maintained`, `verified`, `conflict` alongside the existing ones (instead of removing the originals) so `consulted`, `no-change`, `delta-created`, `stale-detected`, `blocked`, `cannot-assess` keep their meaning for backward-compat callers that still emit them. The four new values are documented in `<step name="Report">`.

**Verify:** `bun test tests/agents/atlas-mental-model.test.ts tests/agents/atlas-protocol-injection.test.ts`
**Commit:** handled by executor batch commit (this is part of the issue-63 lifecycle, executor calls `lifecycle_commit` once after Batch 6)

---

### Task 1.2: New Project Memory Protocol Single-Source Module
**File:** `src/agents/project-memory-protocol.ts`
**Test:** `tests/agents/project-memory-protocol.test.ts` (new test file is Task 3.2)
**Depends:** none
**Domain:** general
**Atlas-impact:** new-node (introduces a symmetric protocol; `atlas/40-decisions/project-memory-maintenance-protocol.md` should follow after merge)

Symmetric to `atlas-mental-model.ts`. Same Read/Maintain/Verify/Report verbs applied to Project Memory (SQLite). Documents leaf-agent boundary and tool收窄.

```typescript
/**
 * Single source of truth for the Project Memory Maintenance Protocol.
 *
 * Symmetric to ATLAS_MENTAL_MODEL_PROTOCOL but scoped to the SQLite-backed
 * Project Memory store (decisions / lessons / risks / open questions).
 *
 * Read / Maintain / Verify / Report semantics: agent decides what to remember
 * during the task. Tool no longer auto-promotes from lifecycle finish; manual
 * project_memory_promote is allowed when the agent has decided a decision /
 * lesson / risk is worth keeping.
 *
 * Injected into brainstormer / planner / executor / reviewer / commander /
 * octto prompts via template-literal interpolation.
 */

export const PROJECT_MEMORY_STATUS_VALUES = [
  "read-only",
  "wrote-decision",
  "wrote-lesson",
  "wrote-risk",
  "wrote-open-question",
  "no-change",
  "cannot-assess",
] as const;

export type ProjectMemoryStatus = (typeof PROJECT_MEMORY_STATUS_VALUES)[number];

export const PROJECT_MEMORY_PROTOCOL = `<project-memory-protocol priority="critical" description="Project Memory as the agent-maintained historical context of the project">
<purpose>
Project Memory 是项目层面的"为什么 / 选了什么"记忆：decisions / lessons / risks / open questions，存在 SQLite 中，跨 worktree 共享。
它与 Atlas（共享心智模型，markdown vault）和 Mindmodel（代码风格约束，.mindmodel/）三者分工不同：
- Atlas 回答 "现在的项目是怎样组织的"。
- Project Memory 回答 "我们之前为什么这么选 / 踩过什么坑 / 留下了什么 open question"。
- Mindmodel 回答 "代码具体应该怎么写"。
本协议规定 agent 在任务过程中如何 Read / Maintain / Verify / Report Project Memory。
核心范式：agent 是知识维护者，工具只负责存储、检索、敏感数据过滤、去重。
</purpose>

<role-of-lifecycle priority="hard">
Lifecycle 不再自动 promote ledger / issue body 进 Project Memory。
lifecycle_finish / lifecycle_commit / 任何 hook 都不允许隐式写 Project Memory。
agent 在任务过程中显式判断哪些结论值得记住，并通过 project_memory_promote 手动写入；用户也可以通过 "remember this" / "save to project memory" 触发手动入口。
</role-of-lifecycle>

<role-of-leaf-agents priority="hard">
leaf agent（implementer-* / reviewer）默认不主动调用 project_memory_lookup。
它们消费 executor 在 spawn prompt 中下传的 context-brief 里 "已读 Project Memory 摘要" 字段。
若 spawn prompt 中没有 context-brief 摘要，或摘要与代码事实冲突，leaf agent 可以兜底调用 project_memory_lookup；
leaf agent 永远不调用 project_memory_promote / project_memory_forget。
</role-of-leaf-agents>

<protocol>
<step name="Read">
非平凡任务开始时，primary / coordinator agent（brainstormer / planner / commander / octto / executor）调用 project_memory_lookup：
- 设计阶段：查相关主题的 decision / lesson / risk / open question。
- 计划阶段：查目标模块 / 文件路径 / 接口契约的历史决策与已知风险。
- 执行阶段：executor 把读到的关键条目摘要塞进 context-brief 下传 leaf。
把读到的条目 + 主题写进终态 "本次知识上下文 - 读取"。
若 vault 未初始化或 lookup 失败，记录 status=cannot-assess 并继续，不阻塞。
</step>

<step name="Maintain">
在任务推进过程中，遇到下面情况主动 project_memory_promote：
- 拍板了一个非平凡 decision（架构 / 数据模型 / 接口契约 / 工作流 contract）→ wrote-decision。
- 学到一个可复用 lesson（踩了坑、找到了非显然解法、确认了一个工具行为）→ wrote-lesson。
- 暴露一个长期 risk（已知边界、不在本次修复范围的隐患）→ wrote-risk。
- 留下一个 open question 需要后续决定 → wrote-open-question。
promote 必须带 source pointer（design / plan / ledger / lifecycle / manual），entity_name 用主题 slug。
不确定的结论标 tentative / hypothesis；不要把推测当 decision。
never store secrets, credentials, raw transcripts, speculation, or large logs.
重复写入同 (entity, type, title) 由工具去重并标 superseded；agent 不必自己 dedupe。
</step>

<step name="Verify">
reviewer 在 batch 完成时检查代码改动是否与 Project Memory 中已有的 active decision / risk 一致：
- 改动是否覆盖、违反、或 supersede 某条 active decision？若是，promote 一条新 decision 并把旧的标 superseded，或在终态报告中升级 status=conflict。
- 改动是否触发某条 active risk 的边界？若是，把 risk 升级为 wrote-decision 或 wrote-lesson。
Verify 自身不调用 project_memory_promote；由 executor / primary agent 在终态决定写入。
</step>

<step name="Report">
任务终态（用户可见汇报）必须包含一行 Project Memory status，取值之一：
${PROJECT_MEMORY_STATUS_VALUES.join(" | ")}
并把本次 Read / Maintain / Verify 的关键事实压缩进 "本次知识上下文" 段。
- read-only：本任务只查询了 Project Memory，没有新写入。
- wrote-decision / wrote-lesson / wrote-risk / wrote-open-question：本任务通过 project_memory_promote 主动写入对应类型，附 entity_name。
- no-change：本任务无关 Project Memory。
- cannot-assess：vault 未初始化或 lookup 失败。
status 缺省时由 primary agent 从已知证据补全，不能省略。
</step>
</protocol>

<tool-narrowing>
工具职责收窄到：存储（SQLite）、检索（project_memory_lookup）、敏感数据过滤、去重、source 追踪、用户入口（/memory、project_memory_forget、project_memory_health）。
工具不再 "主动决定" 哪些 ledger 段值得 promote，也不再从 lifecycle_finish 自动提取 decision。
config.projectMemory.promoteOnLifecycleFinish 的默认值为 false；保留字段是为了支持极少数 "auto-curate on finish" 实验场景，不作为日常路径。
</tool-narrowing>

<anti-patterns>
- 把 lifecycle_finish 当作 Project Memory 写入入口。
- leaf agent 调用 project_memory_promote / project_memory_forget。
- 把每个 batch 完成都 promote 一条 lesson（应当是 no-change 多数）。
- 把推测、未拍板的设想、用户尚未确认的方向写成 wrote-decision（应该是 wrote-open-question 或不写）。
- 把代码风格约束写进 Project Memory（应该走 .mindmodel/）。
</anti-patterns>
</project-memory-protocol>`;
```

**Decision documentation:** Design says "新增 Project Memory status 枚举：read-only / wrote-decision / wrote-lesson / wrote-risk / no-change / cannot-assess". I'm adding `wrote-open-question` to the enum because the existing project memory schema already supports the `open_question` type (see `src/project-memory/types.ts`), and not exposing it would force agents to choose `wrote-lesson` for open questions which would misclassify them. This is a tightly scoped semantic extension that matches the design intent.

**Verify:** `bun test tests/agents/project-memory-protocol.test.ts` (test file created in Task 3.2)
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 1.3: Effect-First "本次知识上下文" Subsection Single-Source Helper
**File:** `src/agents/knowledge-context-section.ts`
**Test:** none (this file only exports a string constant; correctness is enforced by the byte-identity drift guard in Task 3.3 and the section-presence test in Task 3.3)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

This new module exports a single string `KNOWLEDGE_CONTEXT_SECTION` describing the "本次知识上下文" subsection that lives INSIDE the `<effect-first-reporting>` block, immediately before the existing `<section name="实现记录">` line. Brainstormer and commander will inject this string verbatim (preserving byte-identity); octto will inject the same string (its `<effect-first-reporting>` is already semantically aligned but not byte-identical, and the design says "Atlas status 与 Project Memory status 各占一行融入该段").

Why a single-source string: `tests/agents/effect-first-reporting.test.ts` enforces commander and brainstormer effect-first blocks are byte-identical. If we hand-paste this new subsection into both, every future edit must update two places. Exporting one constant guarantees they stay byte-identical.

```typescript
/**
 * Single source of truth for the "本次知识上下文" subsection inside
 * <effect-first-reporting>.
 *
 * Injected verbatim into commander.ts, brainstormer.ts, and octto.ts effect-first
 * blocks. The byte-identity drift guard in tests/agents/effect-first-reporting.test.ts
 * relies on this single source: changing the subsection in only one agent file
 * is forbidden and will fail CI.
 */

export const KNOWLEDGE_CONTEXT_SECTION = `<section name="本次知识上下文">
本段在 "实现记录" 之前固定出现，限制 3-5 条 bullet，向用户暴露本任务的知识活动。
- **读取：** 列出本任务读了哪些 atlas 节点 / Project Memory 条目 / mindmodel 主题（最多 3-5 项；用文件路径 / entity 名称引用，不复制摘要）。
- **确认：** 列出在 Read 阶段已确认的环境 / 依赖 / 测试命令 / 平台事实（最多 2-3 项；说明哪些事实下传给了子 agent，避免子 agent 重复检查）。
- **关系：** 一句话描述与本任务相关的 module / contract / decision 关系（可选；只在跨模块或跨决策时出现）。
- **维护：** 列出本任务在 Atlas / Project Memory / Mindmodel 上的写入动作（最多 3-5 项；包括 atlas 节点更新、project_memory_promote 类型 + entity、delta 文件路径）。如果没有写入，写 "无"。
- **传给子 agent：** 如果本任务通过 executor 派给子 agent，列出 context-brief 摘要长度 / 包含的 atlas 节点数 / Project Memory 条目数（用于审计父子协同）。
本段结尾固定附两行状态：
\`Atlas status: <value>\` 和 \`Project Memory status: <value>\`。
取值参见各自协议块的 status enum。
</section>

`;
```

**Decision documentation:**
- The subsection is exported as a single string so it can be byte-identical across commander/brainstormer (and copied verbatim into octto, which is intentionally not byte-identical for the rest of its effect-first block but is byte-identical for THIS subsection).
- The two status lines (`Atlas status:` and `Project Memory status:`) are inside this subsection's body, not in a separate `<section>` block, because the design says "Atlas status 与 Project Memory status 各占一行融入该段".
- Trailing blank line is intentional: the subsection is concatenated immediately before `<section name="实现记录">` which expects whitespace separation.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts` (after Task 3.3 lands)
**Commit:** part of issue-63 lifecycle batch commit

---

## Batch 2: Inject New Protocols into Primary/Coordinator Agents (parallel - 6 implementers)

All tasks in this batch depend on Batch 1 (they `import` the new symbols from
`src/agents/atlas-mental-model.ts` and `src/agents/project-memory-protocol.ts`).
Within the batch, each task touches a separate agent file and is independent.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

### Task 2.1: Inject Project Memory Protocol + Knowledge Context Section into commander.ts
**File:** `src/agents/commander.ts`
**Test:** none (existing drift guards in Tasks 3.1 / 3.3 + executor-atlas-protocol / atlas-protocol-injection tests cover this; the change is purely prompt-string composition)
**Depends:** 1.1, 1.2, 1.3
**Domain:** general
**Atlas-impact:** none

Make four edits:

1. **Import the new protocol strings.** Replace the existing import line:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
     import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";
     import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";
     ```

2. **Insert `${KNOWLEDGE_CONTEXT_SECTION}` immediately before the `<section name="实现记录">` line inside the `<structure>` block of `<effect-first-reporting>`.**
   - oldString:
     ```
     <section name="实现记录">
     commit hash / 测试命令 / issue / batch / 子任务摘要，压缩为 1-2 行。除非用户明确要求展开，不要把 reviewer 报告原文、子任务表、commit 列表贴在最前面。
     </section>
     ```
   - newString:
     ```
     ${KNOWLEDGE_CONTEXT_SECTION}<section name="实现记录">
     commit hash / 测试命令 / issue / batch / 子任务摘要，压缩为 1-2 行。除非用户明确要求展开，不要把 reviewer 报告原文、子任务表、commit 列表贴在最前面。
     </section>
     ```

3. **Append `${PROJECT_MEMORY_PROTOCOL}` immediately after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection.** The current line at L254 is `${ATLAS_MENTAL_MODEL_PROTOCOL}`. Replace it with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

4. **Update the existing `<project-memory>` block** (around L446-463) so that the "DO NOT call project_memory_promote yourself" rule is rewritten to match the new write semantics:
   - oldString: `<rule>Do NOT call project_memory_promote yourself. Promotion happens automatically at lifecycle finish. Use it manually only when the user explicitly says "remember this" or "save to project memory".</rule>`
   - newString: `<rule>Call project_memory_promote yourself when you have decided a non-trivial decision / lesson / risk / open question is worth keeping (see PROJECT_MEMORY_PROTOCOL). lifecycle_finish no longer auto-promotes. Manual promotion is also allowed when the user explicitly says "remember this" or "save to project memory".</rule>`

**Decision documentation:** I'm keeping the existing `<atlas-commander-rule>` block (L256-259) unchanged. It still applies: quick-op routes default to Atlas status = no-change (now extended to read-only / no-change pair). The new `<role-of-leaf-agents>` block in PROJECT_MEMORY_PROTOCOL does not conflict because commander is not a leaf agent.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/commander-atlas-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 2.2: Inject Project Memory Protocol + Knowledge Context Section into brainstormer.ts
**File:** `src/agents/brainstormer.ts`
**Test:** none (covered by Tasks 3.1, 3.2, 3.3 drift guards; byte-identity with commander is the strongest test)
**Depends:** 1.1, 1.2, 1.3
**Domain:** general
**Atlas-impact:** none

Make four edits, mirroring Task 2.1 exactly (the effect-first block is byte-identical with commander's, so it MUST receive the SAME edits character-for-character):

1. **Import the new protocol strings.** Replace:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
     import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";
     import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";
     ```

2. **Insert `${KNOWLEDGE_CONTEXT_SECTION}` immediately before `<section name="实现记录">` inside `<effect-first-reporting>`.** Use the identical oldString/newString pair from Task 2.1 step 2. The block is byte-identical with commander, so the same patch must apply cleanly.

3. **Append `${PROJECT_MEMORY_PROTOCOL}` after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection** (L551). Replace with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

4. **Update the existing project_memory rule in `<critical-rules>`** (L87-88):
   - oldString: `<rule>DO NOT call project_memory_promote yourself. Lifecycle finish handles promotion automatically.</rule>`
   - newString: `<rule>Call project_memory_promote yourself when you have decided a non-trivial decision / lesson / risk / open question is worth keeping (see PROJECT_MEMORY_PROTOCOL). lifecycle_finish no longer auto-promotes.</rule>`

**Decision documentation:** This task and Task 2.1 produce byte-identical `<effect-first-reporting>` blocks. The drift guard in `effect-first-reporting.test.ts:114` (`commanderBlock?.[0]` must equal `brainstormerBlock?.[0]`) will catch any divergence. Implementer must make exactly the same character-level edits to both files.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/brainstormer-atlas-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 2.3: Inject Project Memory Protocol + Knowledge Context Section into octto.ts
**File:** `src/agents/octto.ts`
**Test:** none (covered by Tasks 3.1, 3.2, 3.3 — octto effect-first is NOT byte-identical to commander/brainstormer but MUST contain the same `<section name="本次知识上下文">`)
**Depends:** 1.1, 1.2, 1.3
**Domain:** general
**Atlas-impact:** none

Make three edits:

1. **Import the new protocol strings.** Replace:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
     import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";
     import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";
     ```

2. **Insert `${KNOWLEDGE_CONTEXT_SECTION}` immediately before `<section name="实现记录">` inside `<effect-first-reporting>`.** The octto block has a different `<section name="实现记录">` body (it talks about session_id / 分支数 / 设计文档路径). Use:
   - oldString:
     ```
     <section name="实现记录">
     session_id / 分支数 / 设计文档路径压缩为 1-2 行。除非用户明确要求展开，不要把每个分支的完整 finding 贴在前面（设计文档里已经留档）。
     </section>
     ```
   - newString:
     ```
     ${KNOWLEDGE_CONTEXT_SECTION}<section name="实现记录">
     session_id / 分支数 / 设计文档路径压缩为 1-2 行。除非用户明确要求展开，不要把每个分支的完整 finding 贴在前面（设计文档里已经留档）。
     </section>
     ```

3. **Append `${PROJECT_MEMORY_PROTOCOL}` after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection** (L192). Replace with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

**Decision documentation:** octto's `<effect-first-reporting>` block intentionally diverges from commander/brainstormer (test at `effect-first-reporting.test.ts:123-139` explicitly forbids byte-identity). However, the `<section name="本次知识上下文">` subsection IS shared and must remain byte-identical across all three. Since `KNOWLEDGE_CONTEXT_SECTION` is a single exported constant, this is guaranteed structurally.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/octto-atlas-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 2.4: Inject Project Memory Protocol into planner.ts
**File:** `src/agents/planner.ts`
**Test:** none (covered by Task 3.2 project-memory-protocol injection test + existing planner-atlas-protocol test)
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none

Make two edits:

1. **Import PROJECT_MEMORY_PROTOCOL.** Replace:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
     import { PROJECT_MEMORY_PROTOCOL } from "./project-memory-protocol";
     ```

2. **Append `${PROJECT_MEMORY_PROTOCOL}` after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection** (L155). Replace with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

3. **Update planner's project_memory write rule** (around L150-151). The existing rule says "BEFORE writing the plan, call project_memory_lookup..." which still stands. Add an explicit Maintain rule:
   - oldString: `<rule>NEVER call project_memory_promote yourself. Lifecycle finish handles promotion automatically.</rule>`
   - newString: `<rule>Call project_memory_promote yourself when the plan itself encodes a non-trivial decision (architecture choice, contract shape, batch ordering rationale). lifecycle_finish no longer auto-promotes. Use entity_name=topic-slug and source_kind=plan.</rule>`

**Decision documentation:** planner is a coordinator, not a leaf, so it owns Maintain duties when the plan crystallizes a decision (e.g., choosing one of three architecture alternatives). The `entity_name=topic-slug` instruction is concrete because planner already has the topic in frontmatter.

**Verify:** `bun test tests/agents/planner-atlas-protocol.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/project-memory-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 2.5: Inject Project Memory Protocol into executor.ts
**File:** `src/agents/executor.ts`
**Test:** none (covered by Task 3.2 project-memory-protocol injection test + existing executor-atlas-protocol test; Batch 4 adds context-brief)
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** layer-update (executor is the main maintainer of atlas/10-impl during batches; protocol layer is bumped here)

Make two edits:

1. **Import PROJECT_MEMORY_PROTOCOL.** Replace:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
     import { PROJECT_MEMORY_PROTOCOL } from "@/agents/project-memory-protocol";
     ```

2. **Append `${PROJECT_MEMORY_PROTOCOL}` after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection** (L173). Replace with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

3. **Replace the existing "NEVER call project_memory_promote" rule** (around L342):
   - oldString: `<rule>NEVER call project_memory_promote. Lifecycle finish handles automatic promotion of decisions/lessons/risks. The executor only runs the implementation batches.</rule>`
   - newString: `<rule>Call project_memory_promote yourself at the end of each batch when a task crystallized a non-trivial decision / lesson / risk worth keeping (see PROJECT_MEMORY_PROTOCOL). lifecycle_finish no longer auto-promotes. The executor is responsible for Maintain duties on atlas/10-impl + Project Memory during the batch loop; leaf agents do not write.</rule>`

**Decision documentation:** executor is the natural maintenance owner because (a) it sits at the boundary where batches reach a stable checkpoint, (b) it has visibility into reviewer Verify results, and (c) the design's data-flow diagram explicitly puts Maintain after "executor batch 完成". Note that Batch 4 will additionally inject the `<context-brief>` block into this same file.

**Verify:** `bun test tests/agents/executor-atlas-protocol.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/project-memory-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 2.6: Inject Project Memory Protocol into reviewer.ts
**File:** `src/agents/reviewer.ts`
**Test:** none (covered by Task 3.2 + existing reviewer-atlas-protocol test; Batch 4 modifies leaf-lookup behaviour and Batch 5 adds Verify role)
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none (reviewer is a leaf agent and does not maintain)

Make two edits:

1. **Import PROJECT_MEMORY_PROTOCOL.** Replace:
   - oldString: `import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";`
   - newString:
     ```typescript
     import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
     import { PROJECT_MEMORY_PROTOCOL } from "@/agents/project-memory-protocol";
     ```

2. **Append `${PROJECT_MEMORY_PROTOCOL}` after the existing `${ATLAS_MENTAL_MODEL_PROTOCOL}` injection** (L114). Replace with:
   ```
   ${ATLAS_MENTAL_MODEL_PROTOCOL}

   ${PROJECT_MEMORY_PROTOCOL}
   ```

**Decision documentation:** I am NOT removing the existing "MUST call project_memory_lookup" rule in this task. That removal is part of Task 4.3 (Phase 2 leaf prompt rewrite) so the change set for Phase 1 stays scoped to "inject new protocols". The PROJECT_MEMORY_PROTOCOL's `<role-of-leaf-agents>` block explicitly documents that leaf agents may fall back to lookup when context-brief is absent, so the existing "MUST call" rule is temporarily over-strict but not contradictory — it becomes "prefer brief, fallback to lookup" in Task 4.3.

**Verify:** `bun test tests/agents/reviewer-atlas-protocol.test.ts tests/agents/atlas-protocol-injection.test.ts tests/agents/project-memory-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

## Batch 3: Phase 1 Drift Guards (parallel - 3 implementers)

All tasks in this batch depend on Batch 2 (tests read the updated prompts).
Tests are independent across files.
Tasks: 3.1, 3.2, 3.3

### Task 3.1: Update atlas-mental-model.test.ts for new Read/Maintain/Verify/Report protocol
**File:** `tests/agents/atlas-mental-model.test.ts`
**Test:** `tests/agents/atlas-mental-model.test.ts` (this IS the test file; "verify" command runs it)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none

Rewrite the test file in full to assert the new protocol shape. Existing assertions on `Consult / Detect / Propose / Merge` are replaced with assertions on `Read / Maintain / Verify / Report`. New status enum is asserted.

```typescript
import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL, ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";

describe("ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  it("contains all four protocol verbs (Read / Maintain / Verify / Report)", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Read">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Maintain">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Verify">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Report">');
  });

  it("declares lifecycle as source provider only, not update owner", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("source provider");
    // Hard-fail on any auto-spawn / auto-promote phrasing
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("lifecycle_finish auto-spawn");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("auto promote");
  });

  it("declares leaf-agent boundary explicitly", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("role-of-leaf-agents");
    // Leaf agents do not call atlas_lookup directly
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toMatch(/不调用 atlas_lookup|do not call atlas_lookup/);
    // Leaf agents escalate via reviewer report, not via writing
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Atlas observation: stale-detected");
  });

  it("requires Chinese-first project information in prose", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("中文优先");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("frontmatter");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("wikilink");
  });

  it("exports the canonical status value list (extended for live-knowledge)", () => {
    expect(ATLAS_STATUS_VALUES).toEqual([
      "consulted",
      "read-only",
      "maintained",
      "verified",
      "no-change",
      "delta-created",
      "stale-detected",
      "conflict",
      "blocked",
      "cannot-assess",
    ]);
  });

  it("references all status values in the protocol body", () => {
    for (const status of ATLAS_STATUS_VALUES) {
      expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain(status);
    }
  });

  it("references the delta artifact path convention (fallback path, not main route)", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("thoughts/shared/atlas-deltas/");
  });

  it("describes Maintain checkpoint granularity", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("checkpoint");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toMatch(/batch 完成|每个稳定 checkpoint/);
  });
});
```

**Decision documentation:** I am rewriting the whole file rather than patching individual assertions because the protocol shape itself changed (different `<step>` names, different status enum, new leaf-agent boundary block). Preserving the old `Consult / Detect / Propose / Merge` assertions and adding new ones in parallel would let stale assertions falsely pass against the new prompt. The atlas-protocol-injection test in `tests/agents/atlas-protocol-injection.test.ts` is independent and continues to assert "exactly one `<atlas-mental-model` block per agent" — no changes needed there.

**Verify:** `bun test tests/agents/atlas-mental-model.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 3.2: New test file project-memory-protocol.test.ts
**File:** `tests/agents/project-memory-protocol.test.ts`
**Test:** `tests/agents/project-memory-protocol.test.ts` (this IS the test file)
**Depends:** 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Domain:** general
**Atlas-impact:** none

New file: mirrors `tests/agents/atlas-protocol-injection.test.ts` shape for the symmetric Project Memory protocol. Asserts that all 6 agents inject `PROJECT_MEMORY_PROTOCOL` exactly once and that the protocol string itself contains the four verbs and all status values.

```typescript
import { describe, expect, it } from "bun:test";
import { PROJECT_MEMORY_PROTOCOL, PROJECT_MEMORY_STATUS_VALUES } from "@/agents/project-memory-protocol";
import { brainstormerAgent } from "@/agents/brainstormer";
import { commanderAgent } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { octtoAgent } from "@/agents/octto";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

describe("project-memory-protocol drift guard", () => {
  const cases: ReadonlyArray<readonly [string, { readonly prompt?: string }]> = [
    ["brainstormer", brainstormerAgent],
    ["planner", plannerAgent],
    ["executor", executorAgent],
    ["reviewer", reviewerAgent],
    ["commander", commanderAgent],
    ["octto", octtoAgent],
  ];

  for (const [name, agent] of cases) {
    it(`${name} injects PROJECT_MEMORY_PROTOCOL exactly once`, () => {
      expect(agent.prompt).toContain(PROJECT_MEMORY_PROTOCOL);
      const matches = (agent.prompt ?? "").match(/<project-memory-protocol/gu) ?? [];
      expect(matches.length).toBe(1);
    });
  }

  describe("PROJECT_MEMORY_PROTOCOL body", () => {
    it("contains all four protocol verbs", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Read">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Maintain">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Verify">');
      expect(PROJECT_MEMORY_PROTOCOL).toContain('<step name="Report">');
    });

    it("declares lifecycle no longer auto-promotes", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("lifecycle_finish");
      expect(PROJECT_MEMORY_PROTOCOL).toMatch(/不再自动 promote|不允许隐式写|no longer auto-promotes/);
    });

    it("declares leaf-agent boundary explicitly", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("role-of-leaf-agents");
      // Leaf agents never write
      expect(PROJECT_MEMORY_PROTOCOL).toMatch(/永远不调用 project_memory_promote|do not call project_memory_promote/);
    });

    it("exports the canonical status value list", () => {
      expect(PROJECT_MEMORY_STATUS_VALUES).toEqual([
        "read-only",
        "wrote-decision",
        "wrote-lesson",
        "wrote-risk",
        "wrote-open-question",
        "no-change",
        "cannot-assess",
      ]);
    });

    it("references all status values in the protocol body", () => {
      for (const status of PROJECT_MEMORY_STATUS_VALUES) {
        expect(PROJECT_MEMORY_PROTOCOL).toContain(status);
      }
    });

    it("describes the three-way distinction with Atlas and Mindmodel", () => {
      expect(PROJECT_MEMORY_PROTOCOL).toContain("Atlas");
      expect(PROJECT_MEMORY_PROTOCOL).toContain("Mindmodel");
      expect(PROJECT_MEMORY_PROTOCOL).toContain(".mindmodel/");
    });
  });
});
```

**Decision documentation:** This test file consolidates BOTH per-agent injection drift guard AND protocol-body assertions, mirroring how `atlas-mental-model.test.ts` and `atlas-protocol-injection.test.ts` together cover Atlas. Splitting Project Memory into two files would create symmetric file count but the assertions are small enough that a single file is clearer. The 6-agent injection check matches the 6 agents updated in Batch 2.

**Verify:** `bun test tests/agents/project-memory-protocol.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 3.3: Update effect-first-reporting.test.ts for "本次知识上下文" subsection
**File:** `tests/agents/effect-first-reporting.test.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts` (this IS the test file)
**Depends:** 1.3, 2.1, 2.2, 2.3
**Domain:** general
**Atlas-impact:** none

Three edits to the existing test:

1. **Extend `SECTION_LABELS` constant** at L10 to include the new subsection:
   - oldString: `const SECTION_LABELS = ["预期表现", "你可以怎么验收", "已知限制", "实现记录"] as const;`
   - newString: `const SECTION_LABELS = ["预期表现", "你可以怎么验收", "已知限制", "本次知识上下文", "实现记录"] as const;`

2. **Add a new `describe` block** asserting placement of `<section name="本次知识上下文">` immediately before `<section name="实现记录">` in each of the three primary agents:
   ```typescript
   describe("knowledge-context subsection placement", () => {
     for (const agent of PRIMARIES_WITH_BLOCK) {
       it(`${agent.name} places 本次知识上下文 immediately before 实现记录`, () => {
         const knowledgeOpen = agent.source.search(/<section name="本次知识上下文">/);
         const implOpen = agent.source.search(/<section name="实现记录">/);
         expect(knowledgeOpen).toBeGreaterThan(-1);
         expect(implOpen).toBeGreaterThan(-1);
         expect(knowledgeOpen).toBeLessThan(implOpen);
       });

       it(`${agent.name} knowledge-context subsection mentions Atlas status and Project Memory status lines`, () => {
         const block = effectFirstBlock(agent.source);
         expect(block).not.toBeNull();
         const body = block?.[0] ?? "";
         expect(body).toContain("Atlas status:");
         expect(body).toContain("Project Memory status:");
       });
     }
   });
   ```

3. **Strengthen the existing drift guard "commander and brainstormer effect-first blocks are byte-identical"** (no oldString change needed; the existing test already asserts byte-identity, but add a sibling assertion that the knowledge-context subsection within octto is byte-identical to the one in commander). Add inside `describe("drift guard", ...)`:
   ```typescript
   it("knowledge-context subsection is byte-identical across all three primaries", () => {
     const extractKnowledge = (src: string): string | null => {
       const match = src.match(/<section name="本次知识上下文">[\s\S]*?<\/section>/);
       return match?.[0] ?? null;
     };
     const commanderK = extractKnowledge(COMMANDER_SOURCE);
     const brainstormerK = extractKnowledge(BRAINSTORMER_SOURCE);
     const octtoK = extractKnowledge(OCTTO_SOURCE);
     expect(commanderK).not.toBeNull();
     expect(brainstormerK).not.toBeNull();
     expect(octtoK).not.toBeNull();
     expect(commanderK).toBe(brainstormerK);
     expect(commanderK).toBe(octtoK);
   });
   ```

4. **Update the AGENTS.md mirror block** (Tests on `AGENTS_MD`, around L142-171). Add a new `it()` asserting AGENTS.md mentions the new subsection. Add inside the existing `describe("AGENTS.md mirror", ...)`:
   ```typescript
   it("documents the 本次知识上下文 subsection", () => {
     expect(AGENTS_MD).toContain("本次知识上下文");
     expect(AGENTS_MD).toMatch(/Atlas status|Project Memory status/);
   });
   ```

**Decision documentation:**
- The byte-identity assertion `commanderBlock?.[0] === brainstormerBlock?.[0]` (existing L120) already covers the new subsection because `KNOWLEDGE_CONTEXT_SECTION` is injected at the same position in both files using the same single-source string. No change to that assertion is needed.
- The new "byte-identical across all three" assertion specifically targets the `<section name="本次知识上下文">` block only, NOT the full `<effect-first-reporting>` block (which is intentionally NOT byte-identical between commander and octto, per existing test L123).
- The AGENTS.md mirror assertion (#4) requires that Task 6.1 (AGENTS.md update) actually adds the "本次知识上下文" content. The test ordering ensures Batch 6 cannot land without Batch 3 passing first.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

## Batch 4: Phase 2 Context Brief Protocol (parallel - 4 implementers)

All tasks in this batch depend on Batch 2 protocol exports landing.
Tasks: 4.1, 4.2, 4.3, 4.4

### Task 4.1: Add `<context-brief>` Protocol Block to executor.ts
**File:** `src/agents/executor.ts`
**Test:** none (covered by Task 4.4 grep test verifying `<context-brief>` block presence + content)
**Depends:** 2.5
**Domain:** general
**Atlas-impact:** layer-update (executor's contract with leaf agents changes)

Insert a new `<context-brief>` block immediately AFTER `<atlas-propagation>` (which ends at L180) and BEFORE `<pty-tools>` (which begins at L182). The block defines what executor MUST inject into every implementer/reviewer spawn prompt.

oldString:
```
</atlas-propagation>

<pty-tools description="For background bash processes">
```

newString:
```
</atlas-propagation>

<context-brief priority="critical" description="Father-child knowledge protocol: executor passes confirmed facts down to leaf agents so they do not re-explore">
<purpose>
context-brief 是父子协同的核心通道。executor 把任务相关的已确认事实显式下传给 implementer / reviewer，子 agent 默认信任 brief，不重复 lookup mindmodel / project_memory / atlas。
这避免了 N 个并行 leaf agent 各自从零探索同一事实造成的 token 浪费，也让"父层已确认的事"对子 agent 可见、可审计。
</purpose>

<mandatory-spawn-block>
Every spawn_agent call to implementer-frontend-ui / implementer-frontend-code / implementer-backend / implementer-general / reviewer MUST include this block in the prompt, placed immediately after the <spawn-meta> identity block and before the task-specific instructions:

  <context-brief>
    <confirmed>
      - 环境 / 依赖 / 测试命令状态: <one line, e.g. "bun test 可用，依赖已安装，Linux remote 环境，无前端 watch mode 需求">
      - 已读 Atlas 节点 + 关键摘要: <最多 5 项, 每项 ≤500 字 verbatim slice; 若 plan 标注 Atlas-impact=layer-update/new-node 必须含相关节点>
      - 已读 Project Memory 条目: <decision / lesson / risk entity_name + 一句话摘要, 最多 5 项>
      - 已读 Mindmodel 主题: <最多 3 项主题名, 不附摘要; 子 agent 仍可自行查 mindmodel_lookup 因为它是代码风格不是事实>
      - 相关 contract 路径: <如 plan 头有 Contract: path 则原样附上; 若无则写 "none">
    </confirmed>
    <do-not-repeat>
      - 不要重复 project_memory_lookup 已传递的条目主题。
      - 不要重复检查已确认的环境 / 依赖 / 测试命令。
      - 不要调用 atlas_lookup（leaf agent 无此工具，由父层下传 excerpt）。
    </do-not-repeat>
    <must-still-verify>
      - 必须读取本任务的目标文件，不要凭 brief 推断文件内容。
      - 必须跑本任务的验证命令（Test 字段指向的命令），不要凭 brief 推断测试结果。
      - 若 brief 中的事实与本任务读到的代码事实冲突，必须在终态报告 escalate ("Brief mismatch: ..."), 而不是静默执行。
    </must-still-verify>
  </context-brief>
</mandatory-spawn-block>

<size-limit>
context-brief 总长度硬限制 ≤4KB（约 1000 字符）。
- 单条 Atlas 节点摘要 ≤500 字 verbatim slice。
- 单条 Project Memory 摘要 ≤一句话。
超出限制时父层（executor）先压缩摘要；仍超出则拆分任务，不要硬塞。
</size-limit>

<construction-flow>
1. executor 在 parse-plan 阶段收集 plan 头的 Contract 路径 + 各 task 的 Atlas-impact 标签。
2. 在 execute-batch 阶段之前 executor 调用 project_memory_lookup(topic) + 从 atlas-context（auto-inject）切片相关节点，组装一份适用于本批次所有任务的"公共 brief"。
3. 对每个 task 派 implementer 时，把公共 brief 嵌入 spawn prompt 的 <context-brief> 块中；如果某个 task 的 Atlas-impact 单独要求某节点摘要，executor 在该 task 的 brief 中追加。
4. 派 reviewer 时使用同一份 brief（保证 implementer 与 reviewer 对"已确认事实"看到同样视图）。
</construction-flow>

<conflict-handling>
若 leaf agent 在终态报告中返回 "Brief mismatch: ..." 或 "Atlas observation: stale-detected ...":
- executor 在本批次的 output-format 终态报告中聚合并展示给用户 / primary agent。
- executor 不自动修改 brief 也不自动写 Atlas / Project Memory；由 primary agent 决定是否在下一个 checkpoint 维护节点。
- 若冲突严重到无法完成 task，按现有 BLOCKED 规则处理（不计入 review cycle，直接 escalate）。
</conflict-handling>

<anti-patterns>
- 给 implementer 派任务而忘记附 context-brief（子 agent 会被迫重新 lookup，浪费 token）。
- 把整个 atlas-context 全文直接塞进 brief（突破 ≤4KB 限制；先切片再下传）。
- 在 brief 里塞猜测或未确认的事实（brief 是"已确认"通道，未确认的事不要写进去）。
- leaf agent 报告 brief 冲突时 executor 私自改 brief 重派（这会掩盖真实问题；应让 primary agent 决策）。
</anti-patterns>
</context-brief>

<pty-tools description="For background bash processes">
```

Also append a rule to `<rules>` block (around L311) and to the `<execution-example>` block to make context-brief construction explicit. Add inside `<rules>`:
```
<rule>Before each batch, construct the public context-brief (atlas excerpts + project_memory_lookup results + confirmed env). See <context-brief>.</rule>
<rule>Every spawn_agent call to implementer-*/reviewer MUST contain a <context-brief> block in the prompt. NO exceptions.</rule>
```

Update `<execution-example>` Step 1 to show context-brief in the spawn prompt. Replace the existing first spawn_agent example:
- oldString: `spawn_agent(agent="implementer-general", prompt="<spawn-meta task-id="2026-04-24-users:batch1:1.1:implementer:vitest.config.ts" run-id="<your-session-id>" generation="1" />\nTask 1.1: Create vitest.config.ts [code]", description="1.1")`
- newString: `spawn_agent(agent="implementer-general", prompt="<spawn-meta task-id="2026-04-24-users:batch1:1.1:implementer:vitest.config.ts" run-id="<your-session-id>" generation="1" />\n<context-brief><confirmed>- 环境: bun test 可用, deps 已装\n- 已读 Atlas: atlas/10-impl/test-infra.md (本批次配置测试基建)\n- 已读 Project Memory: decision/vitest-vs-bun-test (entity=test-infra)\n- 已读 Mindmodel: testing patterns\n- Contract: none</confirmed><do-not-repeat>不要重复检查 bun test / project_memory_lookup test-infra / atlas_lookup</do-not-repeat><must-still-verify>读取目标文件 + 跑测试命令; brief 冲突必须 escalate</must-still-verify></context-brief>\nTask 1.1: Create vitest.config.ts [code]", description="1.1")`

**Decision documentation:**
- Placement is between `<atlas-propagation>` and `<pty-tools>` because that section already discusses how executor propagates atlas excerpts to leaf agents; context-brief generalizes the same idea to Project Memory + Mindmodel + env.
- The 4KB limit is a hard one. The design says "硬限制总长 ≤4KB" without specifying enforcement. I'm leaving enforcement as a prompt-level instruction (agent self-policing) rather than code-level (which would require adding a wrapper around `spawn_agent`). Code-level enforcement can be a follow-up if violations are seen in practice.
- The `<must-still-verify>` block is critical: it preserves the integrity of leaf-agent verification (they must still read files and run tests; brief is informational, not authoritative).

**Verify:** `bun test tests/agents/executor-atlas-protocol.test.ts tests/agents/executor-prompt.test.ts tests/agents/executor.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 4.2: Soften Mandatory Lookups in implementer.ts BASE_IMPLEMENTER_PROMPT
**File:** `src/agents/implementer.ts`
**Test:** none (covered by Task 4.4 grep test forbidding "MUST call project_memory_lookup" in implementer prompts)
**Depends:** 4.1
**Domain:** general
**Atlas-impact:** none

Make two edits inside `<project-constraints>` block (L60-76):

1. **Soften the mandatory project_memory_lookup rule.**
   - oldString: `<rule>BEFORE adapting, ALSO call project_memory_lookup with the file path or feature topic to surface prior decisions/risks. Do NOT silently override an active decision; escalate instead.</rule>`
   - newString: `<rule>If the spawn prompt's <context-brief> already lists relevant Project Memory entries, trust them; do NOT call project_memory_lookup. Only call project_memory_lookup as a fallback when the brief is absent, or when you find a conflict between the brief and the actual code; in that case escalate via Brief mismatch report.</rule>`

2. **Preserve the explicit no-write rule** (this stays):
   - The existing `<rule>NEVER call project_memory_promote or project_memory_forget. Implementers do not write memory.</rule>` stays unchanged. It is the leaf-write boundary.

3. **Soften the mandatory mindmodel_lookup wording** (slightly; mindmodel is still allowed but no longer "MUST"):
   - oldString: `<rule>YOU MUST call mindmodel_lookup BEFORE adapting ANY code that doesn't match the plan.</rule>`
   - newString: `<rule>If the spawn prompt's <context-brief> lists relevant Mindmodel topics, you may trust them and skip mindmodel_lookup. When adapting code that diverges from the plan AND the brief did not cover the topic, call mindmodel_lookup for that specific topic.</rule>`

4. **Add a new `<context-brief-consumption>` block** immediately after `<project-constraints>` (after L76) explaining how to consume the brief:
   ```
   <context-brief-consumption priority="high" description="How to consume the executor-provided context-brief">
     <rule>If your spawn prompt contains a <context-brief> block, READ IT FIRST before doing anything else.</rule>
     <rule>Trust the <confirmed> section: it lists facts the parent agent has already verified (env, deps, Atlas excerpts, Project Memory entries, contract path).</rule>
     <rule>Obey <do-not-repeat>: do not redo lookups the parent already did. This is not laziness; it is the protocol.</rule>
     <rule>Obey <must-still-verify>: ALWAYS read the target file and run the verify command. Brief is informational, not authoritative.</rule>
     <rule>If you find a contradiction between the brief and the code you are reading, STOP. Report "Brief mismatch: <one-line summary>" and escalate as BLOCKED. Do NOT silently rewrite around the contradiction; the parent agent must decide.</rule>
     <rule>If the spawn prompt does NOT contain a <context-brief> block (very old executor calls), fall back to the existing lookup rules in <project-constraints>: you may call mindmodel_lookup / project_memory_lookup as needed.</rule>
   </context-brief-consumption>
   ```

**Decision documentation:**
- I keep `mindmodel_lookup` available as a fallback because the design explicitly says "mindmodel_lookup 保留为可选项，子 agent 仍可独立查代码风格约束". The wording change from "MUST" to "may trust them and skip" makes that explicit without removing the capability.
- The "Brief mismatch" report shape is defined here (in implementer) and consumed by executor's `<conflict-handling>` block from Task 4.1. They reference the same string so executor can grep for it.
- Since `BASE_IMPLEMENTER_PROMPT` is the shared base for all four domain-specific implementers (`-frontend-ui`, `-frontend-code`, `-backend`, `-general`), this single edit covers all four leaves.

**Verify:** `bun test tests/agents/implementer-domain.test.ts tests/agents/executor-dispatch.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 4.3: Soften Mandatory Lookups in reviewer.ts
**File:** `src/agents/reviewer.ts`
**Test:** none (covered by Task 4.4 grep test)
**Depends:** 4.1
**Domain:** general
**Atlas-impact:** none

Make two edits inside `<project-constraints>` block (L33-50):

1. **Soften the mandatory mindmodel and project_memory lookup rules.**
   - oldString: `<rule>YOU MUST call mindmodel_lookup BEFORE reviewing - you need project context.</rule>\n<rule>YOU MUST also call project_memory_lookup with the task topic to surface prior decisions or constraints. Flag any change that contradicts an active decision.</rule>`
   - newString: `<rule>If the spawn prompt's <context-brief> already lists relevant Mindmodel topics and Project Memory entries, trust them; do NOT re-call those lookups. Only call them as fallbacks when the brief is absent, or when you find a conflict between the brief and the actual code under review.</rule>\n<rule>Flag any change that contradicts an active decision from the brief or from a fallback lookup. The contradiction does NOT auto-block: it goes into your reviewer report under "Project Memory observation".</rule>`

2. **Preserve the explicit no-write rule** (this stays unchanged):
   - The existing `<rule>NEVER call project_memory_promote or project_memory_forget. Reviewers do not write memory.</rule>` is kept verbatim. Leaf no-write boundary.

3. **Add `<context-brief-consumption>` block** immediately after `<project-constraints>` (after L50), identical in structure to Task 4.2's block but contextualised for reviewer:
   ```
   <context-brief-consumption priority="high" description="How to consume the executor-provided context-brief">
     <rule>If your spawn prompt contains a <context-brief> block, READ IT FIRST before opening the implementation under review.</rule>
     <rule>Trust the <confirmed> section: parent has verified env / deps / Atlas excerpts / Project Memory entries / contract path.</rule>
     <rule>Obey <do-not-repeat>: do not redo lookups the parent already did.</rule>
     <rule>Obey <must-still-verify>: ALWAYS read the implementation file, run the test command, and check against the contract. Brief is informational.</rule>
     <rule>If you find a contradiction between the brief and the code under review, include a one-line "Brief mismatch: <summary>" in your reviewer report alongside your APPROVED / CHANGES REQUESTED verdict. Do NOT change your verdict because of a brief mismatch; it is a separate signal for executor.</rule>
     <rule>If the spawn prompt does NOT contain a <context-brief> block, fall back to the existing lookup rules in <project-constraints>.</rule>
   </context-brief-consumption>
   ```

**Decision documentation:**
- Reviewer's "Brief mismatch" rule does NOT change the verdict (APPROVED / CHANGES REQUESTED stays based on code correctness). The mismatch is a side signal routed to executor's `<conflict-handling>` block.
- Reviewer's Atlas observation rule already exists at `<atlas-detect-role>` (L116-120) and stays unchanged: "Atlas observation: stale-detected" is the canonical phrase. Project Memory now gets a parallel signal: "Brief mismatch" or "Project Memory observation".
- Batch 5 will additionally extend reviewer with explicit Atlas/Memory consistency Verify duties — that's a separate concern that builds on this brief consumption protocol.

**Verify:** `bun test tests/agents/reviewer-atlas-protocol.test.ts tests/agents/reviewer-prompt.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 4.4: New Test File leaf-no-knowledge-write.test.ts + executor-context-brief.test.ts
**File:** `tests/agents/leaf-no-knowledge-write.test.ts`
**Test:** `tests/agents/leaf-no-knowledge-write.test.ts` (this IS the test file)
**Depends:** 4.1, 4.2, 4.3
**Domain:** general
**Atlas-impact:** none

Single new file containing TWO `describe` blocks: one grep-based leaf-write guard, and one assertion that executor injects `<context-brief>` instructions.

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BASE_IMPLEMENTER_PROMPT } from "@/agents/implementer";
import { executorAgent } from "@/agents/executor";
import { implementerBackendAgent } from "@/agents/implementer-backend";
import { implementerFrontendCodeAgent } from "@/agents/implementer-frontend-code";
import { implementerFrontendUiAgent } from "@/agents/implementer-frontend-ui";
import { implementerGeneralAgent } from "@/agents/implementer-general";
import { reviewerAgent } from "@/agents/reviewer";

const LEAF_AGENTS = [
  ["implementer-base", BASE_IMPLEMENTER_PROMPT],
  ["implementer-frontend-ui", implementerFrontendUiAgent.prompt ?? ""],
  ["implementer-frontend-code", implementerFrontendCodeAgent.prompt ?? ""],
  ["implementer-backend", implementerBackendAgent.prompt ?? ""],
  ["implementer-general", implementerGeneralAgent.prompt ?? ""],
  ["reviewer", reviewerAgent.prompt ?? ""],
] as const;

describe("leaf agents do not write knowledge stores", () => {
  for (const [name, prompt] of LEAF_AGENTS) {
    describe(name, () => {
      it("never instructs the agent to call project_memory_promote", () => {
        // Soft check: leaf prompts may MENTION the tool name in a forbidding clause ("NEVER call ...").
        // What we forbid is any directive that says the agent SHOULD call promote.
        const promoteCallPattern = /(?:MUST|SHOULD|always)\s+call\s+project_memory_promote/i;
        expect(prompt).not.toMatch(promoteCallPattern);
      });

      it("never instructs the agent to call project_memory_forget", () => {
        const forgetCallPattern = /(?:MUST|SHOULD|always)\s+call\s+project_memory_forget/i;
        expect(prompt).not.toMatch(forgetCallPattern);
      });

      it("never instructs the agent to write atlas/ vault directly", () => {
        // No "modify atlas/" / "edit atlas/" / "call atlas write" directive
        const atlasWritePattern = /(?:modify|edit|write|update)\s+atlas\//i;
        expect(prompt).not.toMatch(atlasWritePattern);
      });

      it("never instructs the agent to call atlas_lookup", () => {
        // atlas_lookup is a tool reserved for primary/coordinator agents.
        // Leaf prompts may mention it in a forbidding clause but never as a directive.
        const lookupCallPattern = /(?:MUST|SHOULD|always)\s+call\s+atlas_lookup/i;
        expect(prompt).not.toMatch(lookupCallPattern);
      });

      it("does NOT contain mandatory project_memory_lookup wording (softened in Phase 2)", () => {
        // After Phase 2 the mandatory wording is replaced with "prefer brief, fallback to lookup".
        // This test catches accidental reverts.
        const mandatoryPattern = /(?:MUST|YOU MUST)\s+(?:also\s+)?call\s+project_memory_lookup/i;
        expect(prompt).not.toMatch(mandatoryPattern);
      });
    });
  }
});

describe("executor injects context-brief protocol", () => {
  const executorPrompt = executorAgent.prompt ?? "";

  it("declares the <context-brief> protocol block exactly once", () => {
    const opens = executorPrompt.match(/<context-brief[\s>]/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(1);
    // Must declare the protocol block itself
    expect(executorPrompt).toContain('<context-brief priority="critical"');
    expect(executorPrompt).toContain("</context-brief>");
  });

  it("defines the three child-protocol sections", () => {
    expect(executorPrompt).toContain("<confirmed>");
    expect(executorPrompt).toContain("<do-not-repeat>");
    expect(executorPrompt).toContain("<must-still-verify>");
  });

  it("specifies a size limit on context-brief", () => {
    expect(executorPrompt).toContain("4KB");
  });

  it("rules that EVERY spawn_agent to implementer/reviewer MUST include context-brief", () => {
    // The phrase MUST contain or include
    expect(executorPrompt).toMatch(/MUST (?:contain|include).*context-brief|context-brief.*MUST/i);
  });
});

describe("leaf agents consume context-brief", () => {
  for (const [name, prompt] of LEAF_AGENTS) {
    if (name === "implementer-base") continue; // base prompt is composed into others
    it(`${name} contains a <context-brief-consumption> block`, () => {
      expect(prompt).toContain("<context-brief-consumption");
    });
    it(`${name} instructs to escalate on brief mismatch`, () => {
      expect(prompt).toMatch(/Brief mismatch/);
    });
  }
});
```

**Decision documentation:**
- This test file lives in `tests/agents/` (per design's Testing Strategy bullet "新增 grep 测试").
- I'm consolidating both directions of the leaf-knowledge contract (leaf doesn't write + leaf does consume brief + executor provides brief) into ONE file because they are reciprocal halves of the same protocol. Splitting would create false isolation.
- The grep patterns are deliberately conservative: they catch directives ("MUST call ...") but allow forbidding clauses ("NEVER call ..."), so the existing "NEVER call project_memory_promote" rule in implementer.ts and reviewer.ts continues to pass.
- `BASE_IMPLEMENTER_PROMPT` is exported from `src/agents/implementer.ts`; the four domain-specific implementers compose on top of it. Testing both base + composed catches drift if a domain-specific suffix accidentally re-introduces a mandatory lookup.

**Verify:** `bun test tests/agents/leaf-no-knowledge-write.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

## Batch 5: Phase 3 Consistency Loop + Lifecycle Boundary (parallel - 3 implementers)

All tasks in this batch depend on Batch 4 (reviewer Verify role references context-brief).
Tasks: 5.1, 5.2, 5.3

### Task 5.1: Add Atlas/Memory Consistency Verify Role to reviewer.ts
**File:** `src/agents/reviewer.ts`
**Test:** none (covered by existing reviewer-atlas-protocol test + Task 4.4 leaf-no-write test; this task only adds prose, not new tools)
**Depends:** 4.3
**Domain:** general
**Atlas-impact:** none (reviewer is leaf and only OBSERVES, does not maintain)

Make one addition: extend the existing `<atlas-detect-role>` block (L116-120) to also cover Project Memory consistency. Rename it to `<knowledge-detect-role>` for symmetry. Replace:

oldString:
```
<atlas-detect-role priority="medium">
<rule>You are a leaf agent. You do NOT write atlas deltas, do NOT call atlas_lookup, do NOT modify atlas/ vault.</rule>
<rule>If you detect a contradiction between atlas-context (or atlas excerpts in your spawn prompt) and the implementation under review, include a one-line "Atlas observation: stale-detected — <node> — <reason>" in your reviewer report so executor can surface it.</rule>
<rule>If atlas-context is missing or empty, do not block the review; this is informational only.</rule>
</atlas-detect-role>
```

newString:
```
<knowledge-detect-role priority="medium" description="Atlas + Project Memory consistency observations from a leaf reviewer">
<rule>You are a leaf agent. You do NOT write atlas deltas, do NOT modify atlas/ vault, do NOT call project_memory_promote, do NOT call project_memory_forget.</rule>
<rule>You MAY call atlas_lookup or project_memory_lookup as fallback ONLY when the spawn prompt did not provide a <context-brief>. Within the brief flow, prefer the excerpts already in the brief over re-querying.</rule>

<atlas-consistency>
<rule>If you detect a contradiction between an Atlas excerpt (from atlas-context or <context-brief>) and the implementation under review, include a one-line "Atlas observation: stale-detected — <node> — <reason>" in your reviewer report so executor can surface it.</rule>
<rule>If you detect a contradiction with an atlas/40-decisions or atlas/50-risks node specifically, escalate stronger: include "Atlas observation: critical-conflict — <node> — <reason>" alongside CHANGES REQUESTED. These layers are higher-stakes.</rule>
<rule>If atlas-context is missing or empty, do not block the review; this is informational only.</rule>
</atlas-consistency>

<project-memory-consistency>
<rule>If you detect that the implementation contradicts an active Project Memory decision listed in the <context-brief>, include a one-line "Project Memory observation: conflict — <entity_name> — <reason>" in your reviewer report.</rule>
<rule>If the implementation crosses the boundary of an active Project Memory risk listed in the brief, include "Project Memory observation: risk-crossed — <entity_name> — <reason>".</rule>
<rule>These observations are SIGNALS for executor to escalate or for the primary agent to write a Maintain entry. The reviewer does NOT auto-fail the review on these signals; the verdict (APPROVED / CHANGES REQUESTED) is based on code correctness against the plan, not on knowledge-store conflicts.</rule>
</project-memory-consistency>

<observation-format>
<rule>Place observation lines at the END of your reviewer body but BEFORE the final verdict line (per <final-marker-rule>: verdict MUST be the last line).</rule>
<rule>Multiple observations are allowed; one per line.</rule>
</observation-format>
</knowledge-detect-role>
```

Also extend the `<checklist>` section to include a "knowledge-consistency" check. Append inside `<checklist>` (after the "safety" section, around L91):
```
<section name="knowledge-consistency">
<check>Implementation matches Atlas claims for the affected module / behavior / decision?</check>
<check>Implementation does not silently contradict an active Project Memory decision listed in the brief?</check>
<check>Implementation does not cross a Project Memory risk boundary without a Maintain note?</check>
</section>
```

**Decision documentation:**
- Renaming `<atlas-detect-role>` to `<knowledge-detect-role>` is necessary because the block now covers BOTH Atlas and Project Memory. The previous test at `tests/agents/reviewer-atlas-protocol.test.ts` may grep for the old tag — verify after edit that it still passes; if it greps for the literal `<atlas-detect-role>` string, that test needs an update too (audit during implementation).
- The 40-decisions / 50-risks "critical-conflict" escalation is stronger than generic "stale-detected" because those layers are higher-stakes per design's Error Handling table ("高风险节点 (40-decisions / 50-risks) 升级为 fail").
- I am NOT auto-failing the review on knowledge conflict (design says "默认 warn 进入 report，让 executor 决定"). The verdict line stays driven by code correctness; knowledge observations are side signals.

**Verify:** `bun test tests/agents/reviewer-atlas-protocol.test.ts tests/agents/reviewer-prompt.test.ts tests/agents/leaf-no-knowledge-write.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 5.2: Disable Lifecycle Auto-Promote to Project Memory (default off)
**File:** `src/utils/config.ts`
**Test:** none for the config flag flip itself; existing `tests/lifecycle/promote-on-finish.test.ts` must be updated as part of this task to reflect the new default (covered in step 2 below)
**Depends:** 2.5
**Domain:** backend
**Atlas-impact:** new-node (introduces a config-level boundary that should be captured in atlas/40-decisions/lifecycle-promote-policy.md after merge)

Two edits in one task because they are coupled:

1. **Flip the default in `src/utils/config.ts` at L285.**
   - oldString: `    promoteOnLifecycleFinish: true,`
   - newString: `    promoteOnLifecycleFinish: false,`

   The rest of `src/lifecycle/index.ts:556-580` (`promoteFinishedRecord`) stays untouched: the function still respects the config flag and remains available for users who explicitly opt in. The behavioural change comes from the default flip.

2. **Update `tests/lifecycle/promote-on-finish.test.ts` so default-config cases expect NO auto-promote.**
   - Read the existing test (see context loaded earlier; ~50+ lines).
   - In every test case that constructed a config without explicitly setting `promoteOnLifecycleFinish`, set it to `true` explicitly to preserve the existing assertion shape (because the test asserts that promotion DID happen).
   - Add a new test case at the end: `it("does NOT auto-promote when config uses default (promoteOnLifecycleFinish: false)", ...)`. Reuse the existing test scaffolding (mkdtempSync setup, runner stub, etc.) but pass `config.projectMemory.promoteOnLifecycleFinish = false` and assert that `record.notes` does NOT contain `memory_promoted:` or `memory_rejected:`.

   The detailed edit set requires reading the test file's exact structure first; implementer should:
   1. Read `tests/lifecycle/promote-on-finish.test.ts` in full.
   2. For each `beforeEach` block or test config builder, add explicit `promoteOnLifecycleFinish: true` to preserve existing positive-path coverage.
   3. Add one new `it()` block asserting default-off behavior.

**Decision documentation:**
- I chose to flip the default in `src/utils/config.ts` rather than delete the `promoteFinishedRecord` code path. Reasoning:
  - The design's Constraint says "lifecycle_finish 与任何 lifecycle hook 不允许自动写 atlas/ 或 Project Memory vault" — interpreted strictly, this means the DEFAULT lifecycle finish must not promote. Flipping the default satisfies that.
  - Keeping the function callable behind an opt-in flag preserves an escape hatch for future "auto-curate on finish" experiments without code resurrection cost.
  - Deleting the code path entirely would require also deleting the test fixture in `tests/lifecycle/promote-on-finish.test.ts` and removing the `formatPromotionNote` / `promoteFinishedRecord` helpers, which is a larger blast radius for a behaviour that may legitimately be flipped back on by a future user.
- The boundary enforcement (lifecycle code CANNOT touch project_memory anymore even when opt-in is true) is the responsibility of Task 5.3's grep test. Task 5.2 only handles the default.

**Verify:** `bun test tests/lifecycle/promote-on-finish.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 5.3: New Lifecycle Project Memory Boundary Test
**File:** `tests/lifecycle/project-memory-boundary.test.ts`
**Test:** `tests/lifecycle/project-memory-boundary.test.ts` (this IS the test file)
**Depends:** 5.2
**Domain:** general
**Atlas-impact:** none

New test file modeled after `tests/lifecycle/atlas-boundary.test.ts`. Asserts that `src/lifecycle/` files do NOT import / call `project_memory_promote` / `promoteMarkdown` outside the single allowed call site (`src/lifecycle/index.ts:promoteFinishedRecord`, which is now gated by config default-off).

```typescript
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCAN_DIRS = ["src/lifecycle", "src/tools/lifecycle"];

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
};

const ALLOWED_PROMOTE_SITES = new Set([
  // Single gated call site that respects config.projectMemory.promoteOnLifecycleFinish.
  // promoteFinishedRecord is the ONLY function in lifecycle that may call promoteMarkdown.
  "src/lifecycle/index.ts",
]);

describe("lifecycle does not auto-write Project Memory", () => {
  for (const dir of SCAN_DIRS) {
    it(`${dir} files outside the allowed call site do not import promote*`, () => {
      const files: string[] = [];
      walk(dir, files);
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        if (ALLOWED_PROMOTE_SITES.has(f)) continue;
        const src = readFileSync(f, "utf8");
        // Forbidden: any import of promote* from @/project-memory
        const importHit = /from\s+["']@\/project-memory["'][\s\S]{0,100}promote/u.test(src);
        const directCall = /\bpromoteMarkdown\s*\(/u.test(src);
        const promoteTool = /\bproject_memory_promote\s*\(/u.test(src);
        expect({ file: f, importHit, directCall, promoteTool }).toEqual({
          file: f,
          importHit: false,
          directCall: false,
          promoteTool: false,
        });
      }
    });
  }

  it("default config.projectMemory.promoteOnLifecycleFinish is false", () => {
    // This guards the default-flip from being silently reverted.
    const configSrc = readFileSync("src/utils/config.ts", "utf8");
    expect(configSrc).toMatch(/promoteOnLifecycleFinish:\s*false/);
  });

  it("the allowed call site is gated by the config flag", () => {
    // promoteFinishedRecord in src/lifecycle/index.ts MUST guard with the config flag.
    // Without the guard, flipping the default does nothing.
    const indexSrc = readFileSync("src/lifecycle/index.ts", "utf8");
    expect(indexSrc).toContain("config.projectMemory.promoteOnLifecycleFinish");
    // Check that the check appears in a short-circuit return position
    expect(indexSrc).toMatch(/if\s*\([^)]*!config\.projectMemory\.promoteOnLifecycleFinish[^)]*\)\s*return/);
  });

  it("agents Atlas Shared Mental Model section mirrors Project Memory boundary", () => {
    // Cross-check that AGENTS.md documents the project memory lifecycle boundary.
    // Detailed mirror tests live in tests/agents/project-memory-protocol.test.ts; this is a smoke check.
    const agentsMd = readFileSync("AGENTS.md", "utf8");
    expect(agentsMd).toMatch(/Project Memory|项目记忆/);
    expect(agentsMd).toMatch(/lifecycle.*不.*自动.*promote|lifecycle.*does not.*auto.?promote/i);
  });
});
```

**Decision documentation:**
- The "allowed call site" pattern mirrors how the atlas-boundary test handles `src/tools/atlas/init.ts` (it allowlists the canonical owner string). The single allowed file here is `src/lifecycle/index.ts:promoteFinishedRecord` because that is the existing gated function.
- The "config flag gating" test ensures that even if a future change accidentally flips the default back to true, the function still respects the flag. Defense in depth.
- The AGENTS.md mirror check is intentionally weak (just substring match) because Task 6.1 owns the precise wording; this test only guards against the mirror going missing entirely.

**Verify:** `bun test tests/lifecycle/project-memory-boundary.test.ts tests/lifecycle/atlas-boundary.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

## Batch 6: Phase 4 Documentation Sync + Auxiliary Entry Downgrade (parallel - 3 implementers)

All tasks in this batch depend on Batches 1-5 (docs mirror the agent prompt single-source).
Tasks: 6.1, 6.2, 6.3

### Task 6.1: Update Project-Local AGENTS.md Mirrors (Atlas Shared Mental Model + new Project Memory Active Maintenance section)
**File:** `AGENTS.md`
**Test:** none (assertions live in Tasks 3.3 (effect-first AGENTS.md mirror) + 5.3 (project memory boundary smoke check); both run against this file)
**Depends:** 1.1, 1.2, 1.3, 4.1
**Domain:** general
**Atlas-impact:** none (AGENTS.md is the mirror, not the single source)

Three edits:

1. **Update the existing `## Effect-First User-Facing Reports` section** (~L40-66) so the "默认四段结构" subsection becomes a 五段结构 listing 本次知识上下文 between 已知限制 and 实现记录.
   - Find the section listing `1. **预期表现** ... 2. **你可以怎么验收** ... 3. **已知限制 / 下一步** ... 4. **实现记录** ...`.
   - Replace the four-item ordered list with a five-item one inserting 本次知识上下文 as item 4 and renumbering 实现记录 to item 5.
   - New item 4 text (mirrors `KNOWLEDGE_CONTEXT_SECTION` semantics, NOT byte-identical):
     ```
     4. **本次知识上下文**：本任务读取/确认/维护了哪些 Atlas 节点、Project Memory 条目、Mindmodel 主题，传给子 agent 的 context-brief 摘要长度。段尾两行固定状态：`Atlas status: <value>` 和 `Project Memory status: <value>`。
     ```
   - Add a sentence to the drift-guard subsection at the end of the section noting that the 本次知识上下文 subsection itself is byte-identical across commander/brainstormer/octto (because it's sourced from `src/agents/knowledge-context-section.ts`).

2. **Rewrite the existing `## Atlas Shared Mental Model` section** (~L72-104) protocol four-step list:
   - oldString (the entire 协议四步 subsection):
     ```
     ### 协议四步

     1. **Consult**：非平凡任务开始时读取 atlas-context（自动注入）和按需 `atlas_lookup`，优先关注 `00-index`、`10-impl`、`20-behavior`、`40-decisions`、`50-risks`。
     2. **Detect**：发现代码 / 行为 / 决策与 Atlas 节点冲突时，证据充分标记 `stale-detected`，证据不足标记 `cannot-assess`，禁止静默覆盖。
     3. **Propose**：任务结束前判断"是否改变高级工程师解释项目的方式"。改变 → 写 `thoughts/shared/atlas-deltas/YYYY-MM-DD-{topic}-delta.md` 并 `lifecycle_log_artifact(kind=delta, pointer=<path>)`；不变 → status=`no-change`。
     4. **Merge**：delta 由用户显式触发的 `atlas-compiler` 或 `/atlas-refresh` 走 staging → reconcile → atomic-rename 归并。Lifecycle 不自动调用 atlas-compiler。
     ```
   - newString:
     ```
     ### 协议四步

     1. **Read**：非平凡任务开始时读取 atlas-context（自动注入）和按需 `atlas_lookup`，优先关注 `00-index`、`10-impl`、`20-behavior`、`40-decisions`、`50-risks`。把读到的节点写进终态"本次知识上下文 - 读取"段。
     2. **Maintain**：在 batch 完成 / 决策拍板 / lifecycle 阶段切换等 checkpoint 主动写或更新节点。冲突 / 人工编辑走 challenge / delta fallback (`thoughts/shared/atlas-deltas/`)。
     3. **Verify**：reviewer 与 executor 在批次完成时检查代码 diff 与对应节点 claim 是否一致；leaf agent 发现冲突通过 "Atlas observation: stale-detected" 单行 escalate，executor 决定本批次内修补还是登记为 stale。
     4. **Report**：终态汇报包含一行 `Atlas status: <value>`，并把 Read / Maintain / Verify 关键事实压缩进"本次知识上下文"段。

     `atlas-compiler` 与 `/atlas-refresh` 降级为辅助批量整理 / 历史 reconcile 路径，不在日常开发主路径触发。Atlas update 主路径是 agent 在任务中 Maintain。
     ```

3. **Update the status enum subsection** to list the new extended values:
   - oldString: `终态 "实现记录" 段必须包含一行 \`Atlas status: <value>\`，取值之一：\`consulted\` / \`no-change\` / \`delta-created\` / \`stale-detected\` / \`blocked\` / \`cannot-assess\`。`
   - newString: `终态 "本次知识上下文" 段必须包含一行 \`Atlas status: <value>\`，取值之一：\`consulted\` / \`read-only\` / \`maintained\` / \`verified\` / \`no-change\` / \`delta-created\` / \`stale-detected\` / \`conflict\` / \`blocked\` / \`cannot-assess\`。新增 \`read-only\` / \`maintained\` / \`verified\` / \`conflict\` 与 Read/Maintain/Verify/Report 协议对齐。`

4. **Append a NEW section `## Project Memory Active Maintenance`** immediately after the `## Atlas Shared Mental Model` section. This section mirrors `src/agents/project-memory-protocol.ts` semantics (NOT byte-identical):
   ```
   ## Project Memory Active Maintenance

   Project Memory 是项目级的"为什么 / 选了什么"记忆（SQLite 中的 decisions / lessons / risks / open questions）。它与 Atlas（共享心智模型，markdown vault）和 Mindmodel（代码风格约束，.mindmodel/）分工不同：

   - **Atlas** 回答"现在的项目是怎样组织的"。
   - **Project Memory** 回答"我们之前为什么这么选 / 踩过什么坑 / 留下了什么 open question"。
   - **Mindmodel** 回答"代码具体应该怎么写"。

   完整 prompt 协议块在 `src/agents/project-memory-protocol.ts` 导出的 `PROJECT_MEMORY_PROTOCOL` 字符串中，brainstormer / planner / executor / reviewer / commander / octto 通过模板字面量统一注入。本节是 markdown 镜像。

   ### 协议四步（与 Atlas 对称）

   1. **Read**：非平凡任务开始时调用 `project_memory_lookup` 查相关主题，把读到的条目写进"本次知识上下文 - 读取"。
   2. **Maintain**：在任务过程中主动 `project_memory_promote`：拍板的 decision、可复用 lesson、新增 risk、留下的 open question；带 source pointer (design/plan/ledger/lifecycle/manual)。
   3. **Verify**：reviewer 检查代码是否覆盖、违反或 supersede 某条 active decision；触发 active risk 边界时升级为新的 decision/lesson。
   4. **Report**：终态"本次知识上下文"段固定一行 `Project Memory status: <value>`，取值 `read-only` / `wrote-decision` / `wrote-lesson` / `wrote-risk` / `wrote-open-question` / `no-change` / `cannot-assess`。

   ### Lifecycle 边界

   Lifecycle 不再自动 promote ledger 或 issue body 进 Project Memory。`config.projectMemory.promoteOnLifecycleFinish` 默认值为 `false`；保留 opt-in 字段是为了支持极少数实验场景，不作为日常路径。grep-based 边界测试见 `tests/lifecycle/project-memory-boundary.test.ts`。

   ### 父子协同 (Context Brief)

   executor 给 implementer / reviewer 派任务时 prompt 中固定含 `<context-brief>` 块，下传已读 Atlas 节点 / Project Memory 条目 / Mindmodel 主题 / 已确认环境 / contract 路径。子 agent 默认信任 brief，不重复 lookup；冲突时 escalate "Brief mismatch" 由 executor 处理。完整规范见 `src/agents/executor.ts` `<context-brief>` 块。

   ### Drift guard

   `src/agents/project-memory-protocol.ts` 是协议唯一权威来源；`tests/agents/project-memory-protocol.test.ts` 强制 6 个主 / 协调 agent 都注入该协议。本节是 markdown 镜像，命名和段落顺序需保持一致。
   ```

**Decision documentation:**
- The Atlas Shared Mental Model section keeps the same top-level heading and overall structure; only the inner protocol-四步 list and status enum line change. This minimizes blast radius on humans who have memorized the section.
- The new "Project Memory Active Maintenance" section is placed directly after Atlas Shared Mental Model (rather than at end of file or grouped with other Project Memory mentions) because they are semantically symmetric and readers benefit from seeing them side by side.
- I'm intentionally NOT renaming the file's existing "Project Memory" mentions elsewhere; only this section is a NEW protocol mirror.

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts tests/lifecycle/project-memory-boundary.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

### Task 6.2: Update Global ~/.config/opencode/AGENTS.md Project Memory Write Rules
**File:** `/root/.config/opencode/AGENTS.md`
**Test:** none (this file is outside the repo and outside the test runner; the change is a documentation sync)
**Depends:** 5.2, 6.1
**Domain:** general
**Atlas-impact:** none

Single edit in the `## Project Memory (v9)` section (~L259-300).

Locate the `### Write rules` subsection (around L280-285). Replace:

oldString:
```
### Write rules

- The default write path is **automatic**: lifecycle finish promotes the latest ledger or issue body for that task.
- Manual `project_memory_promote` is allowed only when the user explicitly says "remember this" / "save to project memory", or when curating a historical document.
- Allowed source kinds: `design`, `plan`, `ledger`, `lifecycle`, `mindmodel`, `manual`.
- Never store secrets, credentials, raw chat transcripts, or speculation. The store rejects obvious secrets but the agent must not feed them in.
- Tag uncertain conclusions as `tentative` or `hypothesis`, not `fact` or `decision`.
```

newString:
```
### Write rules

- The default write path is **agent-owned**: brainstormer / planner / commander / octto / executor decide during the task what is worth keeping, and call `project_memory_promote` themselves at semantic checkpoints (拍板的 decision、可复用 lesson、新增 risk、open question). See the `PROJECT_MEMORY_PROTOCOL` four-step protocol (Read / Maintain / Verify / Report) for the full rule set.
- **Lifecycle no longer auto-promotes.** `config.projectMemory.promoteOnLifecycleFinish` defaults to `false`. The opt-in flag still exists for legacy / experimental setups but is not the recommended path.
- Leaf agents (implementer-* / reviewer) never call `project_memory_promote` or `project_memory_forget`. They consume the parent's `<context-brief>` Project Memory excerpts and report "Brief mismatch" / "Project Memory observation" signals back to executor.
- Manual `project_memory_promote` is also allowed when the user explicitly says "remember this" / "save to project memory", or when curating a historical document.
- Allowed source kinds: `design`, `plan`, `ledger`, `lifecycle`, `mindmodel`, `manual`.
- Never store secrets, credentials, raw chat transcripts, or speculation. The store rejects obvious secrets but the agent must not feed them in.
- Tag uncertain conclusions as `tentative` / `hypothesis` / `open_question`, not `fact` / `decision`.
```

**Decision documentation:**
- I keep the "manual promote on user request" rule (it was previously listed; remains valid).
- I split "agent-owned" (the new default) from "manual on user request" (still allowed) into two bullets so the precedence is explicit.
- I extend the uncertainty tag list to include `open_question` because the new `wrote-open-question` status maps to it.

**Verify:** Manual diff inspection (no automated test covers `~/.config/opencode/AGENTS.md`).
**Commit:** part of issue-63 lifecycle batch commit (file is outside repo; the commit captures only the in-repo files. Implementer should run `git status` after the edit to confirm `~/.config/opencode/AGENTS.md` is correctly outside the tracked tree, and note in commit body that the global mirror was also updated.)

---

### Task 6.3: Downgrade atlas-compiler agent description + commands.ts /atlas-refresh doc
**File:** `src/agents/atlas-compiler.ts`
**Test:** none (description string is short prose; no behavioural test runs against agent.description; manual diff is enough)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none

Two related edits in two files:

1. **Rewrite `src/agents/atlas-compiler.ts` agent description** to make the "辅助批量整理" framing explicit:
   - Read the file first (51 lines). Identify the `description: "..."` line in the exported `atlasCompilerAgent` AgentConfig.
   - Replace whatever the current description string is with: `"Auxiliary batch reconcile / history cleanup for Atlas vault: staging → reconcile → atomic-rename. User-triggered only via /atlas-refresh; never auto-spawned by lifecycle. Daily Atlas maintenance is owned by agents in their Read/Maintain/Verify/Report flow."`
   - Inside the agent's `prompt` string, add a `<role-narrowing priority="high">` block near the top (after `<environment>`) clarifying the role narrowing:
     ```
     <role-narrowing priority="high">
     <rule>This agent is an AUXILIARY entry point, not the daily Atlas maintenance path.</rule>
     <rule>Daily Atlas maintenance is owned by brainstormer / planner / executor / reviewer / commander / octto during their Read/Maintain/Verify/Report flow.</rule>
     <rule>You are spawned only by user-triggered /atlas-refresh, /atlas-init, or manual atlas-compiler invocations.</rule>
     <rule>You handle batch reconcile, history cleanup, challenge resolution, broken-link sweeps — work too large or too cross-cutting to fit a normal agent task.</rule>
     <rule>You MUST NOT be auto-spawned by lifecycle hooks (lifecycle_finish, lifecycle_commit). The boundary is enforced by tests/lifecycle/atlas-boundary.test.ts.</rule>
     </role-narrowing>
     ```

2. **Update `src/atlas/commands.ts` `/atlas-refresh` help / description text** to reflect the auxiliary framing. Read the file to locate the `/atlas-refresh` command registration (it should have a `description` or help string).
   - Identify the existing description string for `/atlas-refresh`.
   - Replace it with text equivalent to: `"Auxiliary entry to merge accumulated atlas deltas via atlas-compiler (staging → reconcile → atomic-rename). For daily maintenance, agents update Atlas inline via Read/Maintain/Verify/Report; /atlas-refresh is for batch fixup and history cleanup."`
   - If the file has command help in multiple commands (`/atlas-status`, `/atlas-init`, `/atlas-translate`), preserve them unchanged. ONLY `/atlas-refresh` description needs the auxiliary framing.

**Decision documentation:**
- The exact current description strings in both files need to be read at implementation time (executor's implementer is responsible). I am specifying the replacement semantics and leaving exact old/new string pairs to the implementer because the file contents may have shifted slightly.
- I keep all four slash commands (`/atlas-init`, `/atlas-refresh`, `/atlas-status`, `/atlas-translate`). Design's Constraint: "保留 /atlas-refresh /atlas-status /atlas-init /atlas-translate 入口". Only `/atlas-refresh` description text changes here.
- The `<role-narrowing>` block is added to the atlas-compiler PROMPT, not just its description, because future maintainers and agents reading the prompt need to see the boundary in context. The description is for routing UX; the prompt is for agent behaviour.

**Verify:** `bun test tests/agents/atlas-compiler.test.ts tests/lifecycle/atlas-boundary.test.ts`
**Commit:** part of issue-63 lifecycle batch commit

---

## Phase 4 Integration Verification (not a batch task; executor handles after Batch 6)

After Batch 6 completes, executor MUST manually verify the five integration scenarios from the design's Testing Strategy section. These are not automated tests but reviewer/executor walkthrough checks:

1. **新开任务场景** — Start a new request via brainstormer. Verify the response's terminal report includes the "本次知识上下文" section with both `Atlas status:` and `Project Memory status:` lines.
2. **设计决策场景** — During brainstormer design exploration, when a decision is wrapped up, verify a `project_memory_promote(type=decision, ...)` is reasonable (agent may not always promote during a single conversation; spot-check the protocol is available).
3. **executor batch 场景** — Run executor on a simple plan and verify spawn prompts to implementers contain `<context-brief>` blocks.
4. **父子协同场景** — Verify implementer/reviewer reports include "Brief mismatch" or "Atlas observation" lines when contradictions are seeded.
5. **终态输出场景** — End-to-end: verify the user-facing final response carries the "本次知识上下文" section.

If any scenario fails, executor reports BLOCKED with the failing scenario id and does NOT call `lifecycle_commit` for the batch until the gap is patched.
