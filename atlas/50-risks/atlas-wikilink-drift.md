---
title: Atlas Wikilink 漂移
tags: [atlas, risk]
sources:
  - code:src/atlas/wikilink.ts
  - code:tests/atlas/broken-link-scanner.test.ts
  - code:atlas/README.md
---
# Atlas Wikilink 漂移

## 风险

Atlas 节点改名、H1 改动或批量重建后，旧 wikilinks 可能指向不存在的节点，削弱 Obsidian 图谱和 agent lookup 的可用性。

## 缓解措施

- 节点 H1、frontmatter title 和 index wikilink 需要一起维护。
- 批量写入后扫描 wikilink target 是否存在。
- 避免在正文中混用 markdown 相对链接作为跨节点引用。

## 链接

- [[Atlas Vault 系统]]
