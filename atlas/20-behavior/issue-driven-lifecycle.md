---
title: Issue 驱动交付生命周期
tags: [atlas, behavior]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
  - code:AGENTS.md
---
# Issue 驱动交付生命周期

非平凡请求可以进入 issue-driven delivery：优先创建 GitHub issue、branch、worktree；当仓库未初始化或远端 ownership 不可安全确认时，进入 `local-only` 生命周期，仍允许本地设计、计划、执行与提交路径安全推进。

## Mechanics

- `lifecycle_start_request` 先发现有效 repo root；remote-capable 时建 issue 与隔离 worktree，local-only 时创建负数本地 identity 记录且不调用 GitHub / `git init`。
- `lifecycle_commit` 在 checkpoint 提交；只有 ownership gate 允许时才推送到 `origin`，local-only 会保留本地提交并返回不可远端重试的 recovery hint。
- `lifecycle_finish` 根据环境选择 PR-first 或 local merge；远端 mutation 先经过 preflight gate，local-only 不执行 PR / remote push / remote merge。
- recovery hint 指导 primary agent 在有界轮次内处理 stale record、merge conflict、cleanup blocker 和 push failure。
- 生命周期是 source provider，不自动写 Atlas 或 Project Memory。

## Links

- [[Lifecycle 状态机]] 实现该行为。
