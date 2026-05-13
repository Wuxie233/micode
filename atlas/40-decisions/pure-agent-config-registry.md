---
title: 纯 Agent 配置注册表
tags: [atlas, decision]
sources:
  - code:src/agents/index.ts
  - code:.mindmodel/architecture/layers.md
---
# 纯 Agent 配置注册表

## Decision

Agent 文件保持为 `AgentConfig` 与 prompt 协议的配置层，统一由 [[Agent 注册表]] 聚合，再由 [[插件组合]] 注入 OpenCode。

## Rationale

这种设计让 agent prompt 可被 drift-guard 测试直接导入检查，也避免 agent 层直接持有工具或 hook 状态。

## Consequences

新 agent 应先成为可导入的配置对象，再加入 registry；运行时模型覆盖由 [[配置加载器]] 处理。
