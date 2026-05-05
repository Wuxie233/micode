# Project Atlas

Project Atlas 是由项目所有者和 agents 共同维护的项目知识层。本 vault 使用 Markdown、YAML frontmatter 和 Obsidian wikilinks 表达项目结构、行为、决策和风险。

## Layout

- `00-index.md`: 项目总索引和阅读入口。
- `10-impl/`: Build layer，记录模块、子系统、依赖和内部结构。
- `20-behavior/`: Behavior layer，记录用户可见行为、规则和机制。
- `30-context/`: Context layer，记录外部依赖、运行时和环境边界。
- `40-decisions/`: Decisions layer，记录关键架构决策。
- `50-risks/`: Risks layer，记录已知风险和缓解方式。
- `_meta/`: 维护日志、challenge 和内部运行记录。

## How updates happen

`/atlas-init` 会生成初始 vault。后续 `/atlas-status` 可检查健康状态，`/atlas-refresh` 可记录或刷新目标区域。人工编辑后的节点应保留语义清晰的 H1 标题和 wikilinks，方便后续 reconcile。

## Commit discipline

Atlas 变更使用 `atlas:` 前缀提交，并且不应和功能代码提交混在一起。可用 `git log --invert-grep='^atlas:'` 过滤 atlas 噪声。

## Schema

当前 cold-init 节点采用轻量 frontmatter，至少包含 `tags: [atlas, <layer>]`。跨节点引用使用 Obsidian wikilinks，例如 `[[Plugin Composition]]`。
