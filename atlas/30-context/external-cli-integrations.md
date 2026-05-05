---
tags: [atlas, context]
---
# External CLI Integrations

micode 通过外部 CLI 扩展能力，包括 `git`、`gh`、`sg`、`btca`、`npx` 和运行时 shell 命令。

## Notes

- [[Lifecycle State Machine]] 使用 `git` 和 `gh` 管理 issue、分支、worktree、commit 和 PR。
- [[Tools Registry]] 暴露 `ast_grep_search`、`ast_grep_replace` 和 `btca_ask`。
- [[OpenCode Plugin API]] 的 MCP 注册会通过 `npx` 启动 Context7 等服务。
- 外部 CLI 不可用时需要降级或返回明确诊断。
