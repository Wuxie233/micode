# FlyBuild issue-64 snapshot

**Worktree:** /root/CODE/issue-64-flowers-for-machines-nemc-1-21-90
**Branch:** issue/64-flowers-for-machines-nemc-1-21-90
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state

```text
$ git rev-parse --abbrev-ref HEAD
issue/64-flowers-for-machines-nemc-1-21-90

$ git status --porcelain


$ git log --oneline -20
fcb6949 chore(minecraft): StartGame schema upstream alignment (#64)
19a03ae chore(minecraft): addendum plan: StartGame schema upstream alignment (P0) (#64)
ffeb2c0 chore(minecraft): align NEMC 1.21.90 post-StartGame handshake (#64)
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

$ git rev-parse HEAD
fcb69495d1e4483e79430ce01f0c6e7decedc0a0

$ git rev-parse @{u} 2>/dev/null || echo "(no upstream)"
fcb69495d1e4483e79430ce01f0c6e7decedc0a0
```

## Default-branch comparison

```text
$ git fetch origin --prune
(no output)

$ DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name); echo "default-branch: $DEFAULT"
default-branch: master

$ git log --oneline origin/master..HEAD | head -50
fcb6949 chore(minecraft): StartGame schema upstream alignment (#64)
19a03ae chore(minecraft): addendum plan: StartGame schema upstream alignment (P0) (#64)
ffeb2c0 chore(minecraft): align NEMC 1.21.90 post-StartGame handshake (#64)

$ git log --oneline HEAD..origin/master | head -10

```

## Go project verification

**go.mod present:** no
**Module:** n/a (go.mod missing at repository root)
**Changed .go files:** 14
**Shortstat:**  17 files changed, 2376 insertions(+), 332 deletions(-)

```text
$ test -f go.mod && head -5 go.mod || echo "(no go.mod)"
(no go.mod)

$ git diff --name-only origin/master..HEAD | grep '\.go$' | wc -l
14

$ git diff --shortstat origin/master..HEAD
 17 files changed, 2376 insertions(+), 332 deletions(-)
```

**Verification command for Batch 3:** `go build ./... && go test ./...` (documented substitute may be required because repository root has no go.mod; project type detection found package.json only)

## Ownership preflight

```text
$ git remote -v
origin	https://github.com/wuxieTeam/FlyBuild.git (fetch)
origin	https://github.com/wuxieTeam/FlyBuild.git (push)

$ gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyBuild","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-own
**Reasoning:** origin points to wuxieTeam/FlyBuild, gh reports isFork=false and viewerPermission=ADMIN for owner wuxieTeam, so origin is the owned safe target.

## PR status

```json
$ gh pr list --head issue/64-flowers-for-machines-nemc-1-21-90 --state all --json number,state,title,url
[]
```

## Project type detection

```text
$ ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
package.json
```

## Dirty-work assessment

**Has uncommitted changes:** no
**Has unpushed commits ahead of origin/issue/64-flowers-for-machines-nemc-1-21-90:** no (0)
**Has unpushed commits ahead of origin/master:** yes (3)

## Advancement

**PR URL:** https://github.com/wuxieTeam/FlyBuild/pull/67
**go build result:** pass
**go test result:** fail (client package post-login mask expectations failed)
**Action taken:** blocked-tests
**Final branch state:** blocked

**Ownership preflight reconfirmed before remote mutation:** yes — `origin` is `https://github.com/wuxieTeam/FlyBuild.git`; `gh repo view` reported `nameWithOwner=wuxieTeam/FlyBuild`, `isFork=false`, `viewerPermission=ADMIN`.
**Branch sync before PR:** in-sync with `origin/issue/64-flowers-for-machines-nemc-1-21-90` at `fcb69495d1e4483e79430ce01f0c6e7decedc0a0`.
**PR action:** created PR #67; merge skipped because verification failed.
**Verification command:** documented substitute `cd src/flowers-for-machines && GOWORK=off go build ./... && GOWORK=off go test ./...` (repository root has no `go.mod`; root `go.work` excludes `src/flowers-for-machines`, so `GOWORK=off` is required for this module).

**Verification summary:**

```text
go build ./...: pass
go test ./...: fail

--- FAIL: TestPostLoginMaskRoutes (0.00s)
    --- FAIL: TestPostLoginMaskRoutes/#00 (0.00s)
        postlogin_mask_test.go:20: postLoginSendMask("") = 0x7b, want 0x7f
--- FAIL: TestPostLoginMaskEnvOverrideForNonLegacyDefault (0.00s)
    postlogin_mask_test.go:34: postLoginSendMask(empty route) with env override = 0x7b, want 0x7f
--- FAIL: TestPostLoginMaskEmptyRouteDefaultsTo7F (0.00s)
    postlogin_mask_test.go:47: postLoginSendMask("") = 0x7b, want 0x7f
--- FAIL: TestPostLoginMaskEmptyRouteDisableEnvFallsBackToZero (0.00s)
    postlogin_mask_test.go:60: postLoginSendMask(empty route) with disable env "1" = 0x7b, want 0
--- FAIL: TestPostLoginMaskDisableEnvFalsyKeepsDefault (0.00s)
    postlogin_mask_test.go:80: postLoginSendMask(empty route) with disable env "0" = 0x7b, want 0x7f
FAIL	github.com/OmineDev/flowers-for-machines/client
```
