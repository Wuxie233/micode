---
title: 工作流 Continuation Retry
tags: [atlas, impl]
sources:
  - code:src/workflow-retry/*
  - code:src/hooks/session-recovery.ts
  - code:src/octto/auto-resume/dispatcher.ts
  - design:thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md
---
# 工作流 Continuation Retry

`src/workflow-retry/*` 提供面向 hook-observable built-in Task / executor-direct continuation（经 `src/hooks/session-recovery.ts` 观测到 `session.error` 或 `message.updated` hook event）和 Octto answer→owner prompt 的有界 upstream/provider transient 自动重试。

## 职责

- 提供共享 predicate (`isRecoverableUpstreamError`)，识别可恢复 upstream/provider transient（`upstream_error: Upstream request failed`、stream `INTERNAL_ERROR` 等），排除 auth/quota/config/user-cancel/semantic 错误。
- 提供 bounded policy (`WORKFLOW_CONTINUATION_RETRY_POLICY`)：默认 maxAttempts = 20、intervalMs = 30_000。
- 提供 in-memory attempt registry (`createAttemptRegistry`)：dedup processing window + per-session attempt counter，session 删除时由 hook `cleanupSession` 清理。
- 被 `src/hooks/session-recovery.ts` 的 upstream 分支和 `src/octto/auto-resume/dispatcher.ts` 的 catch 分支消费；built-in Task / executor-direct continuation 只覆盖可被 hook event 观测到的 upstream_error。

## 两层 retry 边界

- 本模块 = workflow continuation outer retry（20 × 30s，面向用户的 continuation 体验）。
- `src/tools/spawn-agent/retry.ts` + `config.subagent.transientRetryBudgetMs` = spawn_agent inner retry（≤ 2 次 / ≤ 45 秒，coordinator → subagent 派发链路）。
- 两者独立，参数不同；`tests/tools/spawn-agent/classify-no-regression.test.ts` 强制守护。

## 排除范围

- `src/lifecycle/**` 严禁导入本模块；`tests/lifecycle/workflow-retry-exclusion.test.ts` drift-guard 守护。
- `src/tools/resume-subagent.ts` 不被本模块影响；`tests/tools/resume-subagent-non-expansion.test.ts` drift-guard 守护。
- ordinary chat / `src/index.ts` prompt 路径不在范围。

## 链接

- [[子 Agent 派发工具]] 解释 spawn_agent 的 45 秒 inner retry。
- [[Hooks 管线]] 解释 session-recovery hook 的 upstream 分支位置。
- [[Octto 会话系统]] 解释 auto-resume dispatcher 的 bounded retry 接入点。
