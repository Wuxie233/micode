---
tags: [atlas, decision]
---
# Issue Driven Delivery Lifecycle

非平凡工作使用 issue、branch、worktree、progress comments、commit 和 finish 流程来提供可追踪交付状态。

## Rationale

- [[Issue Driven Lifecycle]] 把跨会话工作状态放到 GitHub issue 和本地 lifecycle record 中。
- 隔离 worktree 降低主工作树被其他会话污染的概率。
- progress comments 和 journal 让恢复、审查和自动记忆推广更可靠。

## Consequences

- 远程写操作必须遵守仓库所有权 preflight。
- lifecycle 失败时需要 recovery decision，而不是假设当前分支就是正确上下文。
