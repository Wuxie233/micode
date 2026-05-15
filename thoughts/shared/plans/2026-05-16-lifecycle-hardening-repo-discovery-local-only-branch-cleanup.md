---
date: 2026-05-16
topic: "lifecycle hardening repo discovery local-only branch cleanup"
issue: 81
scope: lifecycle
contract: none
---

# Lifecycle Hardening: Repository Discovery, Local-only Fallback, Branch Cleanup Implementation Plan

**Goal:** Harden lifecycle so it can discover the effective project repo, run local-only when remote ownership is unavailable, gate all remote mutations behind ownership checks, and safely audit/prune lifecycle-owned branches.

**Architecture:** Implement this as lifecycle-internal TypeScript modules with pure classifiers first and shelling-out policy second. Repository discovery and branch cleanup get standalone modules; lifecycle start/commit/finish/resolver/tools consume those modules without changing bootstrap commands into delivery lifecycle entry points. Local-only records are explicit (`mode: "local-only"`) and use negative local issue ids so existing numeric store/tool APIs remain compatible while impossible to confuse with GitHub issue numbers.

**Design:** `thoughts/shared/designs/2026-05-16-lifecycle-repo-discovery-local-only-branch-cleanup-design.md`

**Contract:** none

---

## 行为承诺映射

| 承诺 | 覆盖任务 |
|---|---|
| 当前目录位于 repo 内时使用 discovered parent repo root | 1.1, 3.1 |
| workspace 只有一个 child repo 时选择 child；多个 child repo 时报告 ambiguity | 1.1, 3.1 |
| 未确认 GitHub ownership / 无 remote / 未初始化项目进入 `local-only`，不阻塞本地设计/计划/执行 | 1.2, 1.3, 2.1, 3.1, 3.3 |
| 远端写操作只在 ownership gate 通过后发生 | 1.2, 2.2, 2.3, 3.1, 3.4 |
| 成功 finish 后清理当前 lifecycle branch；stale `issue/*` 与 `rescue/all-local/*` 只在可证明安全时 audit/prune | 1.4, 2.4, 2.5, 3.5 |
| `/all-init` / `/all-rebuild` / `/all-status` 保持 bootstrap-only，不要求 lifecycle ownership preflight | 3.6, 4.1 |

---

## Dependency Graph

```text
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4, 2.5 [core policies/schemas - depends on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 [handle/tool integration - depends on batch 2]
Batch 4 (parallel): 4.1 [bootstrap docs boundary - depends on batch 3]
```

---

## Batch 1: Foundation (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Repository discovery module
**File:** `src/lifecycle/repo-discovery.ts`
**Test:** `tests/lifecycle/repo-discovery.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design requires parent-first / unique-child discovery. Implementing it as a pure-ish helper over `LifecycleRunner` plus injected directory reader because existing lifecycle code already abstracts git/gh through `LifecycleRunner`, and injecting fs calls keeps tests deterministic.

**Required implementation:**
- Export `REPO_DISCOVERY_KIND` and discriminated union `RepoDiscoveryResult` with exact variants:
  - `{ kind: "repo"; root: string; source: "current" | "parent" | "unique-child"; candidates: readonly string[]; note: string | null }`
  - `{ kind: "uninitialized"; root: string; source: "uninitialized"; candidates: readonly string[]; note: string }`
  - `{ kind: "ambiguous"; root: string; source: "ambiguous"; candidates: readonly string[]; note: string }`
  - `{ kind: "blocked"; root: string; source: "blocked"; candidates: readonly string[]; note: string }`
- Export `resolveEffectiveProjectRoot(runner, input)` where `input` contains `cwd`, optional `readDir`, and optional `pathExists`.
- First run `git rev-parse --show-toplevel` in `input.cwd`; if it succeeds and stdout is non-empty, return `kind: "repo"` with `source: "current"` when root equals `cwd`, otherwise `source: "parent"`.
- Only when parent/current lookup fails, scan direct children of `cwd` and probe each child with `git rev-parse --show-toplevel`; dedupe resolved roots.
- If exactly one child root is discovered, return `kind: "repo"`, `source: "unique-child"`.
- If zero child roots are discovered, return `kind: "uninitialized"`, root=`cwd`, and never call `git init`.
- If more than one child root is discovered, return `kind: "ambiguous"` with sorted candidate roots.
- Convert fs/readDir exceptions or unexpected git runner throws into `kind: "blocked"` with a concise non-secret note.

**Test requirements:**
- `tests/lifecycle/repo-discovery.test.ts` must cover: current repo, nested directory resolves parent, exactly one child repo, multiple child repos ambiguous, no repo uninitialized, readDir failure blocked, and runner throw blocked.
- Fake runner should record all git args and assert no `git init` call exists in any scenario.

**Verify:** `bun test tests/lifecycle/repo-discovery.test.ts`
**Commit:** `feat(lifecycle): add repository discovery module`

### Task 1.2: Remote mutation gate in pre-flight
**File:** `src/lifecycle/pre-flight.ts`
**Test:** `tests/lifecycle/pre-flight.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design narrows ownership preflight to remote mutation safety. Implementing this by extending the existing classifier result with reason codes and adding explicit gate helpers, while preserving existing `classifyRepo` call shape.

**Required implementation:**
- Add `PreFlightUnknownReason` values: `"no-origin" | "unparseable-origin" | "gh-failed" | "invalid-gh-output" | "view-mismatch"`.
- Extend `PreFlightResult` with `readonly reason?: PreFlightUnknownReason` only for `UNKNOWN` results; keep existing fields compatible.
- Replace current `createUnknown(origin)` with `createUnknown(reason, origin = "")` and set reason at each failure site.
- Export `REMOTE_MUTATION_KIND` for operations: `"issue-create" | "issue-edit" | "issue-close" | "push" | "pr-create" | "pr-merge" | "remote-branch-delete" | "enable-issues"`.
- Export `assertRemoteMutationAllowed(preflight, operation)` returning `{ ok: true; repoTarget: string }` for `FORK`/`OWN`, otherwise `{ ok: false; note: string; failureKind: "pre_flight_failed" }`.
- Gate note must explicitly include operation, repo kind, and unknown reason when present; it must not include tokens or raw command stderr.
- Preserve existing `parseOriginTarget` behavior and `classifyRepo` classification for `FORK`, `OWN`, `UPSTREAM`, `UNKNOWN`.

**Test requirements:**
- Extend existing tests to assert unknown reasons for: no origin, non-GitHub origin, gh failure, invalid JSON, view mismatch.
- Add tests proving `assertRemoteMutationAllowed` allows `FORK`/`OWN` and blocks `UNKNOWN`/`UPSTREAM` with operation-specific notes.

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts`
**Commit:** `feat(lifecycle): gate remote mutations with ownership preflight`

### Task 1.3: Lifecycle mode and local identity types
**File:** `src/lifecycle/types.ts`
**Test:** `tests/lifecycle/types.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design leaves local-only identity shape open. Implementing it as negative numeric ids (`-1`, `-2`, ...) plus `mode: "local-only"` because existing store/tool APIs key records by number; negative ids cannot be valid GitHub issue numbers and avoid a broader API migration.

**Required implementation:**
- Export `LIFECYCLE_MODES = { REMOTE: "remote", LOCAL_ONLY: "local-only" } as const` and `LifecycleMode`.
- Extend `LifecycleRecord` with:
  - `readonly mode: LifecycleMode`
  - `readonly localId: string | null`
  - `readonly repoRoot: string`
  - `readonly remoteCapable: boolean`
- Add helpers:
  - `isRemoteLifecycleRecord(record): boolean`
  - `isLocalOnlyLifecycleRecord(record): boolean`
  - `isLocalIssueNumber(issueNumber): boolean` (true only for safe negative integers)
  - `formatLifecycleIdentity(record): string` returning `#N` for remote and local id for local-only.
- Keep all existing states/artifact constants intact.
- Do not encode local-only as `ABORTED`; local-only records are non-terminal normal lifecycle records.

**Test requirements:**
- Extend `tests/lifecycle/types.test.ts` to assert mode constants, remote/local helpers, negative local id detection, positive GitHub issue numbers not considered local, and `formatLifecycleIdentity` output.

**Verify:** `bun test tests/lifecycle/types.test.ts`
**Commit:** `feat(lifecycle): model remote and local-only lifecycle modes`

### Task 1.4: Branch cleanup classifier
**File:** `src/lifecycle/branch-cleanup.ts`
**Test:** `tests/lifecycle/branch-cleanup.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design requires audit-first safe pruning. Implementing the classifier as a pure module with an explicit evidence model; shell deletion is deferred to policy/integration tasks.

**Required implementation:**
- Export `BranchCleanupDecisionKind` with exact values: `"prune-local" | "prune-remote" | "keep-active" | "keep-user" | "blocked-ambiguous" | "blocked-upstream"`.
- Export candidate/evidence types for branch name, scope (`"local" | "remote"`), remote name, lifecycle record match, issue marker match, recovery marker match, merged/no-diff status, worktree usage, and preflight kind.
- Export `classifyBranchCleanupCandidate(candidate)`.
- Standard `issue/<number>-<slug>` is lifecycle-like only when branch name parses and at least one ownership evidence source exists: lifecycle record match, issue body marker, commit marker, or registered worktree match.
- `rescue/all-local/*` requires recovery marker evidence plus merged/no-diff proof before prune; otherwise `blocked-ambiguous`.
- Branches used by any worktree are `keep-active`.
- Non lifecycle-owned/user branches are `keep-user`.
- Remote branch prune requires `FORK`/`OWN`; `UPSTREAM`/`UNKNOWN` must produce `blocked-upstream`.
- Ambiguous lifecycle-like branches must report only; never classify as prune.

**Test requirements:**
- Cover lifecycle-owned merged `issue/*` local prune, remote prune with owned/fork preflight, upstream remote blocked, unknown remote blocked, active worktree kept, user branch kept, ambiguous issue branch blocked, rescue branch requires marker + merged/no-diff, and unmerged user commits blocked.

**Verify:** `bun test tests/lifecycle/branch-cleanup.test.ts`
**Commit:** `feat(lifecycle): classify lifecycle branch cleanup candidates`

---

## Batch 2: Core Policies and Schemas (parallel - 5 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5

### Task 2.1: Lifecycle schema/store migration safety
**File:** `src/lifecycle/schemas.ts`
**Test:** `tests/lifecycle/schemas.test.ts`
**Depends:** 1.3
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Existing lifecycle records on disk lack new mode/repo fields. Implementing schema defaults during parse so old records remain readable while all newly written records include explicit fields.

**Required implementation:**
- Update `LifecycleRecordSchema` to parse new required `LifecycleRecord` fields while tolerating older JSON records:
  - default `mode` to `"remote"` when absent.
  - default `localId` to `null` when absent.
  - default `repoRoot` to `worktree` or empty string when absent; prefer preserving loaded data without throwing.
  - default `remoteCapable` to `true` for legacy positive issue-number records.
- Keep invalid states/artifacts rejected.
- Ensure `parseLifecycleRecord` returns fully normalized records typed as `LifecycleRecord`.

**Test requirements:**
- Extend `tests/lifecycle/schemas.test.ts` with legacy record parse normalization, local-only record parse, invalid local-only shape rejection where appropriate, and artifacts behavior unchanged.
- Re-run store tests to ensure persisted records round-trip.

**Verify:** `bun test tests/lifecycle/schemas.test.ts tests/lifecycle/store.test.ts tests/lifecycle/types.test.ts`
**Commit:** `feat(lifecycle): normalize lifecycle record mode schema`

### Task 2.2: Commit path blocks local-only remote pushes
**File:** `src/lifecycle/commits.ts`
**Test:** `tests/lifecycle/commits.test.ts`
**Depends:** 1.2, 1.3
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design requires local commits to work but push to be gated. Implementing this at the low-level `commitAndPush` boundary so all callers, including `lifecycle_commit`, inherit the same safety rule.

**Required implementation:**
- Extend `CommitAndPushInput` with optional `mode?: LifecycleMode`, `remoteCapable?: boolean`, and `preflight?: PreFlightResult` (or a callback that returns preflight for push); keep existing callers compiling.
- If `input.push` is false, behavior remains current.
- If `input.push` is true and `mode === "local-only"` or `remoteCapable === false`, perform stage + commit normally, then return retained local commit outcome with `pushed: false` and recovery hint `failureKind: "pre_flight_failed"`, `safeToRetry: false`, summary explaining local-only remote push is unavailable.
- If `input.push` is true and preflight is present, call `assertRemoteMutationAllowed(preflight, "push")` before `git push`; block with the same retained outcome when disallowed.
- Never run `git push` when gate fails; never force push.
- Keep existing push retry behavior only after gate passes.

**Test requirements:**
- Extend `tests/lifecycle/commits.test.ts` to prove:
  - local-only push creates/retains the local commit but does not call `git push`.
  - unknown/upstream preflight blocks push before mutation.
  - fork/own preflight still pushes and retry behavior is unchanged.

**Verify:** `bun test tests/lifecycle/commits.test.ts tests/lifecycle/commit-tool-recovery.test.ts`
**Commit:** `feat(lifecycle): block remote push in local-only mode`

### Task 2.3: Finish path gates PR/remote merge and supports local-only terminal outcome
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/finish-recovery.test.ts`
**Depends:** 1.2, 1.3
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design requires PR/remote merge attempts to block in local-only. Implementing a finish-level gate that produces structured `FinishOutcome` with recovery hints before any `gh pr` or remote push/merge command.

**Required implementation:**
- Extend `FinishLifecycleInput` with optional `mode?: LifecycleMode`, `remoteCapable?: boolean`, and `preflight?: PreFlightResult`.
- If mode is local-only and requested strategy is `pr` or auto would choose PR, return `merged: false`, note `local-only: remote merge unavailable`, recovery hint `failureKind: "pre_flight_failed"`, `safeToRetry: false`, without calling `gh pr create`, `gh pr merge`, or remote `git push`.
- For `local-merge` in local-only repo mode, allow only local merge operations that do not call remote mutation commands; if existing implementation would push, block before push with recovery hint.
- For remote-capable mode with preflight present, call `assertRemoteMutationAllowed` for `pr-create`, `pr-merge`, and any remote push path before mutation.
- Keep existing merge conflict, temp worktree, PR checks, and cleanup outcomes unchanged after gate passes.

**Test requirements:**
- Extend `tests/lifecycle/finish-recovery.test.ts` or lifecycle merge tests to assert local-only PR finish returns recovery hint and makes no `gh pr` calls.
- Assert upstream/unknown preflight blocks remote merge before mutation.
- Assert fork/own preflight preserves existing PR/local merge behavior.

**Verify:** `bun test tests/lifecycle/merge.test.ts tests/lifecycle/finish-recovery.test.ts tests/lifecycle/merge-temp-worktree.test.ts`
**Commit:** `feat(lifecycle): gate finish remote mutations`

### Task 2.4: Post-finish current branch cleanup policy
**File:** `src/lifecycle/cleanup-policy.ts`
**Test:** `tests/lifecycle/cleanup-policy.test.ts`
**Depends:** 1.4
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Existing cleanup removes worktrees but not always lifecycle branches. Implementing branch deletion after successful worktree removal with safe `git branch -d` semantics only; failure is reported, not escalated to force delete.

**Required implementation:**
- Extend `CleanupPolicyInput` with optional `cleanupBranch?: boolean` default false to preserve existing behavior where needed.
- After `removeWorktree` succeeds or reports already missing and `cleanupBranch === true`, attempt `git branch -d <branch>` in repo `cwd` only when branch name matches standard lifecycle `issue/<number>-...` and branch is not currently checked out in any registered worktree.
- Never use `-D` or force deletion.
- If branch delete succeeds, include branch deletion in `reason`.
- If branch delete fails, return non-removed/blocked or failed outcome that clearly says worktree removal succeeded but branch cleanup failed; do not hide the failure.
- Keep quarantine behavior unchanged.

**Test requirements:**
- Add tests for branch delete after clean removal, no branch delete when disabled, no force delete, branch delete failure reported, active worktree branch not deleted.

**Verify:** `bun test tests/lifecycle/cleanup-policy.test.ts`
**Commit:** `feat(lifecycle): delete current lifecycle branch safely after finish`

### Task 2.5: Stale branch audit/prune policy
**File:** `src/lifecycle/branch-cleanup-policy.ts`
**Test:** `tests/lifecycle/branch-cleanup-policy.test.ts`
**Depends:** 1.2, 1.4
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design asks for audit/safe-prune path. Implementing a policy module separate from current worktree cleanup so stale branch governance can be used by a future tool and by finish reports without mixing responsibilities.

**Required implementation:**
- Export `auditLifecycleBranches(runner, input)` where input includes `cwd`, `baseBranch`, `records`, optional `preflight`, and `dryRun?: boolean` default true.
- Gather local candidates using `git branch --list issue/* rescue/all-local/*` and remote candidates using `git branch -r --list origin/issue/* origin/rescue/all-local/*` only when preflight allows remote audit.
- For each candidate, gather merge status via `git merge-base --is-ancestor`, worktree usage via `git worktree list --porcelain`, lifecycle record match from provided records, and marker/no-diff evidence where practical.
- Feed each candidate into `classifyBranchCleanupCandidate`.
- Return an audit report array; if `dryRun === false`, execute safe local `git branch -d` only for `prune-local`; execute remote delete only for `prune-remote` after `assertRemoteMutationAllowed(preflight, "remote-branch-delete")` passes.
- Never force delete and never target `upstream`.

**Test requirements:**
- New `tests/lifecycle/branch-cleanup-policy.test.ts` should fake runner calls for local prune, dry-run no deletion, ambiguous report only, rescue conservative block, remote delete gate pass, and remote delete blocked for upstream/unknown.

**Verify:** `bun test tests/lifecycle/branch-cleanup-policy.test.ts tests/lifecycle/branch-cleanup.test.ts`
**Commit:** `feat(lifecycle): add lifecycle branch audit policy`

---

## Batch 3: Handle, Tooling, and Boundary Tests (parallel - 6 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Lifecycle handle integrates discovery, local-only mode, and remote gates
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/index.test.ts`
**Depends:** 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** `index.ts` owns start/commit/finish orchestration, so it is the single integration task for discovery, local-only records, mode-aware sync, and fresh preflight before remote mutation.

**Required implementation:**
- Import `resolveEffectiveProjectRoot`, lifecycle mode helpers, schema-normalized record fields, and remote mutation gate helpers.
- In `createStart`, call discovery before `classifyRepo`, use discovered repo root for subsequent git/gh operations, and preserve existing remote fork/own happy path.
- For `UNKNOWN`/`UPSTREAM`/no remote/non-GitHub repo, create a normal non-terminal `mode: "local-only"` record with negative issue number, `localId`, `repoRoot`, `remoteCapable: false`, and explanatory notes.
- For uninitialized discovery, create only the local record/artifacts flow; do not run `git init`, `git worktree add`, `gh issue create`, or `gh issue edit`.
- For ambiguous/blocked discovery, abort with clear notes/recovery hint and no remote mutation.
- Make `saveAndSync`, `recordArtifact`, `setState`, blocked handling, and progress emit skip GitHub issue sync for local-only records.
- In `createCommitter`, pass record mode/remote capability/fresh preflight into `commitAndPush`; local-only uninitialized records return a non-throwing outcome with note `local-only: no git worktree available`.
- In `createFinisher`, pass mode/remote capability/fresh preflight into `finishLifecycle`; local-only records must not call PR/remote merge paths.
- After successful remote finish, call cleanup with `cleanupBranch: true` so current lifecycle `issue/*` branch is safe-deleted after worktree removal.

**Test requirements:**
- Extend `tests/lifecycle/index.test.ts` to cover nested repo root discovery, unique child repo discovery, multiple child ambiguity, unknown ownership local-only start, uninitialized local-only start, local-only commit push blocked, uninitialized commit no-op, local-only finish PR blocked, and remote-capable fork/own behavior unchanged.

**Verify:** `bun test tests/lifecycle/index.test.ts tests/lifecycle/repo-discovery.test.ts tests/lifecycle/commits.test.ts tests/lifecycle/finish-recovery.test.ts`
**Commit:** `feat(lifecycle): integrate local-only lifecycle mode`

### Task 3.2: Resolver and store accept local-only identities
**File:** `src/lifecycle/resolver.ts`
**Test:** `tests/lifecycle/resolver.test.ts`
**Depends:** 1.3, 2.1
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Existing resolver assumes `issue/<N>-*` and GitHub reconstruction. Implementing local-only support by treating negative issue ids as local store-only identities and avoiding `gh issue view` reconstruction for them.

**Required implementation:**
- Import local-only helpers from `types.ts`.
- Ensure `current()` can resolve a local-only record by branch/worktree when record branch exists, and does not call `gh` for negative ids.
- `resume(issueNumber)` and `forceRefresh(issueNumber)` should load local-only records locally and throw a clear `local-only records cannot be reconstructed from GitHub` error if missing.
- `summarizeRecord` should include local-only records in ambiguous candidates and should not treat empty `issueUrl` as corruption.
- Preserve remote resume/reconstruct behavior.

**Test requirements:**
- Extend `tests/lifecycle/resolver.test.ts` to cover resolved local-only branch, missing local-only resume failure without `gh`, ambiguous candidate list with local-only, and remote resume still uses issue body.

**Verify:** `bun test tests/lifecycle/resolver.test.ts tests/lifecycle/resume-recovery.test.ts tests/tools/lifecycle/resume.test.ts`
**Commit:** `feat(lifecycle): resolve local-only lifecycle records`

### Task 3.3: Lifecycle start tool output supports local-only records
**File:** `src/tools/lifecycle/start-request.ts`
**Test:** `tests/tools/lifecycle/start-request.test.ts`
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Users need to see local-only as a valid lifecycle, not as a preflight failure. Implementing tool formatting changes only; lifecycle behavior stays in `index.ts`.

**Required implementation:**
- Update DESCRIPTION to say start may create a remote lifecycle or local-only lifecycle.
- Replace aborted-sentinel-specific formatting assumptions with `formatLifecycleIdentity(record)` and mode-aware labels.
- Include `Mode`, `Repo root`, and `Remote capable` columns or a compact details block in successful output.
- For `mode: "local-only"`, header should be `## Local-only lifecycle started` and notes should be displayed as guidance, not failure.
- Keep actual `ABORTED` records displayed with failure headers.
- Do not call or imply GitHub issue URL for local-only records.

**Test requirements:**
- Extend `tests/tools/lifecycle/start-request.test.ts` to assert local-only record output has local-only header, negative/local identity, repo root, no GitHub issue wording, and notes shown.
- Existing aborted/preflight formatting tests must still pass.

**Verify:** `bun test tests/tools/lifecycle/start-request.test.ts`
**Commit:** `feat(lifecycle): display local-only lifecycle starts`

### Task 3.4: Current tool understands local-only lifecycle records
**File:** `src/tools/lifecycle/current.ts`
**Test:** `tests/tools/lifecycle/current.test.ts`
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Local-only records must not look corrupt just because they lack a GitHub issue URL. Implementing mode-aware display in the current tool; resolver behavior is handled separately.

**Required implementation:**
- Update current lifecycle table to include `Mode` and render local-only identity safely.
- In ambiguous candidates, include local-only candidates without requiring issue URL.
- Recovery hint for ambiguity should still recommend stale cleanup or explicit issue/local id selection; wording should not instruct users to run GitHub issue operations for local-only records.
- Keep output stable for remote records except added mode column.

**Test requirements:**
- Extend `tests/tools/lifecycle/current.test.ts` for resolved local-only, ambiguous local-only + remote, and no-active unchanged.

**Verify:** `bun test tests/tools/lifecycle/current.test.ts`
**Commit:** `feat(lifecycle): render local-only current lifecycle state`

### Task 3.5: Branch audit tool surface
**File:** `src/tools/lifecycle/index.ts`
**Test:** `tests/tools/lifecycle/index-wiring.test.ts`
**Depends:** 2.5
**Domain:** general
**Atlas-impact:** layer-update

**Design decision:** Design recommends audit-first cleanup and leaves tool UX open. Implementing a new lifecycle tool export (`lifecycle_audit_branches`) wired through index, with dry-run default; this avoids making finish unexpectedly prune stale branches.

**Required implementation:**
- Add a tool definition that exposes branch audit with args: `dry_run?: boolean` default true, `prune?: boolean` default false (prune only when explicitly true), and optional `base_branch`.
- Wire it through `src/tools/lifecycle/index.ts` using the existing tool registration style.
- Tool output should be a markdown report with candidate, decision, reason, and whether deletion was attempted.
- Prune must require `prune: true`; `dry_run` should remain the safe default.
- Remote deletion must be reported as blocked unless ownership gate passes.
- Do not call this tool automatically from bootstrap commands.

**Test requirements:**
- Extend `tests/tools/lifecycle/index-wiring.test.ts` to prove the new tool is registered.
- If a nearby lifecycle tool test pattern exists, add assertions for dry-run output and prune flag behavior in the same test file or a new `tests/tools/lifecycle/audit-branches.test.ts` only if needed.

**Verify:** `bun test tests/tools/lifecycle/index-wiring.test.ts tests/lifecycle/branch-cleanup-policy.test.ts`
**Commit:** `feat(lifecycle): expose dry-run branch audit tool`

### Task 3.6: Knowledge bootstrap boundary guard
**File:** `tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Test:** `tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** none

**Design decision:** Design explicitly says bootstrap commands stay outside lifecycle. Implementing this as a regression test over AGENTS.md wording because existing test already guards bootstrap command documentation drift.

**Required implementation:**
- Add assertions that the Knowledge Bootstrap section states `/all-init`, `/all-rebuild`, and `/all-status` do not require lifecycle ownership preflight.
- Add assertions that it states these commands do not start lifecycle, create GitHub issues, create lifecycle branches, or run ownership preflight.
- Keep existing questionnaire-removal assertions intact.

**Test requirements:**
- This task is the test. It may initially fail until docs/prompt text is updated by Task 4.2.

**Verify:** `bun test tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Commit:** `test(agents): guard bootstrap commands from lifecycle preflight`

---

## Batch 4: Bootstrap Documentation Boundary (parallel - 1 implementer)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1

### Task 4.1: Bootstrap docs boundary wording
**File:** `AGENTS.md`
**Test:** `tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Depends:** 3.6
**Domain:** general
**Atlas-impact:** none

**Design decision:** This is documentation/prompt guard only, not lifecycle implementation. Update the project guidance so the new boundary is explicit for future agents.

**Required implementation:**
- In the `## Knowledge Bootstrap Commands` section, add concise wording that `/all-init`, `/all-rebuild`, and `/all-status` are bootstrap flows and do not require lifecycle ownership preflight.
- State they do not start lifecycle, create GitHub issues, create lifecycle branches, or run ownership preflight.
- Do not duplicate long lifecycle design details; keep this as boundary documentation.

**Test requirements:**
- Make Task 3.6 assertions pass.

**Verify:** `bun test tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Commit:** `docs(agents): clarify bootstrap commands bypass lifecycle preflight`
