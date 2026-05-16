---
title: 子 Agent 派发工具
tags: [atlas, impl]
sources:
  - code:src/tools/spawn-agent/*
  - code:src/tools/resume-subagent.ts
---
# 子 Agent 派发工具

`src/tools/spawn-agent/*` 与 `src/tools/resume-subagent.ts` 实现 coordinator 到 subagent 的并行派发、失败分类、session preservation 和恢复能力。

## 职责

- 支持一次请求派发多个 subagents，并以 all-settled 语义返回结果表。
- 对 transient、task error、blocked 和 hard failure 做分类。
- `spawn_agent` transient retry 由 `config.subagent.transientRetryBudgetMs` 约束累计预算；默认 45 秒，在下一次 sleep 或下一次 attempt 前检查 wall-clock elapsed，预算耗尽时停止继续累计 backoff。
- 为可恢复失败保留 `session_id`，供 `resume_subagent` 继续同一上下文。
- 限制 primary agent 的模型覆盖逃生口，避免任意 agent 滥用模型选择。

## Retry budget 边界

45 秒预算只覆盖 micode-controlled `retryOnTransient` 外层 orchestration。它不会取消已经进入 `ctx.client.session.prompt(...)` 的 provider/internal in-flight wait；该层需要单独的 cancellation / timeout 设计。

## 链接

- [[子 Agent 失败与恢复漂移]] 记录恢复链路中的上下文漂移风险。
- [[工作流 Agent]] 的 executor 和 atlas initializer 都依赖该工具实现并行。
