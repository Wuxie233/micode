# Micode Project AGENTS.md

This file holds project-local agent guidance. Global agent policy still lives in `~/.config/opencode/AGENTS.md` and applies on top of this file.

## Design Philosophy

设计哲学约束（低耦合 / 模块化 / 高复用 / 轮子优先）的唯一权威来源是 `.mindmodel/architecture/coupling-reuse.md`。任何 brainstormer / planner / reviewer 阶段的设计或实现决策都应通过 `mindmodel_lookup` 读取该文件，不要在 prompt 或本文件中复制粘贴完整内容，避免三处 drift。

## User-Triggered Specialist Agents

micode 在主工作流（brainstormer / planner / executor）和对抗审查（critic）之外，提供五个用户显式召唤的专家辅助 agent。它们都是 read-only 子 agent，不进入 executor 循环，不参与 output-class 路由，不默认运行。

| Agent id | 中文角色 | 用途 |
|---|---|---|
| `product-manager` | 产品经理 | 需求模糊时把请求收敛成 PRD（用户故事 / Given-When-Then / Non-Goals）。最多 3 个澄清问题，每个带 A/B/C/D/E 选项与推荐默认。 |
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
