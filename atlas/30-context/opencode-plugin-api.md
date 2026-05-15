---
title: OpenCode Plugin API
tags: [atlas, context]
sources:
  - code:@opencode-ai/plugin
  - code:src/index.ts
---
# OpenCode Plugin API

OpenCode Plugin API 是 micode 的宿主边界，提供 plugin lifecycle、config mutation、agent registry、tool registry、session client 和 hook callbacks。

## 角色

- [[插件组合]] 通过 `OpenCodeConfigPlugin` 接入该 API。
- [[工具注册表]] 将 tool definitions 暴露给 OpenCode。
- [[Hooks 管线]] 依赖 OpenCode 的消息、工具输出和 session event 回调。

## 备注

该边界变化会影响所有运行时能力，因此相关升级需要优先跑 [[质量门禁]]。
