---
title: Hooks 管线
tags: [atlas, impl]
sources:
  - code:src/hooks/index.ts
  - code:src/hooks/*
---
# Hooks 管线

`src/hooks/` 将上下文注入、ledger 加载、auto-compact、token truncation、file/fetch tracking、artifact indexing、constraint review、Atlas/Mindmodel 注入和 session recovery 包装为 OpenCode lifecycle hooks。

## 职责

- 在消息和工具输出路径上补充项目上下文，而不是让每个 agent 重复读取。
- 维护 `thoughts/` artifact 索引和文件操作记录。
- 在 `Write` / `Edit` 后触发 mindmodel constraint review。
- 对大输出进行 token-aware truncation，降低上下文污染。

## 链接

- [[Artifact 索引]] 依赖 hook 捕捉写入事件。
- [[Mindmodel 约束执行]] 依赖 injector 与 constraint reviewer。
