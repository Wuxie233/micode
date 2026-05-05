---
tags: [atlas, context]
---
# Local Runtime Checkout

本服务器上有开发 checkout `/root/CODE/micode` 和 live plugin checkout `/root/.micode` 两个目录，它们服务不同目的。

## Notes

- 开发 checkout 用于编辑、测试和提交源码。
- OpenCode 实际加载 live checkout 的 `dist/index.js`。
- [[Runtime Deploy Workflow]] 是把开发改动安全送到 live checkout 的标准路径。
- [[Runtime Checkout Drift]] 是该环境最容易产生误判的运行风险。
