---
tags: [atlas, risk]
---
# Model Configuration Gaps

仓库示例配置不包含真实 provider 或 model，用户如果未配置或写错模型，agent 路由可能降级到默认模型或无法创建子代理。

## Impact

- specialist implementer 可能没有使用预期模型。
- `spawn_agent` 的 explicit model override 可能在创建 session 前失败。
- 用户以为领域路由已生效，但实际仍由 fallback 模型执行。

## Mitigation

- [[Config Loader]] 校验可用模型并丢弃无效覆盖。
- README 要求使用 `provider/model` 格式并匹配 `opencode.json`。
- 对关键任务在总结中说明使用了默认模型还是 per-agent override。
