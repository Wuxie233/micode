---
tags: [atlas, impl]
---
# Runtime Deploy Script

`scripts/deploy-runtime.ts` 和 `docs/runtime-deploy.md` 描述从开发 checkout `/root/CODE/micode` 同步到 live plugin `/root/.micode` 的运行时部署流程。

## Responsibilities

- 执行 preflight，检查源 checkout、runtime checkout、必要工具和 dirty 状态。
- 用 selective sync 保留 runtime-local `node_modules`、`dist`、`.git`、`thoughts`、env 文件和缓存。
- 需要时执行 `bun install --frozen-lockfile`，再构建 live `dist/index.js`。
- 成功时打印 `Runtime ready. Restart of OpenCode requires explicit user approval.`。
- 绝不自动重启 OpenCode，重启必须由用户显式批准。

## Links

- 实现 [[Runtime Deploy Workflow]]。
- [[Runtime Checkout Drift]] 记录这个双 checkout 模式的主要风险。
