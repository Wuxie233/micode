# Micode Project AGENTS.md

This file holds project-local agent guidance. Global agent policy still lives in `~/.config/opencode/AGENTS.md` and applies on top of this file.

## Design Philosophy

设计哲学约束（低耦合 / 模块化 / 高复用 / 轮子优先）的唯一权威来源是 `.mindmodel/architecture/coupling-reuse.md`。任何 brainstormer / planner / reviewer 阶段的设计或实现决策都应通过 `mindmodel_lookup` 读取该文件，不要在 prompt 或本文件中复制粘贴完整内容，避免三处 drift。

## User-Triggered Specialist Agents

micode 在主工作流（brainstormer / planner / executor）和对抗审查（critic）之外，提供五个用户显式召唤的专家辅助 agent。它们都是 read-only 子 agent，不进入 executor 循环，不参与 output-class 路由，不默认运行。

| Agent id | 中文角色 | 用途 |
|---|---|---|
| `product-manager` | 产品经理 | 需求模糊时用产品经理判断把请求收敛成 PRD：问题框定（Problem/Opportunity）、利益相关者、成功度量、范围边界（In/Out of Scope）、风险与假设、决策建议（build / build with adjustments / do not build 或 defer），保留 user stories 与 Given-When-Then 验收。最多 3 个澄清问题，每个带 A/B/C/D/E 选项与推荐默认；证据不足处显式 Cannot Assess。 |
| `software-architect` | 软件架构师 | 架构 / 数据模型 / 跨模块决策时给出 2-3 个备选方案、显式权衡和推荐选项；强制走 mindmodel_lookup / atlas_lookup 锚定耦合面。 |
| `ux-designer` | UX 设计师 | UI/UX 不满或新 UI 设计时按 WCAG 2.2 / Material Design 3 / Apple HIG / Core Web Vitals / Nielsen 10 / AI 透明性原则评审，按 severity (0-4) × frequency × business impact 排序。 |
| `architecture-quality-inspector` | 架构质检 | 对架构方案做质检：SOLID、循环依赖、抗模式、耦合约束；输出 P0/P1/P2/P3 finding 与三种终态判定（APPROVED / APPROVED with required fixes / CHANGES REQUESTED）。 |
| `rubric-reviewer` | Rubric 评审 | 对方案做多维评分：每维度 Excellent / Good / Acceptable / Poor / Failed，强制证据引用，不输出 1-10 总分。 |

### Dispatch rules

- User-triggered only。用户必须显式说「派产品经理」「派 UX 设计师」「summon software-architect」之类，主 agent 才能调用对应 subagent。任何情况下不允许 auto-spawn（never auto-spawn）。
- 主 agent 在合适阶段最多一次提示一行可派哪个 specialist；用户不响应或说继续就不再提（at most once per phase）。
- Specialists are NOT part of output-class routing. 不要为它们添加 `<output-class agent="...">` 路由块；它们与 location / explanation / diagnosis / mutation 分离。
- Specialists 不进入 executor 的 reviewer 循环。它们的 APPROVED / CHANGES REQUESTED / verdict 文字仅是人类综合材料，不是循环控制信号。
- 多 specialist 并行：用户明确同时召唤时最多 2 个并行；超过会出现 prompt fatigue 与综合困难。
- 主 agent 整合 specialist 输出后停留在讨论阶段；只有用户明确说「go / 进入落地 / proceed」才进入 lifecycle / planner / executor。

### Why these are NOT in output-class routing

`<routing-by-requested-output>` 把请求按"输出类别 + 是否带副作用"分到 location / explanation / diagnosis / mutation / direct-execution。Specialists 是用户的决策辅助，不是某种"输出类别"，也没有 mutation 副作用——把它们塞进 output-class 会污染既有路由语义并诱使主 agent auto-spawn。这是已知的 anti-pattern，明确禁止。

### Drift guard

`brainstormer.ts` 与 `commander.ts` 中的 `<specialist-dispatch>` 块为同一来源，必须 byte-identical（由 `tests/agents/specialist-routing.test.ts` 强制）；本节是 markdown 镜像，命名和语义需保持一致。

## Effect-First User-Facing Reports

主 agent（commander / brainstormer / octto）在用户可见的终态汇报里，必须把表达中心从"我做了什么"切到"你会看到什么效果，以及怎么验证它"。详细 prompt 规则见 `src/agents/commander.ts`、`src/agents/brainstormer.ts`、`src/agents/octto.ts` 的 `<effect-first-reporting>` block；本节是 markdown 镜像，给后续 prompt 编辑一个单源说明。

### 默认四段结构

终态汇报按以下顺序输出，section 标题用以下中文原文：

1. **预期表现**：用户现在会看到什么行为。1 句话或 2-3 个 bullet，说"是什么"不说"改了哪个文件"。
2. **你可以怎么验收**：用户用 2-4 个步骤自己验证（打开某页 / 跑某命令 / 检查某输出），不是 agent 内部 verify 脚本。
3. **已知限制 / 下一步**：没完成的部分、需要用户手动处理的事、已知边界。没有就写"无"。
4. **实现记录**：commit / 测试 / issue / batch / 子任务等过程产物压缩为 1-2 行。

### Blocked / failed-stop 例外

- **blocked**：先输出"为什么阻塞"和"用户需要做什么"，再讲已完成的部分。不要让用户翻到末尾才发现下一步要他做什么。
- **failed-stop**：先输出失败结论和恢复建议，再讲过程产物。

### 何时不强行套模板

- 纯查询 / 状态查询 / 单行回答类任务可以一句话完成。
- 中间 checkpoint（不是终态）不需要套四段；只在用户可见的终态汇报触发。
- 用户明确要求"展开 commit / 测试 / 子任务"时，"实现记录"段可以展开到正常长度，但"预期表现"和"你可以怎么验收"仍然在前。

### 与其它规则的关系

- **不替代 completion-notify (QQ)**：QQ 是带外 ≤200 字符短消息；本节作用对象是 OpenCode 对话里的回复内容。
- **不替代 intent-classification**：新请求第一回合"意图: ..."声明仍然写在响应顶端，是 UX 路由信号，不是终态汇报。
- **不改变 executor / reviewer / planner 等 subagent 的内部报告格式**：subagent 仍然返回完整结构化输出，primary agent 在综合给用户时按本节压缩。

### Drift guard

`commander.ts` 与 `brainstormer.ts` 的 `<effect-first-reporting>` block 互为单源，必须 byte-identical（由 `tests/agents/effect-first-reporting.test.ts` 强制）。`octto.ts` 因 workflow 不同使用语义对齐但措辞贴合 octto 角色的版本，drift-guard 不强制 byte-identity，但仍然检查四个 section 标题和 blocked / failed-stop 例外存在。本节是 markdown 镜像，命名和段落顺序需保持一致。

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

## Knowledge Bootstrap Commands

micode 提供三条零参数 orchestrator 命令，用单一入口建立 / 大更新 / 体检三层项目知识库 (`/init` → `ARCHITECTURE.md` + `CODE_STYLE.md`；`/mindmodel` → `.mindmodel/`；`/atlas-init` → `atlas/`)。三条命令均路由到 `knowledge-bootstrap-orchestrator` agent，由该 agent 按 mode 串行调度现有 `project-initializer` / `mm-orchestrator` / `atlas-initializer` 子流程。

| 命令 | Mode | 行为 |
|---|---|---|
| `/all-init` | missing-only | 检测三层状态；仅建立缺失部分，已有的层不动 |
| `/all-rebuild` | refresh-all | 列出会被覆盖的文件并 octto confirm；确认后串行重建三层（force-rebuild 语义） |
| `/all-status` | status-only | 只读体检：三层是否存在 + atlas 健康度 + Project Memory 摘要，不写任何文件 |

### Dispatch rules

- 三条命令零参数。不引入 `--flag`，每个 mode 一个独立命令。
- 不替换 `/init`、`/mindmodel`、`/atlas-init`、`/atlas-status`、`/atlas-refresh`。这些原有命令继续可独立使用。
- 串行执行：`project-initializer` → `mm-orchestrator` → `atlas-initializer`，依赖顺序由后两阶段读取前阶段文件决定。禁止并发。
- 中间失败不回滚：任一子 agent 失败时已完成阶段保留，用户复跑 `/all-init` 智能补齐。
- `/all-rebuild` 必须显式 confirm，否则不动文件。
- octto 问卷在 orchestrator 入口一次性收集（`intent.pitch` / `intent.user` / `intent.shape`），下传给 `atlas-initializer` 的 spawn prompt，避免重复询问。octto 不可用时用 `DEFAULT_BOOTSTRAP_ANSWERS` 兜底并 warn。

### Output discipline

每次执行后必须输出"本次知识上下文"板块（参见 `src/agents/knowledge-context-section.ts` 的 `KNOWLEDGE_CONTEXT_SECTION` 单源），列出本次任务读取与维护的知识来源。`/all-status` 之外的模式还需输出 commander effect-first 的四段终态汇报（预期表现 / 你可以怎么验收 / 已知限制 / 实现记录）。

### Drift guard

`src/agents/knowledge-bootstrap-orchestrator.ts`、`src/tools/knowledge-bootstrap/`、`src/index.ts` 中 `PLUGIN_COMMANDS` 的 `all-init` / `all-rebuild` / `all-status` 条目是单源；本节是 markdown 镜像，drift 由 `tests/agents/agents-md-knowledge-bootstrap.test.ts` 强制。
