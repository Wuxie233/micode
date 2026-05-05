---
tags: [atlas, behavior]
---
# Frozen API Contracts

当计划同时包含 frontend 和 backend 任务时，`planner` 会生成冻结 API contract，确保并行实现时双方遵守同一接口边界。

## Mechanics

- contract 文件写入 `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md`。
- `executor` 把 contract path 注入 implementer 和 reviewer prompt。
- implementer 发现需求与 contract 冲突时应升级问题，不私自修改 contract。
- reviewer 在有 contract path 时检查 endpoint、HTTP method、schema 和响应形状是否一致。

## Links

- [[Workflow Agents]] 负责生成和传播 contract。
- [[Domain Routing with Frozen Contracts]] 解释为什么采用冻结边界。
