---
title: Atlas 命令
tags: [atlas, behavior]
sources:
  - code:src/atlas/commands.ts
  - code:src/tools/atlas/*
  - code:src/agents/atlas-initializer.ts
  - code:src/agents/atlas-compiler.ts
---
# Atlas 命令

Atlas 命令维护 `atlas/` Obsidian vault，使人和 agent 都能读取项目结构、行为、决策和风险。

## 机制

- `/atlas-init` 冷启动或重建 vault。
- `/atlas-status` 检查 broken wikilinks、open challenges、staging 和最近运行状态。
- `/atlas-refresh` 作为辅助批量 reconcile 路径，不由 lifecycle 自动触发。
- `/atlas-translate` 在保留结构的前提下翻译节点内容。
- 日常开发按 Read / Maintain / Verify / Report 协议内联维护 Atlas。

## 链接

- [[Atlas Vault 系统]] 实现该行为。
