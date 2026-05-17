---
title: Octto 会话系统
tags: [atlas, impl]
sources:
  - code:src/octto/*
  - code:src/tools/octto/*
---
# Octto 会话系统

`src/octto/` 与 `src/tools/octto/` 实现浏览器问答、brainstorm 分支、WebSocket session、persistence 和 auto-resume。

## 职责

- 管理 session、question、answer、draft-before-send 和 WebSocket 状态。
- 暴露 `start_session`、`push_question`、`get_next_answer`、`create_brainstorm` 等 tools。
- 将浏览器答案持久化到 `thoughts/octto/sessions/`，并在答案到达时触发 auto-resume。
- auto-resume dispatcher 在 owner session prompt 遇到 `upstream_error` / provider transient 时接入 [[工作流 Continuation Retry]]，按 20 × 30s 有界重试并保留同一批 questionIds。
- 保证 session 归属隔离，其他 OpenCode conversation 不能修改本会话。

## 链接

- [[Octto 浏览器问题流]] 描述用户如何看到和回答问题。
- [[知识库启动命令]] 在大块问卷场景下复用 Octto。
- [[工作流 Continuation Retry]] 描述 auto-resume prompt-failure 的 bounded upstream retry。
