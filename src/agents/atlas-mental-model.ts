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
机器语法保留英文：frontmatter keys、IDs、wikilink syntax ([[...]])、file paths、tool names、command names、source pointers (code:.../lifecycle:.../thoughts:...)、test names、code symbols。
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
