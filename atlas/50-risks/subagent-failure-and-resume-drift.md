---
tags: [atlas, risk]
---
# Subagent Failure and Resume Drift

并行 subagent 可以显著提速，但失败、阻塞或 session 过期会导致上下文丢失、重复探索或结论不一致。

## Impact

- 重新派发可能浪费已完成的部分分析。
- 多个 worker 的 claim 可能互相冲突。
- 过期 session 无法 resume，协调者需要人工判断是否接受残缺输出。

## Mitigation

- 优先使用 [[Spawn Agent Tool]] 的 preserved session 和 `resume_subagent`。
- 批量结果按 task 分类处理，不让一个 worker 失败拖垮整批。
- reconcile 阶段去重 claim，并把冲突写入 challenge 或维护日志。
