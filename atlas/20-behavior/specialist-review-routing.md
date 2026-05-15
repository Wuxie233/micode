---
title: 专家评审路由
tags: [atlas, behavior]
sources:
  - code:src/agents/product-manager.ts
  - code:src/agents/software-architect.ts
  - code:src/agents/ux-designer.ts
  - code:src/agents/architecture-quality-inspector.ts
  - code:src/agents/rubric-reviewer.ts
  - code:AGENTS.md
---
# 专家评审路由

micode 提供用户显式召唤的只读专家评审，它们辅助需求、架构、UX、质量和 rubric 判断，但不进入 executor reviewer 循环。

## 机制

- `product-manager`、`software-architect`、`ux-designer`、`architecture-quality-inspector`、`rubric-reviewer` 必须由用户显式触发。
- 主 agent 最多在合适阶段提示一次可派哪个 specialist。
- adversarial review 可派考古、保守派、红队、极简派等角色，单轮最多 3 个。
- 评审完成后回到讨论阶段；只有用户明确批准，才进入 lifecycle、planner、executor 或 commit。

## 链接

- [[Agent 注册表]] 提供这些 specialist 的注册入口。
