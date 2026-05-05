---
tags: [atlas, context]
---
# MCP Servers

MCP servers 为 agent 提供外部文档、搜索或爬取能力，具体注册由 [[Plugin Composition]] 在 config handler 中完成。

## Notes

- Context7 MCP 默认注册，用于查询库文档。
- Perplexity 与 Firecrawl MCP 依赖对应环境变量存在才注册。
- MCP 是运行时能力边界，不应把密钥写入 atlas、logs 或 project memory。
- [[External CLI Integrations]] 覆盖 MCP server 启动时的 CLI 依赖。
