---
tags: [atlas, risk]
---
# Runtime Checkout Drift

开发 checkout `/root/CODE/micode` 与 live plugin checkout `/root/.micode` 分离，容易出现“源码已改但运行时未加载”的误判。

## Impact

- 修复在开发目录通过测试，但 OpenCode 仍运行旧 `dist/index.js`。
- 直接重启 OpenCode 也不会加载未同步的开发改动。

## Mitigation

- 对运行时敏感改动使用 [[Runtime Deploy Workflow]]。
- helper 成功后仍需用户批准才可重启 OpenCode。
- 调试旧行为时先核对 [[Local Runtime Checkout]] 和 live bundle 内容。
