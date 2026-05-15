---
title: Knowledge Bootstrap 串行三层重建
tags: [atlas, decision]
sources:
  - code:src/agents/knowledge-bootstrap-orchestrator.ts
  - code:src/tools/knowledge-bootstrap/*
  - code:AGENTS.md
---
# Knowledge Bootstrap 串行三层重建

## 决策

`/all-init`、`/all-rebuild`、`/all-status` 使用统一 orchestrator，但不重写子命令实现；涉及写入时按 `/init` → `.mindmodel/` → `atlas/` 串行执行。

## 理由

Mindmodel 依赖 `ARCHITECTURE.md` / `CODE_STYLE.md`，Atlas 又依赖 Mindmodel；串行执行避免后续层读取旧上下文。

## 影响

`/all-rebuild` 必须确认覆盖，失败不回滚已完成层；intent 问卷答案应一次收集并下传。
