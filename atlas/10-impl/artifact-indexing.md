---
tags: [atlas, impl]
---
# Artifact Indexing

`src/tools/artifact-index/`、`src/tools/artifact-search.ts`、`src/tools/milestone-artifact-search.ts` 与 `src/indexing/` 维护 plans、ledgers 和 milestone artifacts 的 SQLite FTS 索引。

## Responsibilities

- `createArtifactIndex` 初始化 FTS tables 并提供 index/search 操作。
- `artifact_search` 查询历史 plans 和 ledgers。
- `milestone_artifact_search` 按 milestone 和 artifact type 检索 feature、decision、session 记录。
- `classifyMilestoneArtifact` 与 `ingestMilestoneArtifact` 将写入内容分类并摄取。
- `artifact-auto-index` hook 在相关文件写入后触发索引更新。

## Links

- 支撑 [[Session Continuity Ledgers]] 和 [[Brainstorm Plan Implement Workflow]] 的历史搜索。
- 与 [[Project Memory Store]] 分工，前者索引 raw artifacts，后者保存结构化长期记忆。
