---
title: Mindmodel 运行时
tags: [atlas, impl]
sources:
  - code:src/tools/mindmodel-lookup.ts
  - code:src/agents/mindmodel/*
  - code:.mindmodel/*
---
# Mindmodel 运行时

Mindmodel runtime 由 `.mindmodel/`、`src/mindmodel/`、`src/tools/mindmodel-lookup.ts` 和 `src/agents/mindmodel/*` 组成，提供项目代码风格、模式、架构约束和领域词汇。

## Responsibilities

- 加载 `.mindmodel/manifest.yaml` 与分类 markdown。
- 通过 `mindmodel_lookup` 按 query 返回相关规则和示例。
- 由 `mm-orchestrator` 与 `mm-*` agents 重建或扩展约束层。
- 支撑 injector 和 constraint reviewer，让实现阶段遵守 HOW-to-code 规则。

## Links

- [[Mindmodel 约束执行]] 是该模块的用户可见行为。
- 低耦合与复用约束 记录其核心架构原则。
