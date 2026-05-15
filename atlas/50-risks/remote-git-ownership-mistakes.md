---
title: 远程 Git 所属误推
tags: [atlas, risk]
sources:
  - code:src/lifecycle/pre-flight.ts
  - code:tests/lifecycle/pre-flight.test.ts
  - code:AGENTS.md
---
# 远程 Git 所属误推

## Risk

仓库通常是用户 fork；如果 agent 把 push、issue、PR 或 merge 发到 upstream，可能泄露未完成工作或污染上游项目。

## Mitigation

- remote mutation 前运行 `git remote -v` 与 `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`。
- fork 场景只推 `origin`，不碰 `upstream`。
- 所有 issue / push / PR / merge / remote branch delete 等 remote mutation 都必须经过 `assertRemoteMutationAllowed`；UNKNOWN / UPSTREAM / local-only 场景 fail closed，只保留本地状态或返回 recovery hint。
- 禁止 force push，除非用户在当前回合明确要求且目标安全。

## Links

- [[Lifecycle 状态机]]
