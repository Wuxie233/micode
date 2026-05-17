---
title: 有界 Upstream Continuation 自动重试
tags: [atlas, behavior]
sources:
  - design:thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md
  - code:src/workflow-retry/*
  - code:src/hooks/session-recovery.ts
  - code:src/octto/auto-resume/dispatcher.ts
---
# 有界 Upstream Continuation 自动重试

## 用户可见行为

- 当可恢复 upstream/provider transient 故障（如 `upstream_error: Upstream request failed`）通过 `session.error` 或 `message.updated` hook event 暴露给 `session-recovery` 时，executor-direct / built-in Task continuation 不再立即停下让用户手点 "continue"。
- 系统自动等待约 30 秒并继续同一 session，最多 20 次。
- 自动恢复成功时用户只看到任务继续推进。
- 20 次仍失败才以 toast / structured blocked 方式停止并交还用户决策。
- 对可能重复副作用或需要用户决策的场景（pending user question / destructive confirm / semantic blocker），系统不会盲目无限重试。
- lifecycle git/GitHub push/merge/PR-check 不受 20×30s 影响；它们沿用 `config.lifecycle.*` 自己的 backoff。
- `resume_subagent` 不被扩展成通用 Task retry 入口。

## 验收方式

- 模拟 `session.error` 事件 payload 为 `upstream_error: Upstream request failed`，确认 hook 不立即停而是延迟 30 秒后调用 `client.session.prompt`。
- 重复 25 次相同事件，确认 prompt 调用最多 20 次，最后一次伴随 `Upstream retry exhausted` toast。
- 模拟 Octto auto-resume 多答复批次 + 一次 upstream_error，确认 30 秒后 batch ids 完整重发。
- grep `src/lifecycle/**` 确认无 `@/workflow-retry` 导入。
- grep `src/tools/resume-subagent.ts` 确认无 `@/workflow-retry` 导入。

## 排除范围

- 单次 ordinary chat 提问失败。
- `spawn_agent` 内层 45 秒 budget（保留不变）。
- 任何 destructive remote mutation 或 pending user question 进行中的 session。
- TUI-only upstream_error 如果没有对应的 `session.error` / `message.updated` hook event，则对本机制不可观测（unobservable），无法捕获 / cannot be captured，也不会触发自动 continuation retry。
