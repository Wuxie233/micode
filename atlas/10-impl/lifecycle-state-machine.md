---
title: Lifecycle 状态机
tags: [atlas, impl]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
  - code:src/lifecycle/conflict-context.ts
  - code:src/lifecycle/conflict-scope.ts
  - code:src/lifecycle/lost-update-audit.ts
---
# Lifecycle 状态机

`src/lifecycle/` 与 `src/tools/lifecycle/` 实现 issue-driven delivery 的本地记录、GitHub issue、branch、worktree、commit、push、merge、journal、lease 和 recovery。

## 职责

- 用 `LIFECYCLE_STATES` 管理 `PROPOSED` 到 `CLEANED` 的状态迁移。
- 在 start 阶段执行 repo ownership preflight，创建 issue、branch 和 worktree。
- 在 commit 阶段将 checkpoint 变更提交并推送到 `origin`。
- 在 finish 阶段选择 PR-first 或 local merge，并关闭 issue、清理 worktree。
- 通过 recovery hint、temp worktree 和 quarantine 支持有界自主恢复。
- `resolveIssueIdentity` 按 explicit input → local high-confidence record → issue body worktree artifact → git worktree/ref → cwd fallback 解析 issue branch/worktree；`resume(force_refresh)` 不应把高置信 issue 身份降级为当前 `main` worktree。
- `lifecycle_finish` 优先使用显式 `issue_number`，省略时通过 active lifecycle 推断；当 record 退化为 `branch=main` 时，只在恰好一个已验证 issue worktree artifact 存在时修复身份，否则返回 `ambiguous_lifecycle` / `ask_user` recovery hint。
- local-merge 的 temp worktree 先 `git fetch origin <baseBranch>`，再以 `git worktree add --detach <tmp> origin/<baseBranch>` 创建，随后在 detached worktree 内 `merge --no-ff <issueBranch>` 并用普通 `push origin HEAD:<baseBranch>` 推回 base；因此不依赖本地 `main` 是否已被其它 worktree checkout。
- `merge_conflict` recovery hint 现在会携带受限 resolver context；local-merge 可在保留的 temp worktree 中继续已解决冲突，提交 `merge <branch>: resolve lifecycle conflicts` 后再走普通 `push origin <base>`。
- conflict resolver 只允许 conflict files 与少量直接相关 tests/types/call sites；`evaluateConflictResolverScope` 会在提交前阻断无关文件或过宽扩展。
- lost-update audit 模型只生成 read-only evidence plan，用于区分 force-push evidence、squash-history confusion、semantic overwrite、push rejection race 与 manual remote mutation。

## 链接

- [[Issue 驱动交付生命周期]] 描述用户可见交付行为。
- [[远程 Git 所属误推]] 是该模块必须持续防护的高影响风险。
