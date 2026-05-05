---
tags: [atlas, impl]
---
# Hooks Pipeline

`src/hooks/` 提供 OpenCode lifecycle hook factories，[[Plugin Composition]] 按 chat、tool、event 阶段装配它们。

## Responsibilities

- `context-injector`、`ledger-loader`、`fragment-injector`、`mindmodel-injector` 给 prompt 注入项目上下文。
- `auto-compact`、`context-window-monitor`、`token-aware-truncation` 控制上下文体积和工具输出。
- `artifact-auto-index`、`file-ops-tracker`、`fetch-tracker` 追踪 artifact、文件和 fetch 行为。
- `constraint-reviewer` 与 `comment-checker` 在写入后检查约束和评论质量。
- `conversation-title` 与 `session-recovery` 维护会话体验和恢复路径。

## Links

- [[Session Continuity Ledgers]] 依赖 ledger 与 auto-compact hooks。
- [[Mindmodel Constraint Enforcement]] 依赖 mindmodel injector 与 constraint reviewer。
- [[Factory Hooks with Dependency Injection]] 记录 hook 工厂模式。
