---
tags: [atlas, decision]
---
# Valibot at System Boundaries

项目在配置、工具参数、Octto WebSocket、mindmodel、project memory 和安全门禁等边界优先使用 Valibot schema 做运行时验证。

## Rationale

- [[Config Loader]] 可在不信任输入进入 agent registry 前清洗字段。
- [[Octto Session System]] 能校验浏览器消息和问题答案。
- [[Project Memory Store]] 与 [[Skill Autopilot]] 可拒绝错误形状或敏感输入。

## Consequences

- schema 需要随公共契约同步更新。
- 容错路径应积累 warning 并安全降级，而不是让非关键解析失败中断主流程。
