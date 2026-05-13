---
title: 系统边界使用 Valibot
tags: [atlas, decision]
sources:
  - code:src/config-schemas.ts
  - code:src/octto/session/schemas.ts
  - code:src/lifecycle/schemas.ts
  - code:.mindmodel/patterns/validation.md
---
# 系统边界使用 Valibot

## Decision

运行时输入、配置、WebSocket 消息、lifecycle 输入和 mindmodel schema 统一使用 `valibot` 验证。

## Rationale

单一验证库减少类型与 schema 漂移，`v.safeParse` 支持宽容边界，`v.parse` 支持严格内部契约。

## Consequences

新增外部输入边界不应引入 Zod、Yup 或手写 schema maps；类型应从 schema 推导。
