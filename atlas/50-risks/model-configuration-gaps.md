---
title: 模型配置缺口
tags: [atlas, risk]
sources:
  - code:src/config-loader.ts
  - code:micode.example.jsonc
  - code:README.md
---
# 模型配置缺口

## Risk

`micode.json(c)` 或 OpenCode provider 配置不完整时，agent 可能落到不合适模型，影响规划、审查或 domain implementer 质量。

## Mitigation

- 使用 `micode.example.jsonc` 填写 per-agent overrides。
- [[配置加载器]] 对无效模型降级并保留 warning。
- 高风险任务在总结中说明使用过的模型和可疑配置缺口。

## Links

- [[Agent 注册表]]
