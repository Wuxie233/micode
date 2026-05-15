---
title: 按领域路由执行
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:ARCHITECTURE.md
  - code:src/agents/executor.ts
  - code:src/agents/implementer-frontend-ui.ts
  - code:src/agents/implementer-frontend-code.ts
  - code:src/agents/implementer-backend.ts
  - code:src/agents/implementer-general.ts
---
# 按领域路由执行

执行器读取计划中每个任务的 `Domain` 字段，并派发给对应 specialist implementer，让 UI、前端逻辑、后端和通用配置由不同角色处理。

## 机制

- 有效值是 `frontend-ui`、`frontend-code`、`backend`、`general`。
- `frontend-ui` 负责布局、样式、design-system、无障碍和动效。
- `frontend-code` 负责状态、数据流、表单、类型和前端测试。
- `backend` 负责 API、数据层、中间件和服务端逻辑。
- `general` 负责配置、脚本、共享类型和跨切面文件。
- 旧值 `Domain: frontend` 被视为 stale-plan 错误，需要重新规划。

## 链接

- [[Domain 路由与冻结契约]] 记录该规则的架构决策。
