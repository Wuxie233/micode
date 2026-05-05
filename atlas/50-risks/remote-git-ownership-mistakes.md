---
tags: [atlas, risk]
---
# Remote Git Ownership Mistakes

远程写操作如果没有识别 fork、origin 和 upstream，可能把分支、issue 或 PR 写到错误仓库。

## Impact

- 未完成代码可能被推到 upstream 或错误账号。
- lifecycle issue、PR 或 branch 可能污染不应修改的仓库。

## Mitigation

- [[Issue Driven Lifecycle]] 的远程写操作前执行 `git remote -v` 和 `gh repo view` 分类。
- fork 场景只推 `origin`，不碰 upstream。
- 无法判断所有权时停止并向用户确认。
