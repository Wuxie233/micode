---
title: 远程 Git 所属误推
tags: [atlas, risk]
sources:
  - code:src/lifecycle/pre-flight.ts
  - code:tests/lifecycle/pre-flight.test.ts
  - code:AGENTS.md
---
# 远程 Git 所属误推

## 风险

仓库通常是用户 fork；如果 agent 把 push、issue、PR 或 merge 发到 upstream，可能泄露未完成工作或污染上游项目。

## 缓解措施

- remote mutation 前运行 `git remote -v` 与 `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`。
- fork 场景只推 `origin`，不碰 `upstream`。
- 禁止 force push，除非用户在当前回合明确要求且目标安全。

## 链接

- [[Lifecycle 状态机]]
