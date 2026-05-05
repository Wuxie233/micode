---
tags: [atlas, decision]
---
# Atlas as Obsidian Vault

项目知识库输出为 `atlas/` 下的 Obsidian Markdown vault，使用分层目录和 wikilinks 组织实现、行为、上下文、决策和风险。

## Rationale

- [[Atlas Vault System]] 能把代码发现和历史事实转成可人工阅读、可增量维护的节点。
- Obsidian wikilinks 让模块、行为和决策之间的关系可浏览。
- 分层目录把实现事实和用户行为、架构决策、风险缓解分开。

## Consequences

- 需要维护 wikilink 目标和 H1 标题一致性。
- 需要维护日志记录推断、警告和生成范围，避免 atlas 成为黑盒产物。
