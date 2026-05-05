---
tags: [atlas, impl]
---
# Agent Registry

`src/agents/index.ts` 是所有 `AgentConfig` 的集中注册表，输出 OpenCode agent name 到配置对象的映射，并暴露 `PRIMARY_AGENT_NAME`。

## Responsibilities

- 注册 `commander`、`brainstormer`、`octto`、`planner`、`executor`、domain implementers、`reviewer`、Atlas agents 和 mindmodel agents。
- 给 registry entry 注入默认模型，再允许 [[Config Loader]] 做覆盖。
- 保持 agent module 为纯数据配置，具体业务执行由 agent prompt 和工具完成。
- 通过 `implementer-frontend`、`implementer-backend`、`implementer-general` 支撑 [[Domain Routed Execution]]。

## Links

- [[Workflow Agents]] 描述主工作流 agent 的职责。
- [[Pure Agent Config Registry]] 记录这个结构决策。
