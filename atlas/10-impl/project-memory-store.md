---
title: Project Memory 存储
tags: [atlas, impl]
sources:
  - code:src/project-memory/*
  - code:src/tools/project-memory/*
---
# Project Memory 存储

`src/project-memory/` 使用 SQLite 保存项目级 durable memory，记录 decisions、lessons、risks、open questions、procedures 和来源关系。

## 职责

- 维护 `entities`、`entries`、`relations`、`sources` 与 FTS 索引。
- 提供 lookup、promote、forget 和 health 四类能力。
- 在 promote 前进行 secret detection，并按 source kind 设置状态。
- 以 repo identity 为项目隔离维度，使 memory 跨 worktree 可用。

## 链接

- [[Project Memory 工作流]] 描述何时读取和写入记忆。
- [[Project Memory 与 Atlas 分层]] 记录与 Atlas、Mindmodel 的职责边界。
