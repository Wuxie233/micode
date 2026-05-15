---
title: 工作流 Agent
tags: [atlas, impl]
sources:
  - code:src/agents/commander.ts
  - code:src/agents/brainstormer.ts
  - code:src/agents/octto.ts
  - code:src/agents/planner.ts
  - code:src/agents/executor.ts
  - code:src/agents/implementer-frontend-ui.ts
  - code:src/agents/implementer-frontend-code.ts
  - code:src/agents/implementer-backend.ts
  - code:src/agents/implementer-general.ts
  - code:src/agents/reviewer.ts
---
# 工作流 Agent

工作流 agent 定义 Brainstorm → Plan → Implement 的人机协作协议，并通过 [[子 Agent 派发工具]]、[[Lifecycle 状态机]]、[[Atlas Vault 系统]]、[[Project Memory 存储]] 和 [[Mindmodel 运行时]] 调用实际能力。

## 职责

- `commander` 处理主入口意图、轻量执行、lifecycle 协调和终态汇报。
- `brainstormer` 与 `octto` 负责设计探索，分别服务文本和浏览器 UI。
- `planner` 产出带 `Domain` 的微任务计划，并在跨前后端时生成冻结契约。
- `executor` 按 `Domain` 派发 implementers，并组织 implementer → reviewer 循环。
- `reviewer` 只读校验任务结果、测试状态与契约一致性。

## 链接

- [[头脑风暴到计划到实现工作流]] 描述用户可见路径。
- [[按领域路由执行]] 描述 `Domain` 派发规则。
