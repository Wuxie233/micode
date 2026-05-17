---
title: 子 Agent 派发工具
tags: [atlas, impl]
sources:
  - code:src/tools/spawn-agent/*
  - code:src/tools/resume-subagent.ts
  - code:src/agents/context-capsule/*
---
# 子 Agent 派发工具

`src/tools/spawn-agent/*` 与 `src/tools/resume-subagent.ts` 实现 coordinator 到 subagent 的并行派发、失败分类、session preservation 和恢复能力。

## 职责

- 支持一次请求派发多个 subagents，并以 all-settled 语义返回结果表。
- 对 transient、task error、blocked 和 hard failure 做分类。
- `spawn_agent` transient retry 由 `config.subagent.transientRetryBudgetMs` 约束累计预算；默认 45 秒，在下一次 sleep 或下一次 attempt 前检查 wall-clock elapsed，预算耗尽时停止继续累计 backoff。
- 为可恢复失败保留 `session_id`，供 `resume_subagent` 继续同一上下文。
- 限制 primary agent 的模型覆盖逃生口，避免任意 agent 滥用模型选择。
- `spawn-agent` runtime 只把父层传入的 `ContextCapsuleRef` 作为 prompt prefix 注入；v2 的 `conversation_anchor`、`dispatch_kind`、`generated_by`、`parent_capsule` 保持对工具透明，由 primary/coordinator 负责 find / freshness / build 周期。

## Retry budget 边界

45 秒预算只覆盖 micode-controlled `retryOnTransient` 外层 orchestration。它不会取消已经进入 `ctx.client.session.prompt(...)` 的 provider/internal in-flight wait；该层需要单独的 cancellation / timeout 设计。

## 与 workflow-retry 的边界

`spawn_agent` 的 45 秒 budget 是 coordinator → subagent 派发链路的 inner retry，只处理派发期间的 transient 分类和 same-session preservation。[[工作流 Continuation Retry]] 是 built-in Task / executor-direct continuation 与 Octto auto-resume 的 outer retry（20 × 30s），两者共享 upstream transient vocabulary，但预算、入口和安全边界相互独立。

## 链接

- [[子 Agent 失败与恢复漂移]] 记录恢复链路中的上下文漂移风险。
- [[工作流 Continuation Retry]] 记录 upstream continuation outer retry 与 spawn_agent 45 秒 inner retry 的分层边界。
- [[工作流 Agent]] 的 executor 和 atlas initializer 都依赖该工具实现并行。
