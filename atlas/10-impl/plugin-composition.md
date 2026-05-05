---
tags: [atlas, impl]
---
# Plugin Composition

`src/index.ts` 是 micode 的 OpenCode plugin 组合入口，负责把配置、agents、hooks、tools、Octto、lifecycle、project memory、PTY 与 Atlas commands 装配成运行时插件。

## Responsibilities

- 导出 `OpenCodeConfigPlugin`，在启动时创建所有运行时依赖。
- 在 `config` handler 中注册 slash commands、agent registry、MCP servers 与权限。
- 在 `tool` registry 中暴露 [[Tools Registry]]、[[Spawn Agent Tool]]、Octto、lifecycle、project memory 和 PTY tools。
- 在 chat、tool、event hooks 中串联 [[Hooks Pipeline]]。

## Links

- [[Config Loader]] 提供用户配置和模型覆盖。
- [[Agent Registry]] 提供可注入 OpenCode 的 agent 配置。
- [[Atlas Vault System]] 通过 `/atlas-init`、`/atlas-status`、`/atlas-refresh`、`/atlas-translate` 接入。
