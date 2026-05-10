---
date: 2026-05-10
topic: "Runtime stage Atlas shared mental model"
issue: 61
scope: runtime-deploy
contract: none
---

# Runtime Stage Atlas Shared Mental Model — Ops Plan

**Goal:** Stage the already-merged Atlas shared mental model changes (source `/root/CODE/micode` @ `52c7d12`) into the local OpenCode runtime at `/root/.micode` so the user's next manual OpenCode restart picks them up.

**Architecture:** Pure operational follow-through. Use the existing `bun run deploy:runtime` script (`scripts/deploy-runtime.ts` → `src/utils/runtime-deploy/index.ts`) which handles preflight (clean source/runtime, tooling), `rsync` source → runtime with the project exclusion list, and `bun install` + `bun build` to produce `/root/.micode/dist/index.js`. The script never restarts OpenCode by design (`runtime-deploy/report.ts` line: "Restart of OpenCode requires explicit user approval"). No source code changes. The only generated artifact is the runtime bundle, which is the whole point of staging.

**Design:** No design doc. This is operational follow-through after issue #60.

**Contract:** none (single-domain ops task, no frontend/backend split)

**Pre-flight facts (already verified):**
- Source `/root/CODE/micode` HEAD = `52c7d12` (Merge of issue/60 — contains Atlas shared mental model).
- Runtime `/root/.micode` HEAD = `b0ffea1` (older; predates Atlas protocol).
- `package.json` exposes `deploy:runtime` script. No new deploy mechanism needed.
- `RUNTIME_DEPLOY_PATHS.source = /root/CODE/micode`, so the deploy script runs against the canonical source tree, NOT this worktree. This worktree exists only to host the issue lifecycle artifacts (this plan + ledger).

**Hard constraints:**
- Implementer MUST NOT run `systemctl restart opencode-web.service`, `/usr/local/bin/restart-opencode-detached`, `opencode web`, `opencode serve`, or any equivalent.
- Implementer MUST NOT modify source code; the only writes allowed are the ones `deploy:runtime` itself produces inside `/root/.micode` (rsync'd files + `dist/index.js` + `node_modules` if lockfile diverged).
- If `deploy:runtime` reports `NOT READY` for any reason (preflight failure, sync failure, build failure), implementer MUST stop and report; do NOT attempt manual rsync, manual build, or any workaround.
- All `bun run` commands are executed from `/root/CODE/micode` (the configured source), NOT from this worktree.

---

## Dependency Graph

```
Batch 1 (sequential within batch — single shell session, ordered): 1.1 → 1.2 → 1.3
```

Only one batch. Three tasks are ordered (dry-run validates before apply; verify follows apply) and run in a single implementer-general session. No parallelism; the work is inherently linear ops.

---

## Batch 1: Stage runtime via existing deploy script (general — 1 implementer)

Tasks: 1.1, 1.2, 1.3

### Task 1.1: Dry-run validation of runtime deploy
**File:** none (operational; no file write)
**Test:** none (ops task; risk is captured by the dry-run itself which is the test)
**Depends:** none
**Domain:** general

Run the existing `deploy:runtime` script in dry-run mode to confirm preflight passes (source clean, runtime clean, rsync + bun on PATH) and to preview what `rsync` would change. This is the gating check before any write to `/root/.micode`.

```sh
# Run from the canonical source tree, not the worktree.
cd /root/CODE/micode
bun run deploy:runtime -- --dry-run
```

**Expected report shape (must match all of):**
- Line `MODE: dry-run`
- Line starting with `PREFLIGHT: ok source=52c7d12 runtime=b0ffea1` (short SHAs may differ if more commits land, but `kind=ok` is required)
- Line starting with `SYNC: ok files=<N>` where `N >= 1` (proves Atlas-related files would be transferred)
- Line `DRY-RUN: no changes were applied to /root/.micode`
- Line `NOT READY: see failures above; do not restart OpenCode` (expected in dry-run; `ready=false` is by design when build is skipped)

**Verify:** dry-run exit code is `0` (the script returns 0 on dry-run regardless of `ready`, per `scripts/deploy-runtime.ts` line 25).
**Stop condition:** if `PREFLIGHT: failed` appears, STOP and report the `reason` and `detail` fields verbatim. Do NOT proceed to 1.2. Do NOT use `--force`. Common failure reasons and required user escalation:
- `source-dirty` → user must commit/stash work in `/root/CODE/micode` first.
- `runtime-dirty` → user must inspect `/root/.micode` (likely manual edits to investigate before clobbering).
- `rsync-missing` / `bun-missing` → user must install the tool.

**Commit:** none (read-only op).

### Task 1.2: Apply runtime deploy
**File:** none (operational; the script writes into `/root/.micode`, which is OUTSIDE this repo and is NOT git-tracked from this worktree's perspective)
**Test:** none (the script's own preflight + sync + build + bundle-size check is the verification)
**Depends:** 1.1 (dry-run must have reported `PREFLIGHT: ok` and `SYNC: ok`)
**Domain:** general

Run the same script in apply mode. This invokes `runSync` (rsync source → runtime with project exclusions), then `runBuild` (which conditionally runs `bun install` if `bun.lock` diverged, then `bun run build` to regenerate `/root/.micode/dist/index.js`). The script explicitly does not restart OpenCode.

```sh
cd /root/CODE/micode
bun run deploy:runtime
```

**Expected report shape (must match all of):**
- Line `MODE: apply`
- Line starting with `PREFLIGHT: ok ...`
- Line starting with `SYNC: ok files=<N> bytes=<B>`
- Line starting with `BUILD: ok bundle=<bytes> bytes installRan=<true|false>` where `bundle >= 1024` (the configured `minBundleBytes`)
- Final line `Runtime ready. Restart of OpenCode requires explicit user approval.`

**Verify:** exit code is `0`. The final "Runtime ready" line is the script's own contract that staging is complete and the user-controlled restart is the only remaining step.

**Stop condition:** if any of `PREFLIGHT: failed`, `SYNC: failed`, or `BUILD: failed` appear, STOP and report the failing stage's `detail` verbatim. Do NOT retry with `--force`. Do NOT manually rerun rsync or build. Do NOT touch `/root/.micode` by hand.

**Critical do-not:**
- Do NOT run `systemctl restart opencode-web.service`.
- Do NOT run `/usr/local/bin/restart-opencode-detached`.
- Do NOT run `opencode web` / `opencode serve` / `opencode` in any form.
- Do NOT `kill` any opencode process.

**Commit:** none. The runtime tree is not part of this repo; nothing to commit here from staging itself. The lifecycle plan/ledger commit is handled separately by `lifecycle_commit`.

### Task 1.3: Verify runtime bundle picked up Atlas changes
**File:** none (verification only; read-only inspection of `/root/.micode`)
**Test:** none (this task IS the test of 1.2; failures here mean the deploy did not actually stage the intended changes)
**Depends:** 1.2
**Domain:** general

Confirm the staged runtime carries the merged Atlas shared mental model code, so that the user's next manual restart will load the new behavior. Three independent signals must all pass.

```sh
# Signal A: runtime git HEAD now matches source HEAD (rsync brought .git along too).
cd /root/.micode
git rev-parse HEAD
# Expected: 52c7d12... (same prefix as /root/CODE/micode HEAD)

# Signal B: the Atlas mental model module exists in the staged source tree.
ls -la /root/.micode/src/agents/atlas-mental-model.ts

# Signal C: the rebuilt bundle contains the Atlas protocol marker string.
# ATLAS_MENTAL_MODEL_PROTOCOL is the exported constant per AGENTS.md "Atlas Shared Mental Model" section.
grep -c "ATLAS_MENTAL_MODEL_PROTOCOL" /root/.micode/dist/index.js
# Expected: a positive integer (>= 1). 0 means the bundle does not embed the new protocol — staging failed.

# Signal D: bundle mtime is recent (sanity check that 1.2 actually rebuilt).
stat -c '%y %s' /root/.micode/dist/index.js
```

**Verify:**
- Signal A: `/root/.micode` HEAD short SHA equals `/root/CODE/micode` HEAD short SHA (both should start with `52c7d12` or whatever the current source HEAD is at apply time).
- Signal B: file exists.
- Signal C: grep count `>= 1`.
- Signal D: mtime is within the last few minutes (i.e., produced by 1.2's build, not stale from a prior deploy).

**Stop condition:** if any signal fails, report which one and STOP. Do NOT attempt remediation. Likely root cause is that 1.2 silently degraded; the user needs to investigate before another deploy attempt.

**Final hand-off message to user (implementer must include in completion report):**
> Atlas shared mental model changes are staged in `/root/.micode` (HEAD `<short-sha>`, bundle rebuilt at `<mtime>`). OpenCode is NOT restarted. Next manual restart of OpenCode will load the new Atlas protocol. To activate now, run your usual restart command yourself; this plan deliberately did not.

**Commit:** none.

---

## Notes for executor

- All three tasks run in `implementer-general`. No frontend/backend split, no contract.
- Tasks are sequential within the batch (1.1 must complete before 1.2 — gating; 1.2 before 1.3 — causal). Do NOT parallelize.
- No source-code edits in this plan, so reviewer cycle is a light sanity check on the implementer's report (did the expected report shapes appear? did all four verification signals pass?), not a code review.
- `lifecycle_commit` at the end of executor will commit only the plan + ledger files in this worktree's `thoughts/shared/...`. The runtime tree at `/root/.micode` is intentionally outside this repo and is not part of any commit.
- If the user later asks to also restart, that is a SEPARATE turn requiring explicit user approval per global AGENTS.md "High-Impact Safety Rules". Do not bundle restart into this plan.
