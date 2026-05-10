# FlyBuild issue-37 snapshot

**Worktree:** /root/CODE/issue-37-worker
**Branch:** issue/37-worker
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state

Command: `git rev-parse --abbrev-ref HEAD`

```text
issue/37-worker
```

Command: `git status --porcelain`

```text

```

Command: `git status --short --branch`

```text
## issue/37-worker...origin/issue/37-worker
```

Command: `git log --oneline -20`

```text
80187f3 chore(engine): 安全化设置命令并强制 latest worker (#37)
0fc8fe0 fix(resources): 防止未知物品合成数据崩溃 refs #33
5452e5b fix(worker): capture stderr for crash diagnostics refs #32
93324e9 feat(import): 暴露三机器人实验选项 refs #30
3f4d737 fix(protocol): 跳过空 cached packet 通道 refs #31
290aa20 docs: 更新 snapshot resume 安全契约 refs #30
a5db14c feat(worker): 支持 snapshot-aware resume refs #30
7548718 feat(engine): 接通 snapshot 运行时编排缝 refs #30
45dcc3e docs(plan): 增加部署观察清单 refs #30
0586d1d chore(scripts): 增加三机器人导入 sanity 检查 refs #30
f01050a docs: 固化三机器人导入安全契约 refs #30
813ab29 test: 增加三机器人安全边界与兼容性覆盖 refs #30
fd34dc9 feat(worker): 增加 Helper 观测与兼容进度字段 refs #30
890f397 feat(scheduler): 增加三机器人 slot 门控与释放 refs #30
e091ff6 feat(engine): 引入三机器人只读快照与防卡死守卫 refs #30
0e021f9 feat: 搭建三机器人导入基础类型与门控骨架 refs #30
497cda8 docs(design): 记录三机器人导入重构设计 refs #30
dcedffd fix(protocol): 网易3.8使用819协议与1.21.90版本 refs #29
4efed53 fix(protocol): 空登录路由兜底到网易3.8 refs #29
9e746a6 fix(protocol): 兼容缺失路由的3.8协议选择 refs #29
```

Command: `git rev-parse HEAD`

```text
80187f399467f7a91b8c94b7ec64cec289bbfc85
```

Command: `git rev-parse @{u} 2>/dev/null || echo "(no upstream)"`

```text
80187f399467f7a91b8c94b7ec64cec289bbfc85
```

## Default-branch comparison

Command: `git fetch origin --prune && DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name) && echo "default-branch: $DEFAULT"`

```text
default-branch: master
```

Command: `git log --oneline origin/master..HEAD | head -50`

```text
80187f3 chore(engine): 安全化设置命令并强制 latest worker (#37)
```

Command: `git log --oneline HEAD..origin/master | head -10`

```text
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
```

## Deletion surface

Command: `git diff --name-status origin/master..HEAD`

**Files deleted relative to default:** 70
**Files modified:** 84
**Files added:** 0
**Shortstat:** 155 files changed, 539 insertions(+), 14830 deletions(-)

### Deleted files (top 100)

```text
D	.opencode/skills/.state.json
D	src/flowers-for-machines/client/challenge_decision.go
D	src/flowers-for-machines/client/challenge_decision_test.go
D	src/flowers-for-machines/client/empty_route_challenge_test.go
D	src/flowers-for-machines/client/login_progress_test.go
D	src/flowers-for-machines/client/login_rental_server_empty_route_test.go
D	src/flowers-for-machines/client/mcp_challenge_logging_test.go
D	src/flowers-for-machines/client/postlogin_mask_test.go
D	src/flowers-for-machines/core/bunker/auth/transfer_http_test.go
D	src/flowers-for-machines/core/minecraft/conn_writeraw_test.go
D	src/flowers-for-machines/core/minecraft/dial_test.go
D	src/flowers-for-machines/core/minecraft/loading_screen_route_test.go
D	src/flowers-for-machines/core/minecraft/protocol/login/data_username_test.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/client_camera_aim_assist.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/client_movement_prediction_sync.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/player_update_entity_overrides.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/player_video_capture.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/structure_block_update_test.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/update_client_options.go
D	src/flowers-for-machines/core/minecraft/protocol/packet/wire_drift_test.go
D	src/flowers-for-machines/core/minecraft/protocol/reader_argb_test.go
D	src/flowers-for-machines/core/minecraft/raknet/conn_lifecycle_test.go
D	src/flowers-for-machines/core/minecraft/raknet/dial_transient_test.go
D	src/flowers-for-machines/core/minecraft/raknet/handler_reliability_test.go
D	src/flowers-for-machines/core/minecraft/raknet/internal/chan_context_test.go
D	src/flowers-for-machines/core/minecraft/raknet/udp_transient_error_unix.go
D	src/flowers-for-machines/core/minecraft/raknet/udp_transient_error_unix_test.go
D	src/flowers-for-machines/core/minecraft/raknet/udp_transient_error_windows.go
D	src/flowers-for-machines/core/py_rpc/unmarshal_test.go
D	src/flowers-for-machines/game_control/resources_control/packet_handler_inventory_test.go
D	src/flowers-for-machines/nbt_assigner/nbt_assigner_ctx_test.go
D	src/flybuild-server/cmd/worker/main_test.go
D	src/flybuild-server/internal/engine/execute_import_terminal_test.go
D	src/flybuild-server/internal/engine/exporter_login_observation_test.go
D	src/flybuild-server/internal/engine/exporter_login_terminal_test.go
D	src/flybuild-server/internal/engine/importer_ban_terminal_test.go
D	src/flybuild-server/internal/engine/importer_login_ban_test.go
D	src/flybuild-server/internal/engine/importer_login_observation_test.go
D	src/flybuild-server/internal/engine/importer_login_terminal_test.go
D	src/flybuild-server/internal/engine/importer_op_wait_test.go
D	src/flybuild-server/internal/engine/op_wait_observability.go
D	src/flybuild-server/internal/engine/passive_op_terminal_test.go
D	src/flybuild-server/internal/engine/permission_watcher.go
D	src/flybuild-server/internal/engine/permission_watcher_test.go
D	src/flybuild-server/internal/engine/protocol_observation.go
D	src/flybuild-server/internal/engine/protocol_observation_safe_test.go
D	src/flybuild-server/internal/engine/protocol_observation_test.go
D	src/flybuild-server/internal/engine/terminal_classifier_test.go
D	src/flybuild-server/internal/engine/terminal_log_format_test.go
D	src/flybuild-server/internal/engine/terminal_subcause_test.go
D	src/flybuild-server/internal/worker/reporter_terminal_test.go
D	thoughts/shared/designs/2026-04-28-empty-route-auth-fallback-design.md
D	thoughts/shared/designs/2026-04-28-ffm-upstream-sync-design.md
D	thoughts/shared/designs/2026-04-29-empty-route-postlogin-mask-ab-design.md
D	thoughts/shared/designs/2026-05-05-flyauth-cookie-retry-attribution-design.md
D	thoughts/shared/plans/2026-04-28-empty-route-auth-fallback.md
D	thoughts/shared/plans/2026-04-28-ffm-upstream-sync.md
D	thoughts/shared/plans/2026-04-28-mcp-ban-terminal-error.md
D	thoughts/shared/plans/2026-04-29-empty-route-postlogin-mask-ab.md
D	thoughts/shared/plans/2026-04-29-netease38-challenge-required.md
D	thoughts/shared/plans/2026-04-29-passive-op-wait.md
D	thoughts/shared/plans/2026-05-01-terminal-ban-and-pool-retry.md
D	thoughts/shared/plans/2026-05-05-flyauth-cookie-retry-attribution.md
D	thoughts/shared/plans/2026-05-08-empty-route-loading-screen-handshake.md
D	thoughts/shared/research/2026-04-28-ffm-upstream-diff.md
D	thoughts/shared/research/2026-04-28-ffm-upstream-e2e-sanity.md
D	thoughts/shared/research/2026-04-28-ffm-upstream-open-questions.md
D	thoughts/shared/research/2026-04-28-ffm-upstream-test-evidence.md
D	thoughts/shared/research/2026-04-29-passive-op-wait-replay.md
D	thoughts/shared/research/2026-05-05-flyauth-blocked-isolation-followup.md
```

**Deletion-surface verdict:** large-and-needs-user-confirmation
**Recommended Batch 3 action:** block-large-deletion

Reasoning: the branch would delete 70 files and 14,830 lines relative to `origin/master`, including many Go source/test files plus historical design/plan/research artifacts; the snapshot evidence does not clearly prove that this deletion set is intentional, so Batch 3 should not merge it without explicit human confirmation. A PR-only preservation path is also allowed by the plan if the branch must be surfaced for review, but automatic merge should be blocked.

## Ownership preflight

Command: `git remote -v`

```text
origin	https://github.com/wuxieTeam/FlyBuild.git (fetch)
origin	https://github.com/wuxieTeam/FlyBuild.git (push)
```

Command: `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`

```json
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyBuild","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-own
**Reasoning:** `origin` points to `wuxieTeam/FlyBuild`, the repository is not a fork, and the viewer has `ADMIN` permission, so origin is the safe owned target for later origin-only actions.

## PR status

Command: `gh pr list --head issue/37-worker --state all --json number,state,title,url`

```json
[]
```

## Project type detection

Command: `ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null`

```text
package.json
```

**Detected project type:** Node/package.json project at repository root.

## Dirty-work assessment

**Has uncommitted changes:** no
**Has unpushed commits ahead of origin/issue/37-worker:** no (0; `HEAD` equals `@{u}`)
**Has unpushed commits ahead of origin/master:** yes (1 commit ahead of default; branch is also behind default)

## Ownership preflight (reconfirmed before Advancement)

Command: `git remote -v`

```text
origin	https://github.com/wuxieTeam/FlyBuild.git (fetch)
origin	https://github.com/wuxieTeam/FlyBuild.git (push)
```

Command: `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`

```json
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyBuild","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-own
**Reasoning:** `origin` still points to owned repo `wuxieTeam/FlyBuild`, the repo is not a fork, and the viewer has `ADMIN` permission, so origin-only push/PR actions are allowed.

## Advancement

**Deletion verdict applied:** large-and-needs-user-confirmation
**Action taken:** pr-created-pending-human
**PR URL:** https://github.com/wuxieTeam/FlyBuild/pull/66
**Final branch state:** open-pr-needs-user-decision
