---
title: Artifact 索引
tags: [atlas, impl]
sources:
  - code:src/tools/artifact-search.ts
  - code:src/hooks/artifact-auto-index.ts
  - code:src/indexing/*
---
# Artifact 索引

Artifact indexing 将 `thoughts/` 中的 plans、ledgers、milestone artifacts 和历史材料转成可检索索引，帮助后续 session 复用上下文。

## 职责

- `artifact_search` 查询历史 plans 与 ledgers。
- `milestone_artifact_search` 按 milestone 查询 feature、decision、session artifacts。
- `artifact-auto-index` hook 在写入关键 artifact 后自动入库。
- `src/indexing/` 负责 milestone artifact 分类和 ingestion。

## 链接

- [[会话连续性账本]] 依赖该索引提高跨会话恢复能力。
