---
tags: [atlas, impl]
---
# Atlas Vault System

`src/atlas/`、`src/tools/atlas/` 与 `src/agents/atlas-*` 维护项目 `atlas/` Obsidian vault，包括冷初始化、状态检查、刷新、翻译、wikilink、frontmatter、staging、challenge 和写锁。

## Responsibilities

- `runAtlasInit` 处理 fresh、reconcile、force-rebuild 模式。
- cold-init 流程发现项目、合成 vault plan、可选询问 Octto、再写入节点。
- page reader/writer 解析 frontmatter、sections 和 wikilinks，并通过 staging 做原子提交。
- status 检查 open challenges、broken wikilinks、orphan staging dirs 和 last successful run。
- conflict router、challenge writer、soft delete planner 保护人工编辑和过期节点。

## Links

- 实现 [[Atlas Commands]]。
- [[Atlas as Obsidian Vault]] 记录输出形态决策。
- [[Atlas Wikilink Drift]] 与 [[Concurrent Atlas Write Race]] 记录主要风险。
