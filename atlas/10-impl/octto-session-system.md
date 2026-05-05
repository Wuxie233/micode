---
tags: [atlas, impl]
---
# Octto Session System

`src/octto/` 与 `src/tools/octto/` 实现浏览器问答、WebSocket 会话、portal、持久化恢复和 brainstorm branch state。

## Responsibilities

- `createSessionStore` 管理 session、questions、answers、waiters 和 owner 校验。
- Bun HTTP/WebSocket server 提供 session page、portal 页面和 `/ws/<sessionId>` 通道。
- persistence store 在插件重启后恢复未完成 Octto session。
- auto-resume 在答案到达时把 continue prompt 投回原 OpenCode conversation。
- `createOcttoTools` 暴露 `start_session`、question tools、`get_next_answer`、`create_brainstorm` 等工具。

## Links

- 实现 [[Octto Browser Questions]]。
- 被 [[Brainstorm Plan Implement Workflow]] 用作设计探索入口。
