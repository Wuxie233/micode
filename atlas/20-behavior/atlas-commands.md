---
tags: [atlas, behavior]
---
# Atlas Commands

Atlas commands 维护 `atlas/` Obsidian vault，让项目结构、行为、决策和风险以 Markdown 节点形式长期保存。

## Mechanics

- `/atlas-init` 执行冷初始化，生成分层 vault 和维护日志。
- `/atlas-status` 报告 open challenges、broken wikilinks、orphan staging dirs 和最近成功 run。
- `/atlas-refresh` 写入刷新日志，并在未初始化或写锁占用时返回明确状态。
- `/atlas-translate` 保留结构并翻译 vault 内容。
- fresh 初始化遇到已有 vault 时需要 reconcile 或 force rebuild 策略，避免无意覆盖人工维护内容。

## Links

- [[Atlas Vault System]] 实现命令和 vault IO。
- [[Atlas as Obsidian Vault]] 记录这个知识库形态。
