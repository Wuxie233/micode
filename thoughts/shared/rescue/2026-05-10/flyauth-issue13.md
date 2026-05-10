# FlyAuth issue-13 snapshot

**Worktree:** /root/CODE/issue-13-flyauth-account-blocked
**Branch:** issue/13-account-blocked
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state

Commands: `git rev-parse --abbrev-ref HEAD`, `git status --porcelain`, `git log --oneline -10`, `git rev-parse HEAD`, `git rev-parse @{u} 2>/dev/null || echo "(no upstream)"`

```text
issue/13-account-blocked
51fc853 fix(auth): 透传 PE auth entity status refs #13
230a164 fix(auth): account blocked code32 冷却并软轮换 refs #13
e94152d fix(auth): 登录响应透传 engine patch metadata refs #13
e9b58ad fix(auth): 保留 cookie 重试耗尽首因 refs #13
acbd3a6 experiment(auth): 支持 PE auth 3.8 配置实验 refs #12
81d178c fix(login): 将租赁服/大厅 not-found 视为短暂异常 refs #11
3fe7b1c fix(pool): log cooldown recover loop startup for ops visibility
ea27c0f Merge fix/flyauth-cooldown-sweep (refs #10)
14c4bce Merge fix/flyauth-401-cooldown (refs #9)
362f451 fix(pool): recover expired cooldown accounts every 5 min
51fc853ef1d2dcb9f203eb2d5199f70f42e19c44
(no upstream)
```

## Default-branch comparison

Commands: `git fetch origin --prune`, `gh repo view --json defaultBranchRef --jq .defaultBranchRef.name`, `git log --oneline origin/$DEFAULT..HEAD | head -50`, `git log --oneline HEAD..origin/$DEFAULT | head -10`

```text
From https://github.com/wuxieTeam/FlyAuth
   4b2397d..01b875f  master     -> origin/master
default-branch: master
51fc853 fix(auth): 透传 PE auth entity status refs #13
230a164 fix(auth): account blocked code32 冷却并软轮换 refs #13
e94152d fix(auth): 登录响应透传 engine patch metadata refs #13
e9b58ad fix(auth): 保留 cookie 重试耗尽首因 refs #13
acbd3a6 experiment(auth): 支持 PE auth 3.8 配置实验 refs #12
81d178c fix(login): 将租赁服/大厅 not-found 视为短暂异常 refs #11
3fe7b1c fix(pool): log cooldown recover loop startup for ops visibility
ea27c0f Merge fix/flyauth-cooldown-sweep (refs #10)
14c4bce Merge fix/flyauth-401-cooldown (refs #9)
362f451 fix(pool): recover expired cooldown accounts every 5 min
5fbc31e fix(pool): cooldown upstream 401 soft-rotated accounts
d482e4f feat(pool): support task-scoped affinity_key for sticky cookie selection
619dd15 docs: initialize project docs (#8)
deeb703 chore: add .worktrees/ to .gitignore for local git worktrees
01b875f Merge pull request #6 from wuxieTeam/fix/issue5-terminal-358
0b781b4 fix(cookie_fallback): 358 最低等级错误直接终止透传 refs #5
3c861ca fix(handlers): 补齐 Phoenix 请求体 AffinityKey 字段 refs #5
```

## Ownership preflight

Commands: `git remote -v`, `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`

```text
origin	https://github.com/wuxieTeam/FlyAuth (fetch)
origin	https://github.com/wuxieTeam/FlyAuth (push)
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyAuth","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-own
**Reasoning:** origin points to `wuxieTeam/FlyAuth`, the repository is not a fork (`isFork: false`), and the viewer has `ADMIN` permission on the origin owner `wuxieTeam`.

## PR status

Command: `gh pr list --head issue/13-account-blocked --state all --json number,state,title,url`

```json
[]
```

## Project type detection

Command: `ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null`

```text
go.mod
```

## Dirty-work assessment

**Has uncommitted changes:** no
**Has unpushed commits ahead of origin/issue/13-account-blocked:** yes (origin branch missing; local branch has no upstream)
**Has unpushed commits ahead of origin/master:** yes (14)

## Advancement

**Action taken:** blocked-conflict
**PR URL:** https://github.com/wuxieTeam/FlyAuth/pull/14
**Verification command:** go build ./... && go test ./...
**Verification result:** pass
**Final branch state:** blocked

### Ownership preflight reconfirmed before remote mutation

Commands: `git remote -v`, `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`

```text
origin	https://github.com/wuxieTeam/FlyAuth (fetch)
origin	https://github.com/wuxieTeam/FlyAuth (push)
{"isFork":false,"nameWithOwner":"wuxieTeam/FlyAuth","owner":{"id":"O_kgDOEAAE7g","login":"wuxieTeam"},"parent":null,"viewerPermission":"ADMIN"}
```

### PR and verification evidence

Branch push check: local `issue/13-account-blocked` was not equal to `origin/issue/13-account-blocked` before push check; `git push origin issue/13-account-blocked` returned `Everything up-to-date` and PR #14 was created.

PR state after creation:

```json
{"baseRefName":"master","headRefName":"issue/13-account-blocked","isDraft":false,"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING","number":14,"state":"OPEN","statusCheckRollup":null,"title":"Handle account-blocked auth flow","url":"https://github.com/wuxieTeam/FlyAuth/pull/14"}
```

Verification summary:

```text
ok  	github.com/Wuxie233/FlyAuth/auth	1.807s
?   	github.com/Wuxie233/FlyAuth/cmd/flyauth	[no test files]
?   	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/buildinfo	[no test files]
ok  	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/handlers	2.080s
?   	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/notify	[no test files]
ok  	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/proxy	0.011s
?   	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/router	[no test files]
ok  	github.com/Wuxie233/FlyAuth/cmd/flyauth/internal/store	0.155s
?   	github.com/Wuxie233/FlyAuth/cmd/refresh_sauth	[no test files]
?   	github.com/Wuxie233/FlyAuth/cmd/test_4399pe	[no test files]
?   	github.com/Wuxie233/FlyAuth/cmd/test_mcp	[no test files]
?   	github.com/Wuxie233/FlyAuth/cmd/test_realname	[no test files]
?   	github.com/Wuxie233/FlyAuth/cmd/test_skin	[no test files]
```

### Conflict evidence

Conflict probe command: `git merge --no-commit --no-ff origin/master`, followed by `git merge --abort`.

```text
Auto-merging cmd/flyauth/internal/handlers/cookie_fallback.go
CONFLICT (content): Merge conflict in cmd/flyauth/internal/handlers/cookie_fallback.go
Auto-merging cmd/flyauth/internal/handlers/cookie_fallback_test.go
CONFLICT (content): Merge conflict in cmd/flyauth/internal/handlers/cookie_fallback_test.go
Auto-merging cmd/flyauth/internal/handlers/phoenix_types.go
Automatic merge failed; fix conflicts and then commit the result.
```

Conflicting files:

```text
cmd/flyauth/internal/handlers/cookie_fallback.go
cmd/flyauth/internal/handlers/cookie_fallback_test.go
```

Reason: PR #14 is `CONFLICTING` / `DIRTY` with content conflicts in handler logic and tests. This is not treated as small/mechanical, so the PR was left open and no merge was attempted.
