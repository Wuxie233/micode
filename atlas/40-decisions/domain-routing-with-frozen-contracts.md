---
title: Domain 路由与冻结契约
tags: [atlas, decision]
sources:
  - code:README.md
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
  - code:.mindmodel/architecture/coupling-reuse.md
---
# Domain 路由与冻结契约

## Decision

计划任务必须使用 `frontend-ui`、`frontend-code`、`backend`、`general` 四类 `Domain`，跨 frontend/backend 的计划必须生成冻结 API 契约。

## Rationale

该决策让不同模型或不同 agent 按擅长领域执行，同时用契约降低并发实现时的接口漂移。

## Consequences

Executor 必须拒绝旧的 `Domain: frontend`；implementer 发现契约错误时升级问题，不直接编辑契约。
