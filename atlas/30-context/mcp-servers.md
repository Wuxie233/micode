---
title: MCP Servers
tags: [atlas, context]
sources:
  - code:src/index.ts
---
# MCP Servers

micode 在插件配置阶段注册 MCP servers，为 agent 提供外部文档和搜索能力。

## Role

- `context7` 默认注册，用于查询库文档。
- `perplexity` 和 `firecrawl` 根据环境变量存在性注册。
- MCP 配置由 [[插件组合]] 注入 OpenCode runtime config。

## Notes

MCP server 的可用性取决于环境变量、网络和 OpenCode runtime；agent 应在失败时清晰降级。
