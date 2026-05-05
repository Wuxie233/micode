---
tags: [atlas, impl]
---
# Mindmodel Runtime

`src/mindmodel/`、`.mindmodel/` 与 `src/agents/mindmodel/` 共同实现项目约束加载、分类、格式化、审查和生成。

## Responsibilities

- `loadMindmodel` 读取 `.mindmodel/manifest.yaml` 和约束 markdown。
- classifier prompt 根据任务需求选择相关 category。
- formatter 把 rules、examples、antiPatterns 渲染成可注入 prompt 的上下文。
- review parser 解析 `mm-constraint-reviewer` 的违规结果。
- mindmodel agent 群负责 stack detection、dependency mapping、pattern discovery 和 constraint writing。

## Links

- 实现 [[Mindmodel Constraint Enforcement]]。
- 与 [[Hooks Pipeline]] 和 [[Tools Registry]] 协作。
