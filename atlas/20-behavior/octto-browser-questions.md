---
title: Octto 浏览器问题流
tags: [atlas, behavior]
sources:
  - code:README.md
  - code:src/octto/*
  - code:src/tools/octto/*
---
# Octto 浏览器问题流

Octto 是浏览器辅助的设计探索和问答系统，适合多问题、多选项、计划审阅、diff 审阅和 brainstorm 分支场景。

## Mechanics

- 每个 session 归属于创建它的 OpenCode conversation，跨 conversation 操作会被拒绝。
- 支持多种问题类型，例如 confirm、pick_one、pick_many、ask_text、show_plan、show_diff、rank、rate 和 brainstorm。
- 浏览器 UI 使用 draft-before-send，用户确认发送后答案才回到 agent。
- answer 到达后，persistence 与 auto-resume 会恢复对应 OpenCode 会话。

## Links

- [[Octto 会话系统]] 实现该行为。
