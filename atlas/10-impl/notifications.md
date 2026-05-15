---
title: 通知系统
tags: [atlas, impl]
sources:
  - code:src/notifications/*
  - code:src/agents/notification-courier.ts
---
# 通知系统

`src/notifications/` 提供 completion notification 的策略、脱敏、去重、投递和 courier sink，服务 primary agent 的 terminal-state 通知。

## 职责

- 判断哪些 terminal state 需要发送通知。
- 通过 dedupe store 避免同一会话重复通知。
- 在发送前 scrub secrets 和原始日志。
- 支持 courier sink 和 noop sink，便于测试与降级。

## 备注

通知是用户体验层能力，不应成为 lifecycle 或 executor 的核心控制流依赖。
