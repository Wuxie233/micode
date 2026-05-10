# micode issue-60 (reconcile worktree) snapshot

**Worktree:** /root/CODE/reconcile-restore-local-work-20260505
**Branch:** reconcile/restore-local-work-20260505
**Captured:** 2026-05-10
**Snapshot status:** captured

## Branch state
(git rev-parse --abbrev-ref HEAD, git status --porcelain, git log --oneline -10, git rev-parse HEAD, upstream)

```text
### git rev-parse --abbrev-ref HEAD
reconcile/restore-local-work-20260505

### git status --porcelain

### git log --oneline -10
2fb6b31 fix(agents): align prompt markers with classifier
5fad304 fix(tdd): use semantic risk for test requests
f421f52 feat(tdd): narrow required tests to path policy
0d17598 Merge pull request #38 from Wuxie233/issue/33-atlas-init-agent-routing
cbefb16 test(atlas): stabilize mtime edit detection
b34f6d9 atlas: route atlas init through initializer agent
3414b8b Merge pull request #37 from Wuxie233/issue/33-atlas-init-cold-orchestrator-rebased
9113386 test(runtime-deploy): set fixture git identity
be8ef75 atlas: add cold init orchestrator plan
3e334e8 atlas: make atlas init a cold-start orchestrator

### git rev-parse HEAD
2fb6b31249f94b7a1999745b6eb152c425bb3833

### git rev-parse @{u} 2>/dev/null || echo "(no upstream)"
2fb6b31249f94b7a1999745b6eb152c425bb3833
```

## Default-branch comparison
(default branch name, "ahead of default" log, "behind default" log)

```text
From https://github.com/Wuxie233/micode
 - [deleted]         (none)     -> origin/fix/lifecycle-preflight-origin-target
 - [deleted]         (none)     -> origin/reconcile/restore-local-work-20260505
### DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
default-branch: main

### git log --oneline origin/main..HEAD | head -50

### git log --oneline HEAD..origin/main | head -10
52c7d12 Merge branch 'issue/60-redesign-project-atlas-as-a-shared-human-ai-ment'
b82af3d chore(atlas): implement Atlas shared mental model protocol (#60)
92d60a6 chore(atlas): plan atlas shared mental model implementation (#60)
6757cca Merge branch 'issue/58-make-lifecycle-cleanup-and-agent-search-behavior'
182398f chore(lifecycle): implement autonomy-first lifecycle cleanup (#58)
ea7d0aa Merge branch 'issue/59-correct-subagent-result-extraction-to-use-last-n'
21251ec chore(spawn-agent): Correct subagent output extraction (#59)
fa6b766 Merge branch 'issue/57-upgrade-the-micode-product-manager-specialist-pr'
809499b chore(agents): upgrade product-manager prompt with PM judgment (#57)
c592e87 plan(agents): add product-manager prompt upgrade implementation plan
```

## Ownership preflight
(git remote -v, gh repo view --json output)

```text
### git remote -v
origin	https://github.com/Wuxie233/micode.git (fetch)
origin	https://github.com/Wuxie233/micode.git (push)

### gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission
{"isFork":true,"nameWithOwner":"Wuxie233/micode","owner":{"id":"U_kgDOBz91cg","login":"Wuxie233"},"parent":{"id":"R_kgDOQsR0VA","name":"micode","owner":{"id":"MDQ6VXNlcjYzOTc3MQ==","login":"vtemian"}},"viewerPermission":"ADMIN"}
```

**Ownership classification:** safe-origin-fork
**Reasoning:** Repository is a fork (`isFork: true`) owned by origin owner `Wuxie233`, with parent owner `vtemian`, so origin is the user's fork and remote writes must target only origin.

## PR status
(gh pr list output)

```text
### gh pr list --head reconcile/restore-local-work-20260505 --state all --json number,state,title,url | head -100
[{"number":39,"state":"MERGED","title":"fix: restore local TDD and prompt marker fixes after main rewrite","url":"https://github.com/Wuxie233/micode/pull/39"}]
```

## Dirty-work assessment
**Has uncommitted changes:** no
**Has unpushed commits ahead of origin/<branch>:** no (0; origin/reconcile/restore-local-work-20260505 was pruned/deleted during fetch, but upstream `@{u}` resolved to current HEAD before fetch)
**Has unpushed commits ahead of origin/<default>:** no (0)

## Preservation
**Action taken:** skipped-no-changes
**New commit SHA (if any):** n/a
**Push result:** n/a
**Test command run:** bun test
**Test result:** fail (4)
**Recommended Batch 3 action:** block-tests-failed
**Test summary (last 30 lines):**
```text
tests/tools/octto/brainstorm-defensive.test.ts:
[octto] create_brainstorm: branches lost initial_question after dispatch {
  args: {
    request: "test",
    branches: [
      [Object ...], [Object ...]
    ],
  },
}
octto create_brainstorm raw args: {"request":"test","branches":[{"id":"a","scope":"scope a"},{"id":"b","scope":"scope b","initial_question":null}]}

tests/tools/spawn-agent/cleanup.test.ts:
[spawn-agent.cleanup] aborted=2 deleted=2 failed=0 reason=supersede
[spawn-agent.cleanup] aborted=2 deleted=1 failed=1 reason=test
[spawn-agent.cleanup] aborted=1 deleted=0 failed=1 reason=test

tests/tools/spawn-agent/integration.test.ts:
[spawn-agent.diagnostics] {"task":"Successful task","agent":"implementer-general","classifier":"success: assistant output present","fence":"launch","diagnostics":"classifier=success: assistant output present; fence=launch","outcome":"success"}
[spawn-agent.diagnostics] {"task":"Task error task","agent":"implementer-frontend","classifier":"task_error: final-status marker TEST FAILED","fence":"launch","diagnostics":"classifier=task_error: final-status marker TEST FAILED; fence=launch","outcome":"task_error"}
[spawn-agent.diagnostics] {"task":"Blocked task","agent":"implementer-backend","classifier":"blocked: final-status marker BLOCKED:","fence":"launch","diagnostics":"classifier=blocked: final-status marker BLOCKED:; fence=launch","outcome":"blocked"}
[spawn-agent.diagnostics] {"task":"Hard failure task","agent":"reviewer","classifier":"hard_failure: Spawned session exploded","fence":"launch","diagnostics":"classifier=hard_failure: Spawned session exploded; fence=launch","outcome":"hard_failure"}
[spawn-agent.cleanup] aborted=1 deleted=0 failed=1 reason=test

tests/tools/spawn-agent/naming-integration.test.ts:
[spawn-agent.diagnostics] {"task":"新增登录接口","agent":"implementer-backend","classifier":"success: assistant output present","fence":"launch","diagnostics":"classifier=success: assistant output present; fence=launch","outcome":"success"}
[spawn-agent.diagnostics] {"task":"审查 PR #42","agent":"reviewer","classifier":"blocked: final-status marker BLOCKED:","fence":"launch","diagnostics":"classifier=blocked: final-status marker BLOCKED:; fence=launch","outcome":"blocked"}
[spawn-agent.diagnostics] {"task":"","agent":"implementer-frontend","classifier":"success: assistant output present","fence":"launch","diagnostics":"classifier=success: assistant output present; fence=launch","outcome":"success"}

tests/tools/spawn-agent/preserve-on-failure.test.ts:
[spawn-agent.diagnostics] {"task":"d","agent":"x","classifier":"task_error: final-status marker TEST FAILED","fence":"launch","diagnostics":"classifier=task_error: final-status marker TEST FAILED; fence=launch","outcome":"task_error"}
[spawn-agent.diagnostics] {"task":"d","agent":"x","classifier":"blocked: final-status marker BLOCKED:","fence":"launch","diagnostics":"classifier=blocked: final-status marker BLOCKED:; fence=launch","outcome":"blocked"}
[spawn-agent.diagnostics] {"task":"d","agent":"x","classifier":"success: assistant output present","fence":"launch","diagnostics":"classifier=success: assistant output present; fence=launch","outcome":"success"}

tests/atlas/cold-init/sources/lifecycle-history.test.ts:
[atlas.cold-init.lifecycle] parse failed: JSON Parse error: Unexpected identifier "not"

 1935 pass
 4 fail
 4500 expect() calls
Ran 1939 tests across 341 files. [43.31s]
```

## Advancement
**Action taken:** blocked-tests-failed
**PR URL:** n/a
**Final branch state:** blocked
