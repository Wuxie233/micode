---
title: Atlas Vault 系统
tags: [atlas, impl]
sources:
  - code:src/atlas/*
  - code:src/tools/atlas/*
  - code:atlas/README.md
---
# Atlas Vault 系统

`src/atlas/`、`src/tools/atlas/` 和 `atlas/` 共同构成 Project Atlas：一个面向人和 AI 的 Obsidian vault，用 Markdown、frontmatter 和 wikilinks 表达项目心智模型。

## 职责

- 定义 Atlas layers、node schema、frontmatter、wikilink、source link 与 repo URL 处理。
- 提供 `atlas_lookup`、`/atlas-init`、`/atlas-status`、`/atlas-refresh`、`/atlas-translate`。
- 支持 cold-init、staging、reconcile、challenge、delta fallback 和 broken link 扫描。
- 让日常 agent 在 Read / Maintain / Verify / Report 协议中维护共享知识。

## 链接

- [[Atlas 命令]] 描述用户入口。
- [[Atlas 作为 Obsidian Vault]] 记录该设计决策。
- [[Atlas Wikilink 漂移]] 记录主要一致性风险。
