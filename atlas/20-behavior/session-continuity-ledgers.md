---
tags: [atlas, behavior]
---
# Session Continuity Ledgers

Ledger 机制把跨会话状态保存到 `thoughts/ledgers/CONTINUITY_*.md`，减少上下文压缩或新会话带来的信息丢失。

## Mechanics

- `/ledger` 可创建或更新当前会话的连续性记录。
- `ledger-loader` 在 prompt 注入最新 continuity ledger。
- `auto-compact` 在上下文压力达到阈值时总结会话并写入 ledger。
- `artifact-auto-index` 会把 ledger 纳入检索，便于后续恢复。

## Links

- [[Hooks Pipeline]] 装配 ledger 和 auto-compact hooks。
- [[Artifact Indexing]] 支持 ledger 搜索。
