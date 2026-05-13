---
tags: [atlas, behavior]
---
# Brainstorm Plan Implement Workflow

用户可见的核心流程是 `Brainstorm → Plan → Implement`，先把想法变成设计，再拆成可执行微任务，最后由 executor 并行推进实现和审查。

## Mechanics

- Brainstorm 阶段通过 `brainstormer` 或 `octto` 细化需求，产物写入 `thoughts/shared/designs/`。
- Plan 阶段把设计转成 2 到 5 分钟粒度的任务计划，任务带精确路径、依赖批次和 `Domain` 字段。
- Implement 阶段由 `executor` 按 batch 派发 implementer，并运行 implementer 到 reviewer 的闭环。
- 历史计划和 ledger 会被索引，后续可通过 `/search` 或 `artifact_search` 找回。
- 轻量 BDD 防漂移层把用户可见行为承诺追加到 design.md 第 10 个可选段 `## Behavior`；quick-mode / 运维 / executor-direct / 用户显式跳过时可省略。
- Planner 在 plan.md 开头生成 `## 行为承诺映射`，用自然语言把每条 Behavior 映射到 task 或说明不需要 task 的理由，不新增 task 字段。
- Executor 派 leaf agent 时在 `<context-brief>` 下传本 task 对应的行为承诺；每个 batch reviewer 通过后做一次 `Atlas 行为节点审视`，判断是否维护 atlas/20-behavior。
- Reviewer 在 `**Findings**` 中检查「行为一致性」，明显漂移时升级为 `CHANGES REQUESTED`，可复用漂移教训只通过 `Behavior observation: drift-lesson` 上报给 executor / primary 决定是否写 Project Memory。
- 终态汇报的「预期表现」和「你可以怎么验收」需要与 design.md `## Behavior` 语义一致，但不新增 `Scenario coverage: N/M` 状态行。

## Links

- [[Workflow Agents]] 实现主流程角色。
- [[Artifact Indexing]] 支持历史检索。
- [[BDD Behavior Layer]] 记录轻量行为驱动防漂移的取舍。
