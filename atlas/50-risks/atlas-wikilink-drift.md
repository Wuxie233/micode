---
tags: [atlas, risk]
---
# Atlas Wikilink Drift

Atlas 节点依赖 H1 标题和 Obsidian wikilinks，如果重命名节点但没有同步链接，就会出现 broken link 或误导性关系。

## Impact

- `00-index.md` 或节点间链接无法跳转。
- 行为节点可能指向不存在的实现节点。
- 长期维护后知识图谱会逐步失真。

## Mitigation

- [[Atlas Vault System]] 的 status 和 broken link scanner 应定期运行。
- 新节点只链接已存在 H1，重命名时批量更新 wikilinks。
- 维护日志记录推断和警告，便于下次 refresh 校正。
