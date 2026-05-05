---
tags: [atlas, decision]
---
# Domain Routing with Frozen Contracts

micode fork 把旧的单一 implementer 拆成 `implementer-frontend`、`implementer-backend` 和 `implementer-general`，并在跨前后端计划中引入冻结 API contract。

## Rationale

- [[Domain Routed Execution]] 允许不同领域使用更匹配的模型和 prompt 约束。
- [[Frozen API Contracts]] 降低并行前后端实现时的接口漂移。
- reviewer 能以同一 contract 作为事实边界检查实现。

## Consequences

- `planner` 必须可靠标记 `Domain` 并在跨域时写 contract。
- `executor` 必须把 contract path 注入 implementer 和 reviewer。
- 单入口修复容易遗漏 `brainstormer`、`octto`、`commander` 或 executor-direct 的路径一致性。
