---
title: 并发 Atlas 写入竞争
tags: [atlas, risk]
sources:
  - code:src/atlas/write-lock.ts
  - code:src/atlas/staging.ts
  - code:tests/atlas/concurrency.test.ts
---
# 并发 Atlas 写入竞争

## 风险

多个 agent 或命令同时写 `atlas/` 时，可能覆盖彼此节点、留下 staging 残留或产生 challenge 冲突。

## 缓解措施

- 使用 Atlas write lock、staging 和 atomic commit 语义。
- 对人工编辑冲突走 challenge 或 delta fallback。
- 日常维护优先小范围节点更新，避免无必要全量刷新。

## 链接

- [[Atlas Vault 系统]]
