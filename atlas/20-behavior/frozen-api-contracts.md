---
title: 冻结 API 契约
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:ARCHITECTURE.md
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
  - code:src/agents/reviewer.ts
---
# 冻结 API 契约

当计划同时包含 frontend 与 backend 任务时，planner 生成 `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md`，作为并发实现者的共享接口契约。

## 机制

- contract path 会被 executor 注入每个 implementer 和 reviewer 的 prompt。
- implementer 必须遵守契约；发现不匹配时升级给 executor，而不是编辑契约。
- reviewer 在 contract path 存在时检查 contract conformance。
- 该机制降低前后端并发开发时的接口语义漂移。

## 链接

- [[按领域路由执行]] 使用契约做跨领域对齐。
