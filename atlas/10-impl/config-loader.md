---
title: 配置加载器
tags: [atlas, impl]
sources:
  - code:src/config-loader.ts
  - code:src/config-schemas.ts
  - code:micode.example.jsonc
---
# 配置加载器

`src/config-loader.ts` 读取 `opencode.json(c)` 与 `micode.json(c)`，用 `valibot` 清洗 agent overrides、feature flags、fragments、context limits 和 compaction threshold，并把配置合并进 [[Agent 注册表]]。

## 职责

- 解析 JSONC 配置并忽略未知或不安全字段。
- 按 per-agent override、OpenCode default model、plugin fallback 的顺序解析模型。
- 为 primary、planner、executor、reviewer、implementer 和 specialist agents 提供运行时模型配置。
- 将无效模型降级为安全默认值，而不是让插件启动失败。

## 链接

- [[模型配置缺口]] 记录配置缺口造成的行为风险。
