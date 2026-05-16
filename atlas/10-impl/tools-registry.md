---
title: 工具注册表
tags: [atlas, impl]
sources:
  - code:src/tools/index.ts
  - code:src/tools/*
---
# 工具注册表

`src/tools/index.ts` 聚合 OpenCode tools，并由 [[插件组合]] 统一注册到运行时。工具层负责 schema、输入验证和副作用边界，不应直接导入 agent。

## 职责

- 导出 `ast_grep_search`、`ast_grep_replace`、`btca_ask`、`look_at`、artifact search 等静态工具。
- 通过工厂创建 `spawn_agent`、`batch_read`、`mindmodel_lookup`、`atlas_lookup`、Octto、Project Memory、PTY 和 Lifecycle 工具。
- 将外部 CLI、文件系统、SQLite、WebSocket、GitHub 等边界封装成稳定 tool contract。
- 用格式化 Markdown 或结构化 JSON 反馈 agent 可消费的结果。
- Lifecycle 工具注册 `lifecycle_lost_update_audit`，只渲染 read-only audit plan；它不依赖 `LifecycleHandle` mutation path，也不建议 push、merge、issue edit 或历史重写命令。

## 链接

- [[OpenCode Plugin API]] 是工具注册的外部运行时边界。
