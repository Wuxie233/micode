---
tags: [atlas, decision]
---
# BDD Behavior Layer

micode 采用轻量 BDD 防漂移层：用 design.md 末尾自由格式的 `## Behavior` 段作为用户可见行为承诺锚点，并把该锚点贯穿 planner、executor、reviewer 和终态汇报。

## Rationale

- [[Brainstorm Plan Implement Workflow]] 需要在需求讨论、计划拆分、并行实现、审查和终态汇报之间保留同一个行为语义边界。
- 自由格式 `## Behavior` 对个人开发足够轻，不强制 Gherkin / `.feature` 文件 / 覆盖率仪表盘。
- `## 行为承诺映射`、context-brief 行为指向和 reviewer「行为一致性」检查能降低 plan 拆漏、implementer 过度扩展、reviewer 漏看行为漂移的概率。
- Atlas / Project Memory 维护仍由 agent 在既有协议 checkpoint 显式判断，不引入 lifecycle 自动 sink-to-Atlas 或新的 Project Memory entity 前缀约定。

## Consequences

- `brainstormer` finalizing 应在非 quick-mode 设计中主动产出 `## Behavior`，并用 `atlas_lookup` 评估相关 atlas/20-behavior 节点。
- `planner` 必须在 plan.md 开头写 `## 行为承诺映射`；漏覆盖的 Behavior 要说明理由，但不新增 task 字段。
- `executor` 必须把每个 task 对应的行为承诺写进 `<context-brief>`，并在 batch reviewer 通过后报告 `Atlas 行为节点审视`。
- `reviewer` 必须在 `**Findings**` 中包含「行为一致性」子项；明显漂移才升级 `CHANGES REQUESTED`，可复用 lesson 由 executor / primary 决定是否 promote。
- `brainstormer` 与 `commander` 的 `<effect-first-reporting>` 保持 byte-identical；行为对齐规则只改变五段内容生成，不新增终态 section。
