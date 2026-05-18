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
- `lifecycle_resume(issue_number=N, force_refresh=true)` 即使从 `main` worktree 调用，也必须优先保留或恢复 N 对应的 issue branch/worktree，不能把记录降级为当前 `main` / base cwd。
- `lifecycle_finish` 的显式 `issue_number` 优先于本地 record 内部身份；当记录退化为 `branch=main` 时，只能通过恰好一个已验证 worktree artifact 自动修复，否则返回 structured blocker hint 让用户/primary 明确处理。
- recovery hint 指导 primary agent 在有界轮次内处理 stale record、merge conflict、cleanup blocker 和 push failure。
- 当 local merge 遇到 `merge_conflict` 时，primary/coordinator 不再默认立刻人工阻塞；它们先在 temp worktree 启动受限 conflict resolver flow，成功后用相同 finish 参数继续合并与清理。
- 若 resolver 遇到 semantic ambiguity、scope expansion 或 validation exhaustion，用户会收到 built-in `question` tool 的 compact options；plain chat 仅作为 ultra-light/fallback。
- 生命周期是 source provider，不自动写 Atlas 或 Project Memory。

## 链接

- [[Lifecycle 状态机]] 实现该行为。
