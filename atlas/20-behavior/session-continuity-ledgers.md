---
title: 会话连续性账本
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:src/agents/ledger-creator.ts
  - code:src/hooks/ledger-loader.ts
  - code:src/hooks/auto-compact.ts
  - code:src/tools/artifact-search.ts
---
# 会话连续性账本

micode 用 `thoughts/ledgers/CONTINUITY_*.md` 和 artifact search 保存跨会话上下文，让长期任务可以在压缩或重开后继续。

## 机制

- `/ledger` 创建或更新当前会话账本。
- `ledger-loader` hook 会把最新账本注入上下文。
- `auto-compact` 在上下文接近阈值时总结并写 ledger。
- `artifact-auto-index` 与 `artifact_search` 支持检索过往 plans 和 ledgers。

## 链接

- [[Artifact 索引]] 提供搜索能力。
