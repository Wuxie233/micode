---
tags: [atlas, impl]
---
# Notifications

`src/notifications/` 为 lifecycle 或 session 完成状态提供可去重、可配置、可脱敏的通知管线。

## Responsibilities

- `createPolicy` 判断通知是否启用、是否被去重抑制、是否允许发送。
- `createDedupeStore` 用 TTL 和条目上限避免重复通知。
- `composeMessage` 组合状态、标题、摘要和 reference，并调用 scrub 逻辑。
- `createNotifier` 串联 policy、composer 和 sink，发送失败只记录 warning。
- `createCourierSink` 通过外部 courier 投递，`createNoopSink` 支持测试和禁用场景。

## Links

- [[Lifecycle State Machine]] 在完成或阻塞时可触发通知。
- [[Remote Git Ownership Mistakes]] 的缓解依赖清晰的完成和失败反馈。
