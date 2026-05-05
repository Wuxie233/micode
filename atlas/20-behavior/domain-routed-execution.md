---
tags: [atlas, behavior]
---
# Domain Routed Execution

每个 plan task 都带 `Domain` 字段，`executor` 按领域把任务交给 `implementer-frontend`、`implementer-backend` 或 `implementer-general`。

## Mechanics

- `frontend` 任务面向 UI、样式、浏览器交互和客户端状态。
- `backend` 任务面向 API、数据层、中间件、服务和基础设施。
- `general` 任务面向配置、共享类型、脚本和跨切面变更。
- 用户可以在 `micode.json(c)` 中给不同 agent 配置不同模型，模型覆盖由 [[Config Loader]] 校验。

## Links

- [[Workflow Agents]] 执行领域派发。
- [[Agent Registry]] 注册三个 specialist implementers。
- [[Domain Routing with Frozen Contracts]] 记录相关决策。
