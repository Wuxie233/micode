---
title: 本地 Runtime Checkout
tags: [atlas, context]
sources:
  - code:README.md
  - code:docs/runtime-deploy.md
---
# 本地 Runtime Checkout

当前服务器存在开发 checkout `/root/CODE/micode` 和 live plugin checkout `/root/.micode` 两个位置。

## 角色

- 开发和提交通常发生在 `/root/CODE/micode`。
- OpenCode 实际加载 `/root/.micode/dist/index.js`。
- [[Runtime Deploy 脚本]] 负责把开发变更同步、构建并验证到 live checkout。

## 备注

这个双 checkout 结构提升了运行时安全性，但也带来 [[运行时 Checkout 漂移]] 风险。
