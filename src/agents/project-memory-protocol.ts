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
  - 改动是否覆盖、违反、或 supersede 某条 active decision？若是，reviewer 只在报告中标记冲突；executor / primary agent 决定是否通过 project_memory_promote 写入新的 decision / lesson，并按允许的 Project Memory status 汇报。
- 改动是否触发某条 active risk 的边界？若是，reviewer 只在报告中标记触发点；executor / primary agent 决定是否通过 project_memory_promote 写入新的 decision / lesson，并按允许的 Project Memory status 汇报。
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
