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
  - code:src/agents/decision-minimal-response.ts
  - code:src/agents/question-first-decision.ts
---
# 工作流 Agent

工作流 agent 定义 Brainstorm → Plan → Implement 的人机协作协议，并通过 [[子 Agent 派发工具]]、[[Lifecycle 状态机]]、[[Atlas Vault 系统]]、[[Project Memory 存储]] 和 [[Mindmodel 运行时]] 调用实际能力。

## 职责

- `commander` 处理主入口意图、轻量执行、lifecycle 协调和终态汇报。
- `brainstormer` 与 `octto` 负责设计探索，分别服务文本和浏览器 UI。
- `planner` 产出带 `Domain` 的微任务计划，并在跨前后端时生成冻结契约。
- `executor` 按 `Domain` 派发 implementers，并组织 implementer → reviewer 循环。
- `reviewer` 只读校验任务结果、测试状态与契约一致性。
- primary/coordinator prompts 注入 `DECISION_MINIMAL_RESPONSE_PROTOCOL` 与 `QUESTION_FIRST_DECISION_PROTOCOL`：用户可见回复只保留 decision、acceptance、next-step；真实用户决策默认走 built-in `question` tool。
- conflict resolver 相关 prompt 要求 reviewer mandatory，leaf agents 只向上层返回 compact facts，不能把 raw recovery hint、git logs、reviewer checklist 或 subagent raw reports 直接 dump 给用户。

## 链接

- [[头脑风暴到计划到实现工作流]] 描述用户可见路径。
- [[按领域路由执行]] 描述 `Domain` 派发规则。
