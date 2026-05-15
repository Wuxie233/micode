---
title: Factory Hooks 与依赖注入
tags: [atlas, decision]
sources:
  - code:src/hooks/*
  - code:.mindmodel/architecture/coupling-reuse.md
---
# Factory Hooks 与依赖注入

## 决策

工具、hooks、stores、runners 和 managers 优先使用 `createX(...)` factory，并通过显式参数注入依赖，而不是使用业务类或隐式单例。

## 理由

Factory + closure 让状态边界更清晰，也更容易在 Bun tests 中用 mock context 或临时 store 验证行为。

## 影响

新增运行时组件应遵守低耦合层次：utils ← tools ← hooks ← agents，并避免循环导入。
