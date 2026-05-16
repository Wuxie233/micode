---
title: 头脑风暴到计划到实现工作流
tags: [atlas, behavior]
sources:
  - thoughts:thoughts/shared/designs/2026-05-15-question-tool-first-routing-design.md
  - code:README.md
  - code:ARCHITECTURE.md
  - code:src/agents/brainstormer.ts
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
  - code:src/agents/reviewer.ts
  - code:src/agents/commander.ts
---
# 头脑风暴到计划到实现工作流

micode 面向 OpenCode 开发者提供一条固定主路径：先由 `brainstormer` 或 `octto` 把想法收敛成设计，再由 `planner` 生成微任务计划，最后由 `executor` 批量执行并审查。

## 机制

- 设计阶段强调 research before opinion，并把设计写入 `thoughts/shared/designs/`；brainstormer 在 finalizing 阶段必须主动产出 design.md 末尾的轻量 BDD 防漂移层 `## Behavior` 段（quick-mode / 运维 / executor-direct / 用户显式跳过时可省略整段）。
- Primary agent 对敏感面采用默认保守规则：改变 `agent routing`、`tool permissions`、`lifecycle rules`、`slash command contract`、`runtime boot registration`、`deploy/restart policy` 或跨模块行为的请求仍走 lifecycle + planner + executor；只有当用户明确要求 direct、目标与验证明确、side-effect boundary 清楚，且只是 typo / wording / local config / missing import 等不改变行为 contract 的机械小修时，才可作为 explicit bounded exception 派 `executor-direct`。runtime 源码小修未执行 `bun run deploy:runtime` 时，终态报告必须说明 live OpenCode runtime 尚未部署生效。
- Brainstormer 在 gathered codebase context 后、进入 exploring 前执行 `sub-decision-identification` checkpoint：对照启发式扩展清单（数字参数、max / default / 阈值、策略、命名 contract、数据模型、外部依赖、breaking 与否和 `Decision Autonomy` ASK 类）枚举 architectural sub-decision，并按 `Interactive Question Tools` 三档 channel selection 表（question-tool-first：极轻量 plain chat / 默认走内置 `question` 工具 / 重型走 octto）批量询问用户；默认情况下结构化的 6-8 题 sub-decision 走内置 `question` 工具，**不**跳浏览器。
- Brainstormer 写 design.md 时，可在 frontmatter 之后、`## Problem Statement` 之前产出 `## 承诺清单 / Commitments`，记录用户原话、已确认 sub-decision 与可核对承诺；终态汇报的「你可以怎么验收」在存在该段时必须包含「需求核对表」，用 `✓ / ⚠️ / ✗` 对照承诺逐条 surface。
- 计划阶段把设计拆成 2-5 分钟粒度任务，包含路径、依赖、测试策略和 `Domain`；planner 在 plan.md 开头生成 `## 行为承诺映射`，用自然语言把每条 Behavior 映射到 task 或说明不需要 task 的理由，不新增 task 字段。
- 实现阶段使用 implementer → reviewer 循环，并通过 [[子 Agent 派发工具]] 并行处理可并行任务；Executor 派 leaf agent 时在 `<context-brief>` 下传本 task 对应的行为承诺；planner / executor / reviewer / implementer 若发现 brainstorm 阶段漏识别 architectural sub-decision，必须用保守默认继续，不打断用户，并由 executor 聚合「本次按默认决定的事项」回传给 primary 终态汇报；每个 batch reviewer 通过后做一次 `Atlas 行为节点审视`，判断是否维护 atlas/20-behavior。
- Reviewer 在 `**Findings**` 中检查「行为一致性」子项，明显漂移时升级为 `CHANGES REQUESTED`，可复用漂移教训只通过 `Behavior observation: drift-lesson` 上报给 executor / primary 决定是否写 Project Memory（不直接 promote）。
- 终态汇报的「预期表现」和「你可以怎么验收」需要与 design.md `## Behavior` 语义一致，但不新增 `Scenario coverage: N/M` 状态行，五段结构不变。
- 历史计划和 ledger 会被索引，后续可通过 `/search` 或 `artifact_search` 找回。
- 非平凡交付可进入 [[Issue 驱动交付生命周期]]，以 issue、worktree、commit 和 merge 串起端到端状态。

## 链接

- [[工作流 Agent]] 实现该行为。
- [[Issue 驱动交付生命周期]] 承载非平凡任务的端到端状态。
- [[BDD Behavior Layer（行为防漂移层）]] 记录轻量行为驱动防漂移的取舍。
