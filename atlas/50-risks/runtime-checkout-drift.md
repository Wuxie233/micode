---
title: 运行时 Checkout 漂移
tags: [atlas, risk]
sources:
  - code:README.md
  - code:docs/runtime-deploy.md
  - code:scripts/deploy-runtime.ts
---
# 运行时 Checkout 漂移

## 风险

开发 checkout `/root/CODE/micode` 与 live checkout `/root/.micode` 分离，源码变更如果没有部署到 runtime，用户会看到“代码已改但工具行为没变”。

## 缓解措施

- Runtime-sensitive 变更后运行 [[Runtime Deploy 脚本]]。
- 用 dry run 先确认同步范围。
- 成功后仍需用户明确批准才能重启 OpenCode。

## 链接

- [[运行时部署工作流]]
