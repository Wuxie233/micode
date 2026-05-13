---
title: Project Memory 工作流
tags: [atlas, behavior]
sources:
  - code:src/project-memory/*
  - code:src/tools/project-memory/*
  - code:src/agents/project-memory-protocol.ts
  - code:AGENTS.md
---
# Project Memory 工作流

Project Memory 保存“为什么这么选、踩过什么坑、留下什么开放问题”，与描述当前结构的 Atlas 和描述代码写法的 Mindmodel 分工不同。

## Mechanics

- 非平凡任务开始前使用 `project_memory_lookup` 查询相关决策、教训和风险。
- coordinator agents 在语义 checkpoint 可用 `project_memory_promote` 写入 durable knowledge。
- leaf agents 不直接 promote 或 forget，只在终态报告里升级 observation。
- 写入时拒绝 secrets、credentials、raw chat transcripts 和未标注 speculation。
- `project_memory_health` 用于体检项目记忆状态。

## Links

- [[Project Memory 存储]] 实现该行为。
