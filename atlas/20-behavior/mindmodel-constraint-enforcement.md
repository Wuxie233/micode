---
title: Mindmodel 约束执行
tags: [atlas, behavior]
sources:
  - code:.mindmodel/manifest.yaml
  - code:src/tools/mindmodel-lookup.ts
  - code:src/hooks/mindmodel-injector.ts
  - code:src/hooks/constraint-reviewer.ts
---
# Mindmodel 约束执行

Mindmodel 把项目专属代码风格、架构边界、错误处理、验证、测试和领域词汇注入实现过程，帮助 agent 按项目方式写代码。

## Mechanics

- `mindmodel_lookup` 按 query 返回相关规则和示例。
- `mindmodel-injector` 可在启用后进行 task-aware prompt 注入。
- `constraint-reviewer` 在 `Write` / `Edit` 后检查 `.mindmodel/` 约束。
- `mm-orchestrator` 可重建 `.mindmodel/` 层。

## Links

- [[Mindmodel 运行时]] 实现该行为。
