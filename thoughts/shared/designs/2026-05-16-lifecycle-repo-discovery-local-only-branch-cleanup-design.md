---
date: 2026-05-16
topic: "lifecycle repo discovery + local-only fallback + branch cleanup"
status: validated
issue: 81
---

## 承诺清单 / Commitments

> 这是本轮已批准方向的稳定快照，供 planner / executor / reviewer / 终态汇报逐条核对。

用户批准的方向：

1. **自动 repository discovery**：lifecycle 不再假设当前 `ctx.directory` 一定是项目 repo root；应自动解析有效项目仓库。
2. **parent-first / unique-child repo root discovery**：当前目录不在 git repo 内时，先向父目录找 repo；找不到父 repo 时，在当前目录的直接子目录中若恰好存在一个 git repo，则使用该 unique child；多 child / 无 child 时不猜。
3. **uninitialized / no-ownership 项目 local-only lifecycle**：新项目、未 git init、无 remote、无法确认 GitHub ownership 时，不阻塞本地 design / plan / execution；降级为 local-only lifecycle。
4. **ownership preflight 改为 remote mutation gate**：GitHub ownership 检查只在 issue 创建、push、PR、merge、remote branch deletion 等远端写操作前强制；不再作为 lifecycle_start_request 的全局入口阻断。
5. **cleanup / audit lifecycle-owned branches**：成功 finish 后自动清理 lifecycle-owned `issue/*` 分支；提供审计与安全 prune 路径处理 stale `issue/*` 与 `rescue/all-local/*` 分支。
6. **branch cleanup 必须安全可审计**：只处理能证明 lifecycle-owned 的分支；ambiguous / user branch 必须跳过并报告，不能 force delete。
7. **/all-init / /all-rebuild / /all-status 保持 bootstrap flow**：三条知识库 bootstrap 命令不引入 lifecycle ownership preflight，也不被 local-only lifecycle 改造成 delivery lifecycle。
8. **明确不做**：不自动 `git init`、不自动创建 GitHub repository、不 force push、不 force delete、不 mutate upstream remote。

## Problem Statement

当前 lifecycle 对“项目仓库已经被正确初始化并且当前目录就是 repo root”假设过强，导致几个实际工作流被不必要阻断或留下清理债务。

已确认的现状与问题：

- `lifecycle_start_request` 使用 `ctx.directory` 作为 lifecycle `cwd`，当 OpenCode 当前目录不是 repo root 时，后续 `git` / `gh` 操作会指向错误位置或直接失败。
- `classifyRepo` 返回 `UNKNOWN` 时，`getPreFlightNote` 会让 start 直接 abort；这对新项目、无 remote、未登录 GitHub、非 GitHub remote、或尚未确认 ownership 的本地项目过于严格。
- GitHub ownership preflight 的真实安全价值是防止远端误写（push / issue / PR / merge / remote branch deletion），不是阻止本地写 design / plan / code。
- cleanup 当前已经能移除 worktree，并在部分情况下删除本地 lifecycle branch，但缺少对 stale `issue/*` 与 `rescue/all-local/*` 分支的系统治理：哪些可删、哪些只审计、哪些必须跳过没有统一 contract。
- `/all-init` / `/all-rebuild` / `/all-status` 是 knowledge bootstrap 入口，不是 issue-driven delivery 入口；它们应该继续对未初始化项目友好，而不是被 lifecycle ownership preflight 卡住。

需要把 lifecycle 拆成两层能力：

1. **本地 lifecycle 能力**：repo discovery、local record、branch/worktree、design/plan/execution、local commit，可在无 GitHub ownership 时运行。
2. **远端 mutation 能力**：GitHub issue、push、PR、merge、remote cleanup，必须通过 ownership gate。

## Constraints

- 不自动执行 `git init`，也不自动创建 GitHub repository；未初始化目录只能 local-only 记录并给出后续升级提示。
- 不 force push，不使用 `git push --force` / `--force-with-lease`，不跳过 hooks。
- 不 force delete 分支；本地 branch deletion 默认使用 safe delete（merged / lifecycle-owned / no worktree reference），远端 deletion 必须走 ownership gate。
- 不 mutate upstream remote；fork 场景只允许操作用户 fork 的 `origin`，绝不触碰 `upstream`。
- repo discovery 只能在“parent-first 或 unique-child 明确唯一”时自动选择；多个候选 repo 时必须返回 blocked / ambiguous，不猜。
- local-only lifecycle 不能伪造 GitHub issue，也不能把 local id 当作远端 issue number 误用于 `gh` 命令。
- cleanup / audit 只治理 lifecycle-owned 分支：`issue/<number>-<slug>` 必须能映射到 lifecycle record / issue marker / merged state；`rescue/all-local/*` 必须能证明由 lifecycle recovery 生成。
- `/all-init` / `/all-rebuild` / `/all-status` 继续由 knowledge-bootstrap-orchestrator 负责，不要求 lifecycle record 或 ownership preflight。
- 保持现有 Atlas / Project Memory 边界：lifecycle_finish / lifecycle_commit 不隐式写 Atlas 或 Project Memory。

## Approach

核心设计：**把 repo discovery 前置，把 lifecycle mode 显式化，把 ownership preflight 后移到远端写操作，把 branch cleanup 变成可审计策略。**

### 1. Repository discovery

新增独立 repo discovery 模块，接受当前 `ctx.directory`，输出 `RepoDiscoveryResult`：

- `kind: "repo"`：找到有效 repo root。
- `kind: "uninitialized"`：没有找到 repo，但目录可作为 local-only project root。
- `kind: "ambiguous"`：发现多个 child repo 或 parent/child 关系无法唯一判定。
- `kind: "blocked"`：路径不存在、无法访问、git 命令异常等。

选择顺序固定为 parent-first：

1. 从 `ctx.directory` 执行 `git rev-parse --show-toplevel`；成功则使用该 parent/current repo root。
2. 若不在 git repo 内，扫描 `ctx.directory` 的直接子目录，找出包含 `.git` 或 `git rev-parse --show-toplevel` 成功的 child repo。
3. child repo 数量为 1 时使用 unique child repo root。
4. child repo 数量为 0 时返回 `uninitialized`，允许 local-only。
5. child repo 数量 > 1 时返回 `ambiguous`，要求用户或调用方显式选择，不自动猜。

这样可覆盖“OpenCode 打开父工作区但实际项目在唯一子目录”的常见场景，同时避免在 monorepo / multi-repo workspace 中误选。

### 2. Lifecycle mode

为 lifecycle record 增加或等价表达 `mode`：

- `remote`: 已确认安全远端目标，可创建 GitHub issue、push、PR、merge、remote cleanup。
- `local-only`: 未确认远端 ownership 或无 git repo / remote；允许本地 design、plan、executor、local commit、local branch/worktree（若 repo 存在），但跳过远端 mutation。

`classifyRepo UNKNOWN` 不再导致 start abort：

- repo root 已发现但 ownership unknown：start 进入 `local-only`，notes 写明 `remote unavailable: ownership unknown`。
- no remote / non-GitHub remote / gh 不可用：start 进入 `local-only`，notes 写明原因。
- uninitialized directory：start 进入 `local-only`，不创建 branch/worktree，只创建 local record / artifacts；提示“不会自动 git init”。
- upstream repo：start 可进入 `local-only`，但远端 mutation gate 必须拒绝，并提示 fork / switch origin 后可升级。

local-only 不等于失败；它是一个明确降级模式。

### 3. Ownership preflight as remote mutation gate

把 `classifyRepo` 的强约束从 `lifecycle_start_request` 移到所有远端写路径前：

- GitHub issue create / edit / close。
- `lifecycle_commit` 中 push 到 `origin`。
- PR create / update / merge。
- remote branch delete。
- enable issues (`gh repo edit --enable-issues`)。

gate 规则：

| Repo classification | Local lifecycle | Remote mutation |
|---|---|---|
| `FORK` | allowed | allowed only to `origin` fork |
| `OWN` | allowed | allowed to `origin` |
| `UPSTREAM` | allowed local-only | blocked unless user explicitly re-targets / forks in a separate approved flow |
| `UNKNOWN` | allowed local-only | blocked with recovery hint |
| no repo / uninitialized | local record only | blocked |

当 local-only 后续环境变得可确认（例如用户添加 origin fork 并登录 gh），`lifecycle_commit` / `lifecycle_finish` 可在 gate 通过后升级远端能力，但不能 retroactively 假装已有 GitHub issue；需要通过明确的 sync / create-remote-issue 步骤或后续设计决定。

### 4. Branch cleanup and audit

把 cleanup 拆成两个层次：

1. **finish-time cleanup**：在成功 merge / close / cleaned 后，自动处理当前 lifecycle 的 worktree 与 branch。
2. **audit / safe-prune cleanup**：枚举仓库中 stale lifecycle-owned branches，生成审计报告，并在可证明安全时 prune。

治理对象：

- `issue/<number>-<slug>`：标准 lifecycle branch。
- `rescue/all-local/*`：lifecycle recovery / all-local fallback 创建的 rescue branch。

安全判定：

- 必须能通过 branch name、lifecycle record、issue body marker、commit marker、或 worktree registration 证明 branch 属于 lifecycle。
- branch 必须已经 merged into base，或能证明 rescue branch 的内容已被合并 / 取代 / 无差异。
- branch 不能被任何 registered worktree 使用。
- branch 不能包含 unmerged user commits。
- ambiguous 时只报告，不删除。

删除策略：

- 本地 branch：使用 safe delete 语义；失败则报告 blocked，不升级 force delete。
- remote branch：只有 ownership gate 通过且 remote target 是用户 fork / own repo 时才允许；绝不删除 upstream remote branch。
- rescue branch：默认偏保守，优先 audit；只有 lifecycle marker + merged/no-diff 双重满足才自动 prune。

### 5. Bootstrap commands stay outside lifecycle

`/all-init` / `/all-rebuild` / `/all-status` 保持 knowledge bootstrap 命令：

- `/all-status` 继续 read-only。
- `/all-init` 可在 uninitialized 目录中创建知识库文件，不要求 GitHub ownership。
- `/all-rebuild` 继续只做覆盖确认，不要求 lifecycle issue。
- 三者不自动 start lifecycle、不创建 issue、不创建 branch、不触发 ownership preflight。

## Architecture

```text
OpenCode ctx.directory
  ↓
repo-discovery.resolveEffectiveProjectRoot(ctx.directory)
  ├─ parent/current git repo found → repoRoot
  ├─ no parent repo + exactly one child repo → child repoRoot
  ├─ no repo → uninitialized project root → local-only
  └─ multiple child repos / inaccessible → blocked ambiguous
  ↓
lifecycle_start_request
  ↓
classifyRepo(repoRoot)
  ├─ FORK / OWN → mode=remote, create GitHub issue, create worktree branch
  ├─ UPSTREAM / UNKNOWN → mode=local-only, local record, optional local branch/worktree only
  └─ uninitialized → mode=local-only, local record only, no git init
  ↓
design / plan / executor
  ↓
remote mutation requested?
  ├─ no → continue local lifecycle
  └─ yes → ownership gate
        ├─ FORK / OWN target origin → allow
        └─ UPSTREAM / UNKNOWN / no repo → block with recovery hint
  ↓
lifecycle_finish
  ├─ local-only → no PR/remote merge; mark local terminal state with clear note
  └─ remote → PR/local merge path then cleanup
        ↓
branch-cleanup policy
  ├─ current lifecycle branch safe → delete local branch after worktree removal
  ├─ stale issue/* safe → audit/prune path may delete
  ├─ rescue/all-local/* safe → audit/prune path may delete conservatively
  └─ ambiguous/user/upstream → report only
```

## Components

### Component 1: `src/lifecycle/repo-discovery.ts`

New pure-ish module that resolves the effective project root before lifecycle start.

Responsibilities:

- Run parent-first repo detection using `git rev-parse --show-toplevel`.
- Scan direct child directories only when parent/current lookup fails.
- Return structured results instead of throwing for ordinary “not a repo” cases.
- Include `source: "parent" | "current" | "unique-child" | "uninitialized"` and candidate paths for diagnostics.

Planned tests:

- current directory inside repo resolves to parent repo root.
- parent workspace with exactly one child repo resolves to unique child.
- parent workspace with multiple child repos returns ambiguous.
- directory with no repo returns uninitialized and does not call `git init`.

### Component 2: `src/lifecycle/pre-flight.ts`

Keep `classifyRepo` as ownership classifier, but narrow its semantic meaning: it answers “may we mutate this remote?”, not “may lifecycle run?”.

Changes:

- Preserve `FORK` / `OWN` / `UPSTREAM` / `UNKNOWN` classifications.
- Ensure `UNKNOWN` carries enough reason for local-only notes where practical (`no-origin`, `unparseable-origin`, `gh-failed`, `view-mismatch`).
- Do not let callers treat `UNKNOWN` as fatal unless the caller is a remote mutation gate.

### Component 3: `src/lifecycle/index.ts`

Update lifecycle start and mutation flows.

Changes:

- Initialize lifecycle context from discovered repo root instead of raw `ctx.directory`.
- Replace `getPreFlightNote(preflight)` start-abort behavior with `determineLifecycleMode(discovery, preflight)`.
- For `remote` mode: keep existing GitHub issue creation + worktree flow.
- For `local-only` repo mode: create a local lifecycle record with local id / branch metadata, skip GitHub issue creation, and create local branch/worktree only when an actual git repo exists and it is safe.
- For `local-only` uninitialized mode: create local record/artifact flow only; no branch/worktree; notes explicitly say no auto `git init`.
- Wrap `saveAndSync`, issue edit/close, commit push, PR/merge remote operations in remote mutation gate so local-only records do not accidentally call `gh`.

### Component 4: branch cleanup policy modules

Extend existing cleanup modules rather than replacing them:

- `src/lifecycle/cleanup-policy.ts` remains responsible for current worktree cleanup.
- Add branch cleanup helpers for current lifecycle branch after worktree removal.
- Add audit classifier for stale branches, likely in `src/lifecycle/branch-cleanup.ts` or adjacent module.
- Reuse existing `cleanup-classifier.ts` style: pure classifier first, shelling-out policy second.

Branch audit output should classify each candidate as:

- `prune-local`: safe local deletion.
- `prune-remote`: safe remote deletion after ownership gate.
- `keep-active`: active lifecycle / open issue / registered worktree.
- `keep-user`: not lifecycle-owned or user branch.
- `blocked-ambiguous`: lifecycle-like name but ownership / merge state cannot be proven.
- `blocked-upstream`: remote target is upstream or unknown.

### Component 5: lifecycle tools and recovery hints

Expose the new behavior through existing tool surfaces without making bootstrap depend on lifecycle:

- `lifecycle_start_request` output should state `mode=remote` or `mode=local-only`, discovered root, and remote capability status.
- `lifecycle_current` / resolver should understand local-only records and avoid interpreting absent GitHub issue URL as corruption.
- `lifecycle_finish` should produce clear recovery hints when local-only cannot perform PR/remote merge.
- Add or extend an audit tool path for stale `issue/*` / `rescue/all-local/*` branches; pruning should be dry-run/audit-first unless the branch is current lifecycle branch after successful finish.

### Component 6: knowledge bootstrap boundaries

Keep `src/agents/knowledge-bootstrap-orchestrator.ts`, `src/tools/knowledge-bootstrap/*`, and `src/index.ts` command registrations lifecycle-independent.

Required guard:

- Add/keep tests proving `/all-init`, `/all-rebuild`, and `/all-status` prompts do not call lifecycle_start_request and do not require ownership preflight.
- Documentation should describe these as bootstrap flows, not local-only lifecycle flows.

## Data Flow

### Remote-capable lifecycle start

```text
ctx.directory
  → repo discovery resolves /repo/project
  → classifyRepo(/repo/project) = FORK or OWN
  → ownership gate allows issue create
  → gh issue create --repo owner/repo
  → create record mode=remote with real issueNumber / issueUrl
  → git worktree add -b issue/<N>-slug worktree
  → save local record and sync issue body
```

### Local-only lifecycle start in existing git repo

```text
ctx.directory
  → repo discovery resolves /repo/project
  → classifyRepo(/repo/project) = UNKNOWN or UPSTREAM
  → no start abort
  → create local-only record with explicit local identity
  → create local branch/worktree only if safe and repo exists
  → skip gh issue create / issue edit
  → design / plan / executor can proceed locally
  → push / PR / remote cleanup later blocked until ownership gate passes
```

### Local-only lifecycle start in uninitialized directory

```text
ctx.directory
  → repo discovery finds no parent repo and no unique child repo
  → result = uninitialized
  → create local-only record only
  → do not git init
  → do not create branch/worktree
  → design / plan artifacts can still be written under thoughts/shared when directory exists
  → remote operations blocked with recovery hint: initialize/fork explicitly outside lifecycle auto-flow
```

### Branch audit / cleanup

```text
git branch --list issue/* rescue/all-local/*
  → for each candidate gather: local/remote, merged-to-base, worktree usage, lifecycle record match, marker evidence
  → classify candidate
  → safe current lifecycle branch after finish: delete local branch
  → safe stale lifecycle-owned branch: include in prune plan
  → remote branch candidate: ownership gate before deletion
  → ambiguous/user/upstream: report only
```

## Error Handling

- **Multiple child repos discovered**: return ambiguous with candidate list; do not choose. Lifecycle start should block with recovery hint asking caller to run from intended repo or pass explicit root in a future supported path.
- **No repo discovered**: enter local-only uninitialized mode; do not run `git init`; remote mutation attempts return blocked recovery hint.
- **`classifyRepo` returns `UNKNOWN`**: start local-only; remote mutation gate blocks push / issue / PR / remote cleanup with the classifier reason.
- **Repo classified as `UPSTREAM`**: start local-only if local work is safe; remote mutation gate blocks and explicitly says upstream mutation is forbidden.
- **GitHub issues disabled on own/fork repo**: enabling issues remains a remote mutation and is allowed only after ownership gate; failure falls back to local-only or blocked remote operation, not destructive recovery.
- **Branch cleanup candidate has unmerged commits**: keep and report as `keep-user` or `blocked-ambiguous`; never force delete.
- **Branch cleanup candidate is used by a worktree**: keep and report `keep-active`; do not delete before worktree cleanup succeeds.
- **Remote branch deletion target is upstream / unknown**: block as `blocked-upstream`; no remote mutation.
- **Local-only finish requested with PR-first merge**: report that PR/remote merge is unavailable in local-only mode; either perform an explicitly safe local terminal transition or block with recovery hint, depending on current lifecycle state.

## Testing Strategy

Add focused tests around pure classifiers first, then lifecycle integration tests with fake runners.

1. `tests/lifecycle/repo-discovery.test.ts`
   - parent/current repo wins over child scan.
   - exactly one child repo is selected.
   - multiple child repos are ambiguous.
   - no repo returns uninitialized and never calls `git init`.
2. `tests/lifecycle/pre-flight.test.ts`
   - `UNKNOWN` remains a valid classification with reason data.
   - `FORK` and `OWN` remain remote-mutation allowed.
   - `UPSTREAM` remains remote-mutation blocked.
3. `tests/lifecycle/index.test.ts`
   - start from nested directory uses discovered repo root, not raw `ctx.directory`.
   - `UNKNOWN` no longer aborts start; creates local-only record and skips `gh issue create`.
   - uninitialized directory creates local-only record and does not call `git worktree add`.
   - remote-capable repo preserves current issue + worktree behavior.
4. `tests/lifecycle/commit-tool-recovery.test.ts` / `tests/lifecycle/finish-recovery.test.ts`
   - local-only push / PR / remote merge attempts fail at remote mutation gate with recovery hint.
   - upstream remote mutation is blocked.
5. `tests/lifecycle/branch-cleanup.test.ts`
   - lifecycle-owned merged `issue/*` branch is safe to prune.
   - ambiguous `issue/*` branch is reported only.
   - `rescue/all-local/*` branch requires lifecycle marker plus merged/no-diff proof.
   - remote deletion requires ownership gate.
6. `tests/agents/agents-md-knowledge-bootstrap.test.ts` and related bootstrap tests
   - `/all-init`, `/all-rebuild`, `/all-status` remain bootstrap-only and do not mention lifecycle ownership preflight as prerequisite.

Manual acceptance checks:

- Run lifecycle from a nested folder inside a repo and confirm it records the repo root.
- Run lifecycle from a parent folder with exactly one child repo and confirm it selects the child.
- Run lifecycle from a folder with no git repo and confirm design-only artifacts can be created without `git init`.
- Attempt push/PR in local-only mode and confirm it blocks before any remote mutation.
- Run branch audit and confirm ambiguous/user/upstream candidates are reported, not deleted.

## Open Questions

- **Local-only identity shape**: implementation must choose a non-conflicting local id scheme that cannot be mistaken for a GitHub issue number. Recommended default: use a prefixed local id internally (`local-<timestamp-or-seq>`) while preserving compatibility at tool output boundaries.
- **Upgrade path from local-only to remote**: this design permits later remote capability after ownership gate passes, but does not require automatic migration of local-only records into GitHub issues. Recommended default: explicit future sync command / planner task if needed.
- **Audit tool UX**: whether branch audit is exposed as a new lifecycle tool or folded into `lifecycle_finish` report can be decided during planning. Recommended default: keep finish-time cleanup automatic for current branch, make stale branch cleanup audit-first.

## Behavior

- When OpenCode is opened below a repo root, lifecycle uses the discovered parent repo root instead of failing or operating from the wrong directory.
- When OpenCode is opened at a workspace containing exactly one child repo, lifecycle selects that child repo; if multiple child repos exist, it reports ambiguity instead of guessing.
- When a project has no confirmed GitHub ownership, lifecycle still allows local design / plan / execution work and clearly labels the run `local-only`.
- Remote writes only happen after ownership is confirmed; unknown, upstream, or uninitialized projects block push / issue / PR / merge / remote branch cleanup before mutation.
- Successful finish cleans lifecycle-owned branches when safe; stale `issue/*` and `rescue/all-local/*` branches can be audited and pruned only when ownership and merge safety are proven.
- Knowledge bootstrap commands remain usable as bootstrap commands and do not require lifecycle ownership preflight.

Atlas 关联：本次行为主要对应 lifecycle workflow / repository discovery / cleanup mental model；当前 `atlas_lookup` 未找到精确节点，后续 executor 若落地代码应维护相关 `atlas/10-impl` 与 `atlas/20-behavior` 节点或创建 delta。
