---
date: 2026-05-12
topic: "Octto runtime promotion after batched auto-resume"
issue: 66
scope: octto
contract: none
---

# Octto Runtime Promotion Implementation Plan

**Goal:** Promote the already-merged issue #65 Octto batched auto-resume work into the local OpenCode runtime checkout at `/root/.micode` via the existing `deploy:runtime` helper, without restarting OpenCode.

**Architecture:** Pure operational orchestration — no source code is created or modified. The executor verifies that issue #65's implementation commit is reachable from `origin/main`, brings the local main branch in line with the remote (fast-forward only), runs `bun run deploy:runtime` from a clean main checkout, and reports runtime readiness back to the user. Restart is explicitly left as a future manual user action.

**Design:** `thoughts/shared/designs/2026-05-12-octto-runtime-promotion-design.md`

**Contract:** none (single-domain ops plan; no frontend/backend split)

**Sanity Notes (pre-resolved during planning):**
- Issue #65 implementation commit `eca5c40 chore(octto): implement octto batched auto-resume (#65)` is reachable from both local `main` and `origin/main` (verified via `git log` during planning). Step 1.2 will re-confirm at execute time.
- Ownership pre-flight already done during planning: `origin` = `Wuxie233/micode` (fork, viewerPermission ADMIN), `parent` = `vtemian/micode` (upstream). Step 1.1 re-runs the check so the executor records evidence in its own session. Any push (none planned here) would target `origin` only.
- Runtime deploy entry point is `bun run deploy:runtime` → `scripts/deploy-runtime.ts` → `runRuntimeDeploy` in `src/utils/runtime-deploy.ts`. The script exits 0 on `ready`, 1 otherwise, and never restarts OpenCode.

---

## Dependency Graph

```
Batch 1 (sequential within batch — all read-only verifications): 1.1, 1.2, 1.3 [pre-flight - no deps]
Batch 2 (sequential):                                            2.1         [main sync - depends on 1.1, 1.2, 1.3]
Batch 3 (sequential):                                            3.1         [deploy - depends on 2.1]
Batch 4 (sequential):                                            4.1, 4.2    [verification + final report - depends on 3.1]
```

Note: although the plan is grouped into batches, every task in this plan is sequential by nature (they all touch the same shared state: the git repo and the runtime checkout). The batch structure is preserved to match planner conventions, but the executor MUST run tasks within and across batches in the listed order.

---

## Batch 1: Pre-flight Verification (sequential)

All tasks in this batch are read-only verifications. They establish that the promotion is safe to proceed.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Ownership pre-flight on the source checkout
**File:** none (operational verification only — no file is created or modified)
**Test:** none (low-risk: read-only ownership classification per AGENTS.md "Repository Ownership Awareness")
**Depends:** none
**Domain:** general

Run from the lifecycle worktree `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-`:

```sh
git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission
```

**Expected evidence (pre-confirmed during planning, executor must re-confirm):**
- `origin` = `https://github.com/Wuxie233/micode.git` (fetch and push).
- `gh repo view` reports `"isFork": true`, `"nameWithOwner": "Wuxie233/micode"`, `"parent.owner.login": "vtemian"`, `"viewerPermission": "ADMIN"`.

**Classification:** Case A — fork for personal use. Safe push target is `origin` only. Never push to `parent` (`vtemian/micode`).

**Stop conditions (hard fail, do not proceed to 1.2):**
- `isFork` is `false` and `origin` points to `vtemian/micode` directly.
- `origin` URL has changed from the expected fork URL.
- `viewerPermission` is anything other than `ADMIN` or `WRITE`.

**Verify:** Executor records the one-line ownership statement in chat: "确认下：这是 fork (origin=Wuxie233/micode)，promotion 不会推到上游 vtemian/micode。"
**Commit:** none (verification only; no files changed)

---

### Task 1.2: Verify issue #65 implementation commit is reachable from `origin/main`
**File:** none (read-only git ancestry check)
**Test:** none (low-risk: read-only git query; design's testing strategy explicitly accepts `git log`/ancestry as primary verification)
**Depends:** 1.1 (must classify ownership before any remote interaction, even fetch)
**Domain:** general

Run from `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-`:

```sh
git fetch origin main
git log origin/main --oneline | grep -E "chore\(octto\): implement octto batched auto-resume \(#65\)"
git merge-base --is-ancestor eca5c40 origin/main && echo "ANCESTOR_OK" || echo "ANCESTOR_MISSING"
```

**Expected evidence (pre-confirmed during planning):**
- `git log origin/main --oneline` contains the line `eca5c40 chore(octto): implement octto batched auto-resume (#65)`.
- The merge commit `af0b133 Merge branch 'issue/65-...'` is also present on `origin/main`.
- The ancestor check prints `ANCESTOR_OK`.

**Stop conditions (hard fail, do not proceed to 1.3):**
- `ANCESTOR_MISSING` is printed.
- Neither `eca5c40` nor an equivalent `#65` implementation commit appears in `git log origin/main --oneline`.
- `git fetch origin main` fails repeatedly (network blocker). In that case, report the blocker and stop; do not improvise by skipping verification.

**Note on duplicate-merge avoidance:** Because issue #65 is confirmed on `origin/main`, this plan does NOT attempt any merge of the `issue/65-*` branch. The design's "If issue #65 is already merged into main, report that instead of attempting a duplicate merge" constraint is satisfied at this step.

**Verify:** Executor pastes the `ANCESTOR_OK` output and the matching `git log` line into its report.
**Commit:** none

---

### Task 1.3: Confirm the lifecycle worktree is clean and on the issue/66 branch
**File:** none (read-only working tree status check)
**Test:** none (low-risk: read-only `git status`)
**Depends:** none (independent of 1.1/1.2, but listed third because it gates Batch 2 which switches branches)
**Domain:** general

Run from `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-`:

```sh
git status --porcelain
git branch --show-current
```

**Expected evidence (pre-confirmed during planning):**
- `git status --porcelain` prints nothing (working tree clean).
- `git branch --show-current` prints `issue/66-promote-the-completed-octto-batched-auto-resume-`.

**Stop conditions (hard fail, do not proceed to Batch 2):**
- `git status --porcelain` is non-empty (uncommitted changes — would risk losing work on branch switch).
- The current branch is not the issue/66 lifecycle branch.

**Verify:** Executor reports "工作树干净，在 issue/66 lifecycle 分支上。"
**Commit:** none

---

## Batch 2: Main Branch Sync (sequential)

Depends on Batch 1 having confirmed ownership classification and issue #65 ancestry on `origin/main`.
Tasks: 2.1

### Task 2.1: Fast-forward local `main` to `origin/main` and check it out
**File:** none (operational git update; no source files modified)
**Test:** none (low-risk: safe git fast-forward, no merge, no rebase, no push)
**Depends:** 1.1, 1.2, 1.3 (ownership confirmed, ancestry confirmed, worktree clean)
**Domain:** general

The `deploy:runtime` helper builds from whatever branch is currently checked out. To avoid promoting a stale or branch-specific state, the executor must run deploy from `main` synced with `origin/main`. Run from `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-`:

```sh
# Inspect divergence first (read-only)
git rev-parse main
git rev-parse origin/main
git rev-list --count main..origin/main
git rev-list --count origin/main..main

# Switch to main and fast-forward only (never --force, never rebase)
git checkout main
git merge --ff-only origin/main

# Confirm post-state
git rev-parse HEAD
git log -1 --oneline
```

**Expected behavior:**
- During planning, both local `main` and `origin/main` already point at `af0b133`. The `git rev-list --count` calls should print `0` in both directions, meaning `git merge --ff-only` is a no-op and exits 0.
- If `origin/main` has advanced since planning (`main..origin/main` count > 0 AND `origin/main..main` count == 0), the fast-forward will silently update local `main`. This is the safe expected case.

**Stop conditions (hard fail — switch back to issue/66 branch and report blocker):**
- `git rev-list --count origin/main..main` is > 0 (local `main` has commits not in `origin/main`). This indicates unexpected drift. Do NOT attempt to rebase, force, or push. Switch back with `git checkout issue/66-promote-the-completed-octto-batched-auto-resume-` and report the divergence to the user.
- `git merge --ff-only origin/main` fails with anything other than "Already up to date.". Switch back and report.
- `git checkout main` fails (e.g., due to unexpected uncommitted changes that 1.3 missed). Report and stop.

**Hard rules (from AGENTS.md + design constraints):**
- No `git push` in this task. Promotion is local-runtime only.
- No `--force`, no `reset --hard`, no `rebase`. Fast-forward only.
- No branch deletion.

**Verify:** Executor reports the local `main` HEAD SHA matches `origin/main` HEAD SHA and quotes the matching `git log -1 --oneline` line.
**Commit:** none

---

## Batch 3: Runtime Deploy (sequential)

Depends on Batch 2 having a clean, up-to-date `main` checkout.
Tasks: 3.1

### Task 3.1: Run the existing `deploy:runtime` helper from `main`
**File:** none (the deploy helper itself is the existing `scripts/deploy-runtime.ts`; this task INVOKES it, does not create or modify it)
**Test:** none (low-risk: the deploy helper has its own preflight/build/exit-code contract; the design explicitly says "Use the deploy helper's own build/preflight result as the primary verification". Adding a separate test here would duplicate that contract.)
**Depends:** 2.1 (must run from a clean `main` synced to `origin/main`)
**Domain:** general

**Pre-deploy dry-run (safety net — recommended but optional per script contract):**

```sh
bun run deploy:runtime -- --dry-run
```

The script accepts `--dry-run` (per `scripts/deploy-runtime.ts` lines 13-19); it always exits 0 in dry-run mode and prints the planned actions. Use this if there is any doubt about what will be touched. If the dry-run output reveals an unexpected destructive action (e.g., would delete unrelated files in `/root/.micode`), STOP and report; do not proceed to the apply step.

**Apply deploy:**

Run from `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-` (still on `main` from Task 2.1):

```sh
bun run deploy:runtime
```

This invokes `scripts/deploy-runtime.ts`, which calls `runRuntimeDeploy({ mode: "apply", force: false })` from `src/utils/runtime-deploy.ts` and prints a formatted report. The script exits 0 if `report.ready === true`, else 1.

**Expected behavior:**
- The helper performs its own preflight (clean tree check, build, sync to `/root/.micode` with preserved-path and exclusion rules).
- Stdout ends with the helper's standard report. The report includes a `ready: true|false` field and a no-restart reminder.
- Exit code 0.

**Stop conditions (hard fail — report and do not improvise a manual copy):**
- Exit code is non-zero. Capture the full stdout/stderr in the report. Do NOT attempt `cp -r`, `rsync`, or any ad-hoc copy. Do NOT pass `--force` without explicit user approval.
- The helper reports a missing-tooling or dirty-state preflight error. Report the exact error and stop.
- The helper output is empty or truncated (suggests crash before printing the report). Stop and report.

**Hard rules (from design constraints):**
- **NEVER restart OpenCode.** The deploy script is contract-bound to not restart, but do not add any post-deploy `systemctl restart`, `restart-opencode-detached`, manual `opencode web`/`opencode serve` restart, or similar command in any wrapper script.
- Do not invent a parallel deploy path. The only allowed entry point for this task is `bun run deploy:runtime`.

**Verify:** Executor captures and quotes the helper's `ready: true` line (or full report on failure) and the exit code.
**Commit:** none (the deploy helper writes to `/root/.micode`, not into the repository working tree)

---

## Batch 4: Verification and Reporting (sequential)

Depends on Batch 3 having run the deploy helper.
Tasks: 4.1, 4.2

### Task 4.1: Post-deploy runtime readiness verification
**File:** none (read-only inspection of the runtime checkout at `/root/.micode`)
**Test:** none (low-risk: read-only file inspection. The design's testing strategy explicitly accepts the helper's own build/preflight result as primary verification; this task adds a thin secondary check to confirm the source-of-truth artifact reached the runtime location.)
**Depends:** 3.1 (deploy must have reported `ready: true`)
**Domain:** general

The goal here is to provide independent evidence that the runtime checkout reflects the version that contains issue #65's implementation. Two complementary checks:

```sh
# 1. Confirm the runtime directory exists and has a dist build
ls -la /root/.micode/dist/index.js
stat -c '%y' /root/.micode/dist/index.js

# 2. Confirm the runtime carries the issue #65 implementation marker.
#    The brainstormer subagent prompt is one of the surfaces #65 touched
#    (per issue #65 implementation history). Grep for an octto auto-resume marker
#    that exists ONLY in the post-#65 sources.
grep -rl "batched auto-resume\|auto-resume dispatcher\|create_brainstorm" /root/.micode/src/agents/ /root/.micode/src/tools/octto/ 2>/dev/null | head -5

# 3. Cross-check version metadata
cat /root/.micode/package.json | grep '"version"'
```

**Expected behavior:**
- `/root/.micode/dist/index.js` exists and its mtime is from this task's run (i.e., the deploy in 3.1 rebuilt it).
- The grep returns at least one path under `/root/.micode/src/`, confirming the post-#65 octto code is present in the runtime checkout.
- The version line matches the version in `package.json` on `main` at the time of deploy.

**Stop conditions (degrade report to "deploy succeeded, verification inconclusive" per design's error-handling rule — do NOT retry deploy with `--force` and do NOT restart):**
- `/root/.micode/dist/index.js` is missing or has a stale mtime predating 3.1.
- The grep returns zero matches (could mean the runtime is pre-#65, or that the markers chosen here drifted from the actual #65 implementation).
- Version metadata mismatches `main`.

**Important:** Verification inconclusive is NOT a failure of the deploy step. Report exactly what was found and let the user judge. Do not attempt remediation.

**Verify:** Executor pastes the three command outputs into its report.
**Commit:** none

---

### Task 4.2: Switch back to the issue/66 lifecycle branch and produce the final user-facing report
**File:** none (operational state restoration + report writing in chat, not in a file)
**Test:** none (low-risk: branch switch back; no file mutations)
**Depends:** 4.1
**Domain:** general

**State restoration:**

Run from `/root/CODE/issue-66-promote-the-completed-octto-batched-auto-resume-`:

```sh
git checkout issue/66-promote-the-completed-octto-batched-auto-resume-
git status
```

Confirm the worktree returns to the lifecycle branch and is clean.

**No-restart guard (final reminder in the executor's report — design constraint):**

The final user-facing report MUST contain one explicit line stating that OpenCode was NOT restarted and that restart remains a future manual user action. Suggested phrasing (Chinese, matching project communication preference):

> 未重启 OpenCode。运行时 `/root/.micode` 已就绪，下次手动重启 OpenCode 时会加载已包含 issue #65 (Octto batched auto-resume + 模型继承) 的版本。

**Final report shape (executor synthesizes these fields):**

1. Ownership classification (from 1.1).
2. Issue #65 ancestry confirmation on `origin/main` (from 1.2, including the commit SHA `eca5c40` and merge SHA `af0b133`).
3. Local `main` HEAD SHA after fast-forward (from 2.1).
4. `deploy:runtime` exit code and `ready` field value (from 3.1).
5. Runtime verification evidence (from 4.1) — even when inconclusive.
6. Explicit no-restart statement (above).
7. Current branch after state restoration (should be `issue/66-...`).

**Progress logging (best-effort):**

If lifecycle tools are available, log progress:

```
lifecycle_log_progress(kind="status",  summary="runtime deploy completed: ready=<value>, main HEAD=<sha>")
lifecycle_log_progress(kind="handoff", summary="runtime promoted; user will restart OpenCode manually")
```

If `lifecycle_current` reports `none` or `ambiguous` for this branch, skip logging silently.

**Verify:**

```sh
git branch --show-current   # expect: issue/66-promote-the-completed-octto-batched-auto-resume-
git status --porcelain      # expect: empty
```

**Commit:** none (this plan introduces zero source changes; the only on-disk side effects are `/root/.micode/*` from the deploy helper, which is outside the repository working tree, and a possible fast-forward of local `main` in Task 2.1, which carries no new commits, only ref-pointer movement)
