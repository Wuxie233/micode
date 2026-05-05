---
tags: [atlas, impl]
---
# Tools Registry

`src/tools/index.ts` 是工具导出入口，[[Plugin Composition]] 再按运行时依赖创建具体 tool map。

## Responsibilities

- 导出 `artifact_search`、`milestone_artifact_search`、`look_at`、`ast_grep_*`、`btca_ask` 等静态工具。
- 导出 `createBatchReadTool`、`createMindmodelLookupTool`、`createOcttoTools`、`createPtyTools`、project memory tool factories。
- 把工具层和内部子系统隔离，避免 `src/index.ts` 直接依赖过多实现细节。
- 给 agent prompt 提供稳定 tool names，例如 `spawn_agent`、`resume_subagent`、`project_memory_lookup`。

## Links

- [[Spawn Agent Tool]] 是并行子代理工具。
- [[PTY Tools]]、[[Project Memory Store]]、[[Octto Session System]] 都通过该层暴露。
