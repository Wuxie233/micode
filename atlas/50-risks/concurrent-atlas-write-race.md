---
tags: [atlas, risk]
---
# Concurrent Atlas Write Race

Atlas 写锁使用锁文件记录 pid、runId 和 acquiredAt，但检查与写入之间不是完全原子，极端并发下可能出现竞争。

## Impact

- 两个 atlas run 可能同时认为自己获得写锁。
- 后写入的 run 可能覆盖前一个 run 的 staging 或目标节点。
- 人工编辑保护和 challenge 路由可能基于过期 mtime 判断。

## Mitigation

- 避免并发执行多个 atlas 写命令。
- [[Atlas Vault System]] 使用 staging 和维护日志降低部分写入风险。
- 后续改进可考虑 `O_EXCL` 原子创建锁文件和更严格的 run ownership 校验。
