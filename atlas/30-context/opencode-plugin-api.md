---
tags: [atlas, context]
---
# OpenCode Plugin API

OpenCode plugin API 是 micode 的宿主边界，`@opencode-ai/plugin` 提供 lifecycle hooks、config mutation、tool registry 和 session client。

## Notes

- [[Plugin Composition]] 通过该 API 返回 hooks、tools 和 config handler。
- [[Workflow Agents]] 的执行依赖 OpenCode session、agent 和 tool 调用模型。
- 该边界要求工具输入输出在系统边界做验证和容错。
