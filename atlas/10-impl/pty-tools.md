---
tags: [atlas, impl]
---
# PTY Tools

`src/tools/pty/` 把可选 `bun-pty` 能力包装成 OpenCode long-running terminal tools。

## Responsibilities

- `createPTYManager` 管理 PTY session、process、状态、exit code 和 parent session。
- ring buffer 保存滚动输出，支持 offset、limit 和 regex search。
- `pty_spawn` 启动后台终端，`pty_write` 输入文本或控制字符。
- `pty_read` 读取输出，`pty_list` 列出 session，`pty_kill` 终止或清理。
- session 删除时按 parent session 清理相关 PTY 进程。

## Links

- [[Tools Registry]] 负责暴露该工具组。
- [[External CLI Integrations]] 描述外部运行时依赖。
