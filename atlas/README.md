# Project Atlas

Project Atlas 是由项目所有者和 agents 共同维护的项目知识层。本 vault 使用 Markdown、YAML frontmatter 和 Obsidian wikilinks 表达项目结构、行为、决策、上下文和风险。

## 布局

- `00-index.md`: 项目总索引和阅读入口。
- `10-impl/`: Build layer，记录模块、子系统、依赖和内部结构。
- `20-behavior/`: Behavior layer，记录用户可见行为、规则和机制。
- `30-context/`: Context layer，记录外部依赖、运行时和环境边界。
- `40-decisions/`: Decisions layer，记录关键架构决策。
- `50-risks/`: Risks layer，记录已知风险和缓解方式。
- `_meta/`: 维护日志、challenge 和内部运行记录。

## Schema

节点至少包含 `title` 与 `tags: [atlas, <layer>]`。正文跨节点引用使用 Obsidian wikilinks，例如 `[[插件组合]]`。

## 维护

本 vault 由 `/all-rebuild` 的 refresh-all 流程重建。后续日常任务应按 Atlas Read / Maintain / Verify / Report 协议小范围维护相关节点。
