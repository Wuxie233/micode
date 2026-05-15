---
title: 插件组合
tags: [atlas, impl]
sources:
  - code:src/index.ts
---
# 插件组合

`src/index.ts` 是 `micode` 的 OpenCode plugin 组合入口，负责把 [[Agent 注册表]]、[[Hooks 管线]]、[[工具注册表]]、[[Lifecycle 状态机]]、[[Octto 会话系统]]、[[Atlas Vault 系统]]、[[Project Memory 存储]] 和 [[通知系统]] 装配成一个 service-shaped plugin。

## 职责

- 导出 `OpenCodeConfigPlugin`，在启动时检查外部 CLI、加载配置并创建共享运行时对象。
- 在 `config` callback 中注册 slash commands、agents、MCP servers 和权限。
- 在 `tool` registry 中暴露 spawn-agent、Octto、Lifecycle、Project Memory、Atlas、Mindmodel、PTY 与搜索工具。
- 将 tool output、session event 和 chat hook 串入 [[Hooks 管线]]。

## 备注

`micode` 的业务逻辑不应继续堆进组合根；新能力通常应先落到独立模块，再由这里接线。
