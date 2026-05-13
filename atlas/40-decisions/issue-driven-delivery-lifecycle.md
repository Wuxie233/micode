---
title: Issue 驱动交付生命周期
tags: [atlas, decision]
sources:
  - code:src/lifecycle/*
  - code:src/tools/lifecycle/*
  - code:AGENTS.md
---
# Issue 驱动交付生命周期

## Decision

非平凡交付默认可以进入 issue-driven lifecycle，由工具创建 issue、branch、worktree，并在 checkpoint commit/push，最终 merge/close/cleanup。

## Rationale

它把长期任务的状态外显到 GitHub issue 和本地 record，减少跨会话丢失上下文的概率。

## Consequences

所有 remote mutation 必须经过 ownership preflight；lifecycle 是 source provider，不自动写 Atlas 或 Project Memory。
