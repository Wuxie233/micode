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

## Links

- [[Workflow Agents]] 实现主流程角色。
- [[Artifact Indexing]] 支持历史检索。
