---
tags: [atlas, decision]
---
# Pure Agent Config Registry

Agent 模块采用纯 `AgentConfig` 数据对象和命名导出，业务执行逻辑放在 prompt 约束和工具调用中，而不是在 agent 文件中实现函数流程。

## Rationale

- [[Agent Registry]] 可以集中合并默认模型和用户覆盖。
- 纯数据结构让 agent 差异更容易审查、测试和覆盖。
- 该选择符合项目规则中“agents 目录只放配置对象”的边界。

## Consequences

- 复杂行为需要在 [[Workflow Agents]] prompt 和 [[Tools Registry]] 工具层表达。
- registry key 成为公共契约，重命名会影响用户配置和 executor 路由。
