---
tags: [atlas, impl]
---
# Config Loader

`src/config-loader.ts` 与 `src/config-schemas.ts` 读取 `micode.json(c)` 和 `opencode.json(c)`，用 `jsonc-parser` 与 `valibot` 清洗配置，再把安全的 agent override 交给 [[Agent Registry]]。

## Responsibilities

- `loadMicodeConfig` 读取插件配置，解析失败时降级为 `null`。
- `loadAvailableModels`、`loadDefaultModel`、`loadModelContextLimits` 从 OpenCode 配置提取模型信息。
- `mergeAgentConfigs` 合并默认 agent、per-agent override、默认模型和可用模型校验结果。
- schema 层只允许安全字段进入 agent 配置，避免把未知配置直接透传到运行时。

## Links

- [[Plugin Composition]] 在启动阶段调用该模块。
- [[Domain Routed Execution]] 依赖 per-agent 模型覆盖语义。
