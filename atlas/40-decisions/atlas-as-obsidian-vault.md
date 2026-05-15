---
title: Atlas 作为 Obsidian Vault
tags: [atlas, decision]
sources:
  - code:atlas/README.md
  - code:src/atlas/*
  - code:AGENTS.md
---
# Atlas 作为 Obsidian Vault

## 决策

Project Atlas 使用 `atlas/` Markdown vault、YAML frontmatter 和 Obsidian wikilinks 表达项目结构、行为、决策和风险。

## 理由

Markdown vault 同时适合人类阅读、Obsidian 图谱和 agent 检索，比私有缓存更容易长期维护。

## 影响

节点必须保持 H1、tags、中文正文和可解析 wikilinks；批量刷新应通过 atlas 命令或明确维护流程进行。
