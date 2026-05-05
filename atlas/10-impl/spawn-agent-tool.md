---
tags: [atlas, impl]
---
# Spawn Agent Tool

`src/tools/spawn-agent/` 与 `src/tools/resume-subagent.ts` 实现并行子代理派发、失败分类、session 保存和恢复。

## Responsibilities

- `createSpawnAgentTool` 接收 canonical `{ agents: [...] }`，用并发批处理运行多个子任务。
- `SpawnSessionRegistry` 与 preserved registry 追踪 running、failed、blocked session。
- 分类结果包括 `success`、`task_error`、`blocked`、`hard_failure` 和 transient retry 相关状态。
- `resume_subagent` 用保存的 `session_id` 恢复失败或阻塞任务，而不是从零重派。
- 支持 per-call `model` override，并在创建 session 前校验模型引用。

## Links

- [[Workflow Agents]] 的 executor 使用该工具实现并行工作。
- [[Subagent Failure and Resume Drift]] 记录相关风险。
