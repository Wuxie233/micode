---
tags: [atlas, behavior]
---
# Issue Driven Lifecycle

Issue-driven lifecycle 把非平凡请求包装为 GitHub issue、分支、worktree、commit 和 finish 流程，便于跨会话追踪和恢复。

## Mechanics

- `lifecycle_start_request` 创建 issue、分支和 worktree，并写本地 lifecycle record。
- `lifecycle_commit` 提交阶段性成果，可按配置推送到 `origin`。
- `lifecycle_finish` 根据配置走 PR 或 local merge，并清理 worktree。
- progress comments、journal 和 recovery tools 保持任务状态可追溯。
- 远程写操作前需要做仓库所有权识别，避免误推到 upstream。

## Links

- [[Lifecycle State Machine]] 实现状态机和工具。
- [[Remote Git Ownership Mistakes]] 记录远程写风险。
