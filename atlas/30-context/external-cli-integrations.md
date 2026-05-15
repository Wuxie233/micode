---
title: 外部 CLI 集成
tags: [atlas, context]
sources:
  - code:src/tools/ast-grep/*
  - code:src/tools/btca/*
  - code:scripts/deploy-runtime.ts
---
# 外部 CLI 集成

micode 依赖若干外部 CLI 或系统命令来补充代码搜索、库源码问答、部署同步和 GitHub 交付能力。

## 角色

- `sg` 支撑 AST-aware search/replace。
- `btca` 支撑库源码问答。
- `git` 与 `gh` 支撑 [[Lifecycle 状态机]]。
- `rsync`、`bun` 和 shell 命令支撑 [[Runtime Deploy 脚本]]。

## 备注

外部 CLI 缺失通常应降级为 warning 或清晰失败，不应让无关能力同时失效。
