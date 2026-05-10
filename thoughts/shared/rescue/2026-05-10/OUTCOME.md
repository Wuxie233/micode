# Worktree merge rescue — 2026-05-10 outcome ledger

**Lifecycle issue:** #62
**Coordinator worktree:** /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br
**Run date:** 2026-05-10

## Summary

| Repo | Issue | Branch | Final state | PR | Notes |
|------|-------|--------|-------------|----|----|
| micode | 60 (reconcile) | reconcile/restore-local-work-20260505 | blocked | n/a | `micode-issue60`: preserved state was already clean, but `bun test` failed, so advancement was blocked. |
| FlyAuth | 13 | issue/13-account-blocked | blocked | https://github.com/wuxieTeam/FlyAuth/pull/14 | `flyauth-issue13`: PR opened and Go verification passed, but mergeability is blocked by non-mechanical conflicts. |
| 4399pe-register | 16 | issue-16-4399-box-native-crypto | merged | #17 | `4399-issue16`: existing PR #17 passed `cd nethard-core && pnpm run build` and was merged. |
| oc-remote | 20 | issue/20-correct-mcp-fallback-... | open-rescue-pr | https://github.com/Wuxie233/oc-remote/pull/23 | `oc-remote-issue20`: partially superseded branch was cherry-picked into `rescue/issue-20-recovered-20260510` for human review. |
| oc-remote | 21 | issue/21-align-android-mcp-... | blocked | https://github.com/Wuxie233/oc-remote/pull/24 | `oc-remote-issue21`: PR opened, but GitHub reports conflicts and local Gradle verification lacks Android SDK. |
| FlyBuild | 37 | issue/37-worker | open-pr-needs-user-decision | https://github.com/wuxieTeam/FlyBuild/pull/66 | `flybuild-issue37`: large deletion surface preserved as PR; merge requires explicit human confirmation. |
| FlyBuild | 40 | issue/40-mcp-challenge-mcauth | open-pr | https://github.com/wuxieTeam/FlyBuild/pull/65 | `flybuild-issue40`: mixed research/code branch preserved as non-draft PR; verification failed in flowers-for-machines tests. |
| FlyBuild | 64 | issue/64-flowers-for-machines-... | blocked | https://github.com/wuxieTeam/FlyBuild/pull/67 | `flybuild-issue64`: PR opened and Go build passed, but Go tests failed on post-login mask expectations. |

## Counts
- Merged: 1
- Open PR (pending human): 3
- Blocked: 4
- Already-in-default / superseded: 0

## Worktrees retained (NONE deleted per plan rule)
- /root/CODE/reconcile-restore-local-work-20260505
- /root/CODE/issue-13-flyauth-account-blocked
- /root/CODE/issue-16-4399-box-native-crypto
- /root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan
- /root/CODE/issue-21-align-android-mcp-panel-with-opencode-web-runtim
- /root/CODE/issue-37-worker
- /root/CODE/issue-40-mcp-challenge-mcauth
- /root/CODE/issue-64-flowers-for-machines-nemc-1-21-90

## Blocked entries (need human follow-up)

### micode/60
- Reason: tests
- Evidence: thoughts/shared/rescue/2026-05-10/micode-issue60.md
- Suggested next step: Review the four failing `bun test` suites in the reconcile branch before opening or merging any follow-up PR.

### FlyAuth/13
- Reason: conflict
- Evidence: thoughts/shared/rescue/2026-05-10/flyauth-issue13.md
- Suggested next step: Manually reconcile `cmd/flyauth/internal/handlers/cookie_fallback.go` and `cookie_fallback_test.go`, then re-run Go verification on PR #14.

### oc-remote/21
- Reason: conflict + tests
- Evidence: thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md
- Suggested next step: Resolve the broad PR #24 conflict set with an Android SDK configured, then re-run `./gradlew test`.

### FlyBuild/64
- Reason: tests
- Evidence: thoughts/shared/rescue/2026-05-10/flybuild-issue64.md
- Suggested next step: Decide whether the new `postLoginSendMask` behavior or the failing test expectations are correct, then update PR #67 accordingly.

## Verification commands run per repo
| Repo | Command | Result |
|------|---------|--------|
| micode (`micode-issue60`) | `bun test` | fail |
| FlyAuth (`flyauth-issue13`) | `go build ./... && go test ./...` | pass |
| 4399pe-register (`4399-issue16`) | `cd nethard-core && pnpm run build` | pass |
| oc-remote issue-20 (`oc-remote-issue20`) | not-run | not-run |
| oc-remote issue-21 (`oc-remote-issue21`) | `./gradlew test` | fail |
| FlyBuild issue-37 (`flybuild-issue37`) | not-run | not-run |
| FlyBuild issue-40 (`flybuild-issue40`) | `go test ./...` in `src/flowers-for-machines`; `go test ./...` in `src/flybuild-server` | fail |
| FlyBuild issue-64 (`flybuild-issue64`) | `cd src/flowers-for-machines && GOWORK=off go build ./... && GOWORK=off go test ./...` | fail |
