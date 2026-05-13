---
title: 头脑风暴到计划到实现工作流
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:ARCHITECTURE.md
  - code:src/agents/brainstormer.ts
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
---
# 头脑风暴到计划到实现工作流

micode 面向 OpenCode 开发者提供一条固定主路径：先由 `brainstormer` 或 `octto` 把想法收敛成设计，再由 `planner` 生成微任务计划，最后由 `executor` 批量执行并审查。

## Mechanics

- 设计阶段强调 research before opinion，并把设计写入 `thoughts/shared/designs/`。
- 计划阶段把设计拆成 2-5 分钟粒度任务，包含路径、依赖、测试策略和 `Domain`。
- 实现阶段使用 implementer → reviewer 循环，并通过 [[子 Agent 派发工具]] 并行处理可并行任务。
- 非平凡交付可进入 [[Issue 驱动交付生命周期]]，以 issue、worktree、commit 和 merge 串起端到端状态。

## Links

- [[工作流 Agent]] 实现该行为。
