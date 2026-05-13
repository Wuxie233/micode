---
title: PTY 工具
tags: [atlas, impl]
sources:
  - code:src/tools/pty/*
---
# PTY 工具

`src/tools/pty/` 封装 `bun-pty`，为 agent 提供可持久的交互式终端 session。

## Responsibilities

- `pty_spawn` 启动长运行进程或交互 shell。
- `pty_write` 向 session 写入命令、文本或控制字符。
- `pty_read` 分页读取滚动输出缓冲区，并支持 pattern 过滤。
- `pty_list` 与 `pty_kill` 管理 session 状态和清理。
- `loadBunPty` 在依赖不可用时降级，而不是让插件整体失败。

## Links

- [[Bun Runtime]] 提供该模块的运行时基础。
