---
title: Project Memory 与 Atlas 分层
tags: [atlas, decision]
sources:
  - code:.mindmodel/system.md
  - code:src/agents/project-memory-protocol.ts
  - code:src/agents/atlas-mental-model.ts
---
# Project Memory 与 Atlas 分层

## 决策

Atlas 描述项目当前怎样组织，Project Memory 记录历史决策、教训、风险和开放问题，Mindmodel 描述代码应该怎么写。

## 理由

三层分工能避免把代码风格、当前结构和历史原因混成一份难维护文档。

## 影响

Agent 终态报告需要分别说明 Atlas status 与 Project Memory status；leaf agents 不直接写 durable memory 或 Atlas。
