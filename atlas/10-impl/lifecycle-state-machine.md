---
title: Lifecycle 状态机
tags: [atlas, impl]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
---
# Lifecycle 状态机

`src/lifecycle/` 与 `src/tools/lifecycle/` 实现 issue-driven delivery 的本地记录、GitHub issue、branch、worktree、commit、push、merge、journal、lease 和 recovery。

## Responsibilities

- 用 `LIFECYCLE_STATES` 管理 `PROPOSED` 到 `CLEANED` 的状态迁移。
- 在 start 阶段先发现有效项目 repo root；remote-capable 场景执行 repo ownership preflight 后创建 GitHub issue、branch 和 worktree，无法确认远端所有权或未初始化时创建 `mode: "local-only"` 本地记录。
- 在 commit 阶段将 checkpoint 变更提交；只有 remote-capable 且 ownership gate 允许时才推送到 `origin`，local-only / remote-disabled / disallowed preflight 会保留本地提交并跳过远端推送。
- 在 finish 阶段选择 PR-first 或 local merge；远端 PR / push / merge 路径先经过 ownership gate，local-only finish 返回本地可恢复结果而不执行远端 mutation。
- 通过 recovery hint、temp worktree、quarantine 与 lifecycle branch audit/prune 支持有界自主恢复；branch 删除只使用安全删除与 origin-scoped gate。

## Links

- [[Issue 驱动交付生命周期]] 描述用户可见交付行为。
- [[远程 Git 所属误推]] 是该模块必须持续防护的高影响风险。
