---
tags: [atlas, impl]
---
# Project Memory Store

`src/project-memory/` 与 `src/tools/project-memory/` 用 SQLite 和 FTS 保存项目隔离的 durable memory，用于记录决策、教训、风险、问题和流程。

## Responsibilities

- `createProjectMemoryStore` 管理 entity、entry、source 和 relation 数据。
- `promoteMarkdown` 从 lifecycle、ledger、plan 或手动 markdown 中提取结构化候选。
- `lookup` 通过 FTS 检索条目，并按敏感级别、状态和类型过滤。
- `health` 汇总存储健康状态，`forget` 支持 project、entity、entry、source 级删除。
- tool factories 暴露 `project_memory_lookup`、`project_memory_promote`、`project_memory_health`、`project_memory_forget`。

## Links

- [[Issue Driven Lifecycle]] 在完成时可自动推广经验。
- [[Artifact Indexing]] 负责检索 thoughts artifacts，两者形成不同知识层。
