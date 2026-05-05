---
tags: [atlas, impl]
---
# Lifecycle State Machine

`src/lifecycle/` 与 `src/tools/lifecycle/` 实现 issue-driven delivery 的本地记录、GitHub issue、worktree、commit、PR、merge、journal、lease 和 recovery。

## Responsibilities

- `createLifecycleStore` 管理 `thoughts/lifecycle/<issue>.json` 记录和状态转换。
- `runner` 负责调用 `git` 与 `gh`，创建 issue、branch、worktree、commit 和 PR。
- `resolver`、`recovery`、`lease` 支持从当前 worktree 恢复生命周期状态并避免并发重入。
- lifecycle tools 暴露 `lifecycle_start_request`、`lifecycle_commit`、`lifecycle_finish`、`lifecycle_context` 等入口。
- finish 阶段可触发 project memory promotion、通知和 worktree 清理。

## Links

- 实现 [[Issue Driven Lifecycle]]。
- 与 [[Project Memory Store]] 和 [[Notifications]] 相连。
- [[Issue Driven Delivery Lifecycle]] 记录架构决策。
