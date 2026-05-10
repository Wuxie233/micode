# FlyBuild issue-40 snapshot

**Worktree:** /root/CODE/issue-40-mcp-challenge-mcauth
**Branch:** issue/40-mcp-challenge-mcauth
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state

Command: `git rev-parse --abbrev-ref HEAD && git status --porcelain && git log --oneline -20 && git rev-parse HEAD && git rev-parse @{u} 2>/dev/null || true`

```text
issue/40-mcp-challenge-mcauth
768b3da chore(ffm-client): 对齐 MCP challenge 协议链路待生产验证 (#40)
d171e59 Merge branch 'issue/39-mcp-challenge'
59df63c chore(ffm-client): 恢复 MCP challenge 强制执行 (#39)
7bef304 merge: 同步远端 master 后完成 #38
e4fa82d Merge branch 'issue/38-issue-work'
5560912 chore(engine): 合入 latest-only 并遏制禁入重试 (#38)
8e9d925 chore(engine): 遏制网易禁入重试消耗账号池 (#38)
a59cabe fix(engine): 被动 OP 等待改为权限信号 refs #36
fff18b7 feat(ffm-client): 支持空 route mask override 与 challenge 日志 refs #36
0df0f9f fix(ffm-client): 解耦 MCP challenge 与 legacy 路由 refs #36
b554dea fix(ffm-client): 恢复空 login_route 鉴权兼容兜底 refs #36
b146408 fix(engine): 将服务器封禁断开归为 terminal 错误 refs #35
eedf2be merge: 同步上游 FFM 更新 refs #34
8fa56c5 feat(ffm): 同步上游协议与 RakNet 改良 refs #34
009ec6d docs: 设计上游 FFM 同步方案 refs #34
0fc8fe0 fix(resources): 防止未知物品合成数据崩溃 refs #33
5452e5b fix(worker): capture stderr for crash diagnostics refs #32
93324e9 feat(import): 暴露三机器人实验选项 refs #30
3f4d737 fix(protocol): 跳过空 cached packet 通道 refs #31
290aa20 docs: 更新 snapshot resume 安全契约 refs #30
768b3da4f8250f0d8660101c276c5ddea7871bec
768b3da4f8250f0d8660101c276c5ddea7871bec
```

`git status --porcelain` produced no entries.

## Default-branch comparison

Command: `git fetch origin --prune && DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name) && echo "default-branch: $DEFAULT" && git log --oneline origin/$DEFAULT..HEAD && git log --oneline HEAD..origin/$DEFAULT`

```text
default-branch: master
--- ahead origin/master..HEAD ---
768b3da chore(ffm-client): 对齐 MCP challenge 协议链路待生产验证 (#40)
--- behind HEAD..origin/master ---
5c84b11 Merge branch 'issue/63-empty-route-3-8-16-1-21-90-loading-screen'
bf4409c fix(ffm): 提升空路由 3.8 patch 阈值至 3.8.17
d4813ee Merge branch 'issue/62-empty-route-loading-screen-handshake-mcp-badpack'
a2d5f29 chore(minecraft): 实现空路由 loading-screen A/B (#62)
81d2464 Merge branch 'issue/61-empty-route-3-8-16-patch-metadata-mcp-badpacket'
917bfe0 chore(protocol): 将 3.8.16 patch metadata 选择默认协议 (#61)
9aa28ae Merge branch 'issue/60-flyauth-patch-metadata-mcp-badpacket'
1d59d43 chore(protocol): 根据 FlyAuth 3.8.17 patch metadata 选择默认协议 (#60)
1453743 Merge branch 'issue/59-flyauth-code-32'
66c8ef1 chore(worker): 识别 FlyAuth code:32 并移除耗尽旧文案 (#59)
45f7a86 Merge branch 'issue/58-flyauth-cookie'
49875e1 chore(worker): 修正 FlyAuth cookie 重试归因与协议观测 (#58)
47866d2 chore(plan): 记录 FlyAuth cookie 重试误归因实施计划 (#58)
160d4be chore(design): 记录 FlyAuth cookie 重试误归因修复设计 (#58)
f8e39ed fix(worker): 构建时注入版本号，消除 Worker 自报 dev 问题 closes #49
9725650 Merge pull request #57 from wuxieTeam/issue/50-worker-stderr-diag-level
1d0d19f fix(worker): 诊断行改 stdout，消除 task_logs error 污染 closes #50
41e19cb docs(ops): 修正生产数据库端口文档，closes #52
fb51c28 fix(worker): 构建时注入版本号，消除 Worker 自报 dev 问题 closes #49
e5ac0b8 feat(engine): 协议/Challenge 阶段观测字段结构化落入 task_logs closes #51
087c48f Merge remote-tracking branch 'origin/master' into pr55-local-test
c500dbe fix(worker): 修复启动诊断 postlogin_mask 字段恒为空 closes #48
3c94a8e feat(engine): 协议/Challenge 阶段观测字段结构化落入 task_logs closes #51
ae4248f fix(engine): FlyAuth RPC terminal 分类 + 登录错误序列聚合
0622659 fix(ffm): 修复协议 wire ID 漂移、PyRpc 未知类型日志、FlyAuth 超时可区分性 (#41 #42 #43)
7f3ef27 fix(ffm): 修复协议 wire ID 漂移、PyRpc 未知类型日志、FlyAuth 超时可区分性
90b3306 fix(ffm): 修复协议 wire ID 漂移、PyRpc 未知类型日志、FlyAuth 超时可区分性
24c8549 fix(worker): 修复启动诊断 postlogin_mask 字段恒为空 closes #48
```

## Ownership preflight

Command: `git remote -v && gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`

```text
origin	https://github.com/wuxieTeam/FlyBuild.git (fetch)
origin	https://github.com/wuxieTeam/FlyBuild.git (push)
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyBuild","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-own
**Reasoning:** `origin` points to `wuxieTeam/FlyBuild`, `gh repo view` reports `isFork:false`, no parent repo, and viewer permission is `ADMIN`, so origin is the safe owned target.

## PR status

Command: `gh pr list --head issue/40-mcp-challenge-mcauth --state all --json number,state,title,url`

```json
[]
```

## Project type detection

Command: `ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null || true`

```text
package.json
```

Detected project type: Node/package-managed repository at repo root, with additional Go subprojects visible in the diff scope.

## Research-heaviness assessment

Command: `git diff --name-only origin/master..HEAD`, doc-pattern count, and `git diff --shortstat origin/master..HEAD`

### Changed files

```text
.gitignore
.opencode/skills/.state.json
AGENTS.md
scripts/deploy-linux.sh
scripts/playwright-tests/deployment-health.spec.ts
scripts/publish-worker-version.sh
src/flowers-for-machines/client/mcp_challenge_logging_test.go
src/flowers-for-machines/client/mcp_challenge_solve.go
src/flowers-for-machines/core/bunker/auth/client.go
src/flowers-for-machines/core/bunker/auth/mcauth_check_num_vector_test.go
src/flowers-for-machines/core/bunker/auth/transfer_http_test.go
src/flowers-for-machines/core/minecraft/conn.go
src/flowers-for-machines/core/minecraft/conn_loginflow_test.go
src/flowers-for-machines/core/minecraft/loading_screen_route_test.go
src/flowers-for-machines/core/minecraft/protocol.go
src/flowers-for-machines/core/minecraft/protocol/packet/id.go
src/flowers-for-machines/core/minecraft/protocol/packet/item_component.go
src/flowers-for-machines/core/minecraft/protocol/packet/item_registry.go
src/flowers-for-machines/core/minecraft/protocol/packet/pool.go
src/flowers-for-machines/core/minecraft/protocol/packet/start_game.go
src/flowers-for-machines/core/minecraft/protocol/packet/start_game_drift_test.go
src/flowers-for-machines/core/minecraft/protocol/packet/start_game_test.go
src/flowers-for-machines/core/minecraft/protocol/packet/wire_drift_test.go
src/flowers-for-machines/core/minecraft/protocol_pool_alignment_test.go
src/flowers-for-machines/core/minecraft/protocol_route_test.go
src/flowers-for-machines/core/py_rpc/unmarshal_test.go
src/flybuild-server/Makefile
src/flybuild-server/cmd/worker/main.go
src/flybuild-server/cmd/worker/main_test.go
src/flybuild-server/configs/config.example.yaml
src/flybuild-server/internal/engine/exporter.go
src/flybuild-server/internal/engine/exporter_login_observation_test.go
src/flybuild-server/internal/engine/importer.go
src/flybuild-server/internal/engine/importer_login_observation_test.go
src/flybuild-server/internal/engine/protocol_observation.go
src/flybuild-server/internal/engine/protocol_observation_safe_test.go
src/flybuild-server/internal/engine/protocol_observation_test.go
src/flybuild-server/internal/engine/retry.go
src/flybuild-server/internal/engine/terminal_classifier_test.go
src/flybuild-server/internal/engine/terminal_subcause_test.go
src/flybuild-server/internal/process/manager_test.go
src/flybuild-server/internal/process/protocol.go
src/flybuild-server/internal/scheduler/scheduler.go
src/flybuild-server/internal/worker/executor.go
src/flybuild-server/internal/worker/reporter.go
src/flybuild-server/internal/worker/reporter_terminal_test.go
thoughts/shared/designs/2026-05-05-flyauth-cookie-retry-attribution-design.md
thoughts/shared/plans/2026-05-04-mcp-challenge-upstream-alignment.md
thoughts/shared/plans/2026-05-05-flyauth-cookie-retry-attribution.md
thoughts/shared/plans/2026-05-08-empty-route-loading-screen-handshake.md
thoughts/shared/research/2026-05-04-flybuild-vs-upstream-packet-ids.md
thoughts/shared/research/2026-05-04-issue40-prod-validation.md
thoughts/shared/research/2026-05-04-issue40-test-summary.md
thoughts/shared/research/2026-05-04-task-fdaffdd5-baseline.md
thoughts/shared/research/2026-05-05-flyauth-blocked-isolation-followup.md
```

**Doc-pattern files / total:** 10 / 55
**Doc-pattern recount:** Re-run with the exact Task 1.7 regex (`\.(md|txt|pdf|docx?|adoc)$|^docs/|^research/|^notes/`) after `git fetch origin --prune`; result is 10 / 55, so the expected 11 / 55 correction was not confirmed.
**Shortstat:** 55 files changed, 1942 insertions(+), 4957 deletions(-)

**Heaviness verdict:** mixed
**Recommended Batch 3 action:** advance-to-PR (preserve, no merge)

Rationale: the branch has one feature commit ahead of `origin/master` but is significantly behind current default; the diff contains both implementation/test changes and 10 doc-pattern files (including `AGENTS.md` plus design/plan/research artifacts), so it should be preserved for human review rather than auto-merged during rescue.

## Advancement

**Ownership preflight reconfirmed:** safe-origin-own (`origin` = `https://github.com/wuxieTeam/FlyBuild.git`, `gh repo view` = `isFork:false`, owner `wuxieTeam`, viewer permission `ADMIN`)
**Heaviness verdict applied:** mixed
**Action taken:** pr-created-pending-human
**PR URL:** https://github.com/wuxieTeam/FlyBuild/pull/65
**Verification command:** `go test ./...` in `src/flowers-for-machines`; `go test ./...` in `src/flybuild-server`
**Verification result:** fail
**PR state:** open, non-draft, mergeable=`CONFLICTING`, mergeStateStatus=`DIRTY`
**Final branch state:** open-pr

Notes:
- Branch was already in sync with `origin/issue/40-mcp-challenge-mcauth`; no push was needed.
- Mixed verdict path requires non-draft PR and no auto-merge; PR #65 was created and left open for human review.
- `src/flybuild-server` verification passed.
- `src/flowers-for-machines` verification failed in `github.com/OmineDev/flowers-for-machines/client` on `postLoginSendMask` expectations (`0x7b` observed where tests expect `0x7f` or `0`).
