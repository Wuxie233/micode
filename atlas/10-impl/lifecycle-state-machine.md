---
title: Lifecycle 状态机
tags: [atlas, impl]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
---
# Lifecycle 状态机

`src/lifecycle/` 与 `src/tools/lifecycle/` 实现 issue-driven delivery 的本地记录、GitHub issue、branch、worktree、commit、push、merge、journal、lease 和 recovery。

## 职责

- 用 `LIFECYCLE_STATES` 管理 `PROPOSED` 到 `CLEANED` 的状态迁移。
- 在 start 阶段执行 repo ownership preflight，创建 issue、branch 和 worktree。
- 在 commit 阶段将 checkpoint 变更提交并推送到 `origin`。
- 在 finish 阶段选择 PR-first 或 local merge，并关闭 issue、清理 worktree。
- 通过 recovery hint、temp worktree 和 quarantine 支持有界自主恢复。

## 链接

- [[Issue 驱动交付生命周期]] 描述用户可见交付行为。
- [[远程 Git 所属误推]] 是该模块必须持续防护的高影响风险。
