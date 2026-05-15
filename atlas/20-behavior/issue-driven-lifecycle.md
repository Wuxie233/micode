---
title: Issue 驱动交付生命周期
tags: [atlas, behavior]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
  - code:AGENTS.md
---
# Issue 驱动交付生命周期

非平凡请求可以进入 issue-driven delivery：创建 issue、branch、worktree，经历设计、计划、执行、提交、合并、关闭和清理。

## 机制

- `lifecycle_start_request` 建 issue 与隔离 worktree。
- `lifecycle_commit` 在 checkpoint 提交并推送到 `origin`。
- `lifecycle_finish` 根据环境选择 PR-first 或 local merge，并清理状态。
- recovery hint 指导 primary agent 在有界轮次内处理 stale record、merge conflict、cleanup blocker 和 push failure。
- 生命周期是 source provider，不自动写 Atlas 或 Project Memory。

## 链接

- [[Lifecycle 状态机]] 实现该行为。
