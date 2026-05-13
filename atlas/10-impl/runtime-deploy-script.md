---
title: Runtime Deploy 脚本
tags: [atlas, impl]
sources:
  - code:scripts/deploy-runtime.ts
  - code:src/utils/runtime-deploy/*
  - code:docs/runtime-deploy.md
---
# Runtime Deploy 脚本

`scripts/deploy-runtime.ts` 是把开发 checkout 同步到 live OpenCode plugin checkout 的运行时部署助手，入口命令是 `bun run deploy:runtime`。

## Responsibilities

- 支持 `--dry-run` 预览和 apply 模式执行。
- 校验 source/runtime cleanliness、工具可用性和 lockfile 状态。
- 使用受控同步规则保留 runtime-local state。
- 在 runtime checkout 中安装依赖、构建并验证 `dist/index.js`。
- 明确不重启 OpenCode，restart 必须由用户单独批准。

## Links

- [[运行时部署工作流]] 描述用户操作步骤。
- [[运行时 Checkout 漂移]] 是该模块缓解的主要风险。
