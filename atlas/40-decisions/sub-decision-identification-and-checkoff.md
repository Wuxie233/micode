---
title: Sub-decision Identification 与 Requirement Check-off（子决策识别与需求核对）（子决策识别与需求核对）
tags: [atlas, decision]
sources:
  - thoughts:thoughts/shared/designs/2026-05-14-sub-decision-and-requirement-checkoff-design.md
  - thoughts:thoughts/shared/plans/2026-05-14-sub-decision-and-requirement-checkoff.md
  - thoughts:thoughts/shared/designs/2026-05-15-question-tool-first-routing-design.md
  - thoughts:thoughts/shared/plans/2026-05-15-question-tool-first-routing.md
  - code:src/agents/brainstormer.ts
  - code:src/agents/commander.ts
  - code:src/agents/octto.ts
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
  - code:src/agents/reviewer.ts
  - code:AGENTS.md
---
# Sub-decision Identification 与 Requirement Check-off（子决策识别与需求核对）（子决策识别与需求核对）

## 决策

非 quick-mode 的新需求讨论中，`brainstormer` 必须在 understanding 之后、exploring 之前主动识别 architectural sub-decision，并按现有 `Interactive Question Tools` 三档 channel selection 表（question-tool-first：极轻量 plain chat / 默认结构化走内置 `question` 工具 / 重型走 octto）批量询问用户；6-8 题的 architectural sub-decision 默认走内置 `question` 工具批量推送，**不**跳浏览器。执行阶段不得再为这类遗漏决策打断用户，而是使用保守默认并在终态汇报 surface。终态汇报在 design.md 含 `## 承诺清单 / Commitments` 时，必须在「你可以怎么验收」内给出「需求核对表」。

## 理由

- BDD Behavior Layer（行为防漂移层） 约束的是最终用户可见行为，但不能单独覆盖「max / default / 阈值 / 策略 / 命名 / 数据模型 / 外部依赖 / breaking 与否」这类 architectural sub-decision 是否在事前问全。
- 执行阶段重新追问用户会破坏 planner / executor / reviewer / leaf agent 的批量执行体验，所以遗漏只能走最保守、最不破坏现有结构、最易回滚的默认值，并在终态明确列出。
- `## 承诺清单 / Commitments` 与「需求核对表」让最终汇报主动对照用户原始要求，而不是只汇报实现过程或仓库操作结果。

## 影响

- `brainstormer.ts` 持有 `<sub-decision-identification>` 单源规则，并在 design.md 模板中支持 `Commitments` 可选段。
- `brainstormer.ts` 与 `commander.ts` 的 `<effect-first-reporting>` 继续保持 byte-identical；新增的「需求核对表」与「本次按默认决定的事项」只是既有五段内部子结构，不新增终态 section。
- `octto.ts` 只做语义对齐，不与 commander byte-identical。
- `planner.ts`、`executor.ts`、`reviewer.ts` 各自独立持有 `<no-mid-execution-interrupt>` 规则；这些规则用 grep-based drift guard 保护，禁止新增 byte-identical 镜像。
- `tests/agents/sub-decision-and-checkoff.test.ts` 只做关键字符串守护和负向非镜像断言，不引入承诺清单格式校验器或覆盖率仪表盘。
- 2026-05-15 question-tool-first routing（issue #80）：`Interactive Question Tools` 路由表从两档（plain chat / Octto）升级为三档（plain chat / 内置 `question` 工具 / Octto），内置 `question` 工具成为默认主路径；plain chat 退守极轻量端点；Octto 退守长 review / 多分支 brainstorm / pick-many >8 / 异步等待。`/all-rebuild` 覆盖确认通道由 planner 决定，**是否必须显式确认**这一硬约束不变。本节点持有该决策，不新增 `atlas/40-decisions/question-tool-first-routing.md`。
