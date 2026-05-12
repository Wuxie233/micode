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
机器语法保留英文：frontmatter keys、IDs、wikilink syntax ([[...]]), file paths、tool names、command names、source pointers (code:.../lifecycle:.../thoughts:...)、test names、code symbols。
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
