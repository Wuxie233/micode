---
title: Agent 注册表
tags: [atlas, impl]
sources:
  - code:src/agents/index.ts
---
# Agent 注册表

`src/agents/index.ts` 集中导出所有 `AgentConfig`，是 [[插件组合]] 注入 OpenCode agent map 的唯一注册源。

## 职责

- 注册 `commander`、`brainstormer`、`octto`、`planner`、`executor`、domain implementers 和 `reviewer`。
- 注册 discovery、specialist、Atlas、Mindmodel、knowledge bootstrap、ledger 和 notification agents。
- 给所有 agent 套用 `DEFAULT_MODEL`，再交给 [[配置加载器]] 做用户覆盖。
- 保持 agent name 的 kebab-case 外部契约。

## 备注

注册表只负责聚合配置，不负责实际调度；调度规则写在对应 agent prompt 与 [[子 Agent 派发工具]] 中。
