---
title: 运行时部署工作流
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:docs/runtime-deploy.md
  - code:scripts/deploy-runtime.ts
---
# 运行时部署工作流

本仓库 `/root/CODE/micode` 是开发 checkout，live OpenCode plugin 从 `/root/.micode` 加载；只改开发 checkout 不会自动影响运行时。

## Mechanics

- `bun run deploy:runtime -- --dry-run` 预览同步和构建操作。
- `bun run deploy:runtime` 同步到 runtime checkout、必要时安装依赖、构建并验证 bundle。
- 同步保留 runtime-local state，例如 `node_modules`、`.git`、`thoughts` 和环境文件。
- helper 成功后只报告 runtime ready，不重启 OpenCode；restart 必须由用户明确批准。

## Links

- [[Runtime Deploy 脚本]] 实现该行为。
