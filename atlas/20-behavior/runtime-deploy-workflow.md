---
tags: [atlas, behavior]
---
# Runtime Deploy Workflow

运行时部署流程把开发 checkout 的改动同步到 live plugin checkout，并构建 live `dist/index.js`。

## Mechanics

- 开发路径是 `/root/CODE/micode`，live plugin 路径是 `/root/.micode`。
- runtime 敏感变更后运行 `bun run deploy:runtime`，不是只在开发 checkout 里 `bun run build`。
- helper 会保留 live 目录中的状态、依赖、`.git`、`thoughts` 和 env 文件。
- helper 成功后仍不能自动重启 OpenCode，必须先得到用户明确批准。

## Links

- [[Runtime Deploy Script]] 实现同步和构建。
- [[Runtime Checkout Drift]] 说明为什么这个流程重要。
