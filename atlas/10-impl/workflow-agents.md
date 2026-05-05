---
tags: [atlas, impl]
---
# Workflow Agents

`src/agents/commander.ts`、`brainstormer.ts`、`octto.ts`、`planner.ts`、`executor.ts`、`implementer*.ts` 与 `reviewer.ts` 定义 Brainstorm、Plan、Implement 的 agent 角色。

## Responsibilities

- `commander` 负责主流程判断和任务路由。
- `brainstormer` 与 `octto` 负责设计探索，产出 design artifacts。
- `planner` 把设计拆成微任务计划，并在跨前后端时生成冻结 contract。
- `executor` 按批次并行派发 implementer，并安排 reviewer 回合。
- domain implementers 执行具体任务，`reviewer` 只读检查结果、测试和 contract 一致性。

## Links

- 实现 [[Brainstorm Plan Implement Workflow]]。
- 支撑 [[Frozen API Contracts]] 与 [[Domain Routing with Frozen Contracts]]。
- 使用 [[Spawn Agent Tool]] 运行并行子任务。
