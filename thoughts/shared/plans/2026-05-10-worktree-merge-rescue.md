---
date: 2026-05-10
topic: "Worktree Merge Rescue"
issue: 62
scope: lifecycle
contract: none
---

# Worktree Merge Rescue Implementation Plan

**Goal:** Preserve the local-only Atlas/agents/runtime work in the micode reconcile worktree, then move each already-pushed lifecycle feature branch toward its repository mainline through ownership-checked PR or merge paths, and record final per-repo outcomes.

**Architecture:** Each target repository is an independent rescue unit. The pipeline runs in three stages — snapshot (read-only), preservation (commit/push dirty work), advancement (PR / merge / block) — coordinated by a per-repo evidence file under `thoughts/shared/rescue/2026-05-10/`. All remote writes are gated by an ownership preflight that records `git remote -v` and `gh repo view --json` output before any mutation. No worktree is deleted; blocked branches are reported with evidence.

**Design:** [thoughts/shared/designs/2026-05-10-worktree-merge-rescue-design.md](../designs/2026-05-10-worktree-merge-rescue-design.md)

**Contract:** none (single-domain operational rescue, no frontend/backend interface)

---

## Per-task conventions

**Working directory:** All artifacts live in `thoughts/shared/rescue/2026-05-10/` inside the issue-62 worktree (`/root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br`). The plan does not modify any target worktree's tracked files; it only commits/pushes inside each target worktree as needed.

**Evidence file naming:** Each repo gets `thoughts/shared/rescue/2026-05-10/<short-id>.md` where `<short-id>` is one of: `micode-issue60`, `flyauth-issue13`, `4399-issue16`, `oc-remote-issue20`, `oc-remote-issue21`, `flybuild-issue37`, `flybuild-issue40`, `flybuild-issue64`.

**Ownership preflight gate (mandatory before ANY remote mutation in a target repo):**
1. `git remote -v`
2. `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission`
3. Append both outputs verbatim to that repo's evidence file under a `## Ownership preflight` heading.
4. Classify the safe target. The plan only proceeds when origin is the user's account/org (Case A or B per global AGENTS.md). If `origin` points to upstream, or `isFork: true` with origin pointing somewhere unexpected, mark the repo `blocked-ownership` and skip remote writes for it.

**Push rule:** Only `git push origin <feature-branch>`. Never `git push upstream`, never force-push, never branch deletion on origin without explicit user OK in the same turn.

**Worktree preservation rule:** No `git worktree remove` anywhere in this plan. Worktrees survive the rescue regardless of merge outcome.

**Conflict policy:** Resolve only conflicts that are (a) small, (b) clearly mechanical (whitespace, import order, non-overlapping additions), AND (c) have an evidence-clear semantic intent. Anything else: `git merge --abort` and mark `blocked-conflict` with the conflicting file list and a one-line reason in the evidence file.

**Test/build verification:** When a project has a discoverable, scoped test or build command (`bun test`, `npm test`, `go build ./...`, etc.), run it after merge (or after dirty-commit for micode issue-60) before declaring success. Test failure → do not merge / do not push beyond the dirty-preserve commit; record the failure in the evidence file.

**No deployment, no OpenCode restart.** This is a hard environment rule.

---

## Dependency Graph

```
Batch 1 (parallel, 8 tasks): per-repo snapshot + ownership preflight [no deps]
   1.1 micode-issue60 snapshot
   1.2 flyauth-issue13 snapshot
   1.3 4399-issue16 snapshot
   1.4 oc-remote-issue20 snapshot
   1.5 oc-remote-issue21 snapshot
   1.6 flybuild-issue37 snapshot
   1.7 flybuild-issue40 snapshot
   1.8 flybuild-issue64 snapshot

Batch 2 (parallel, 1 task): preserve local-only dirty work [depends: 1.1]
   2.1 micode-issue60 dirty-work preserve

Batch 3 (parallel, 7 tasks): PR / merge / block advancement [depends: matching Batch 1 task; 3.1 also depends 2.1]
   3.1 micode-issue60 advance        [depends: 1.1, 2.1]
   3.2 flyauth-issue13 advance       [depends: 1.2]
   3.3 4399-issue16 advance PR #17   [depends: 1.3]
   3.4 oc-remote-issue20 advance     [depends: 1.4]
   3.5 oc-remote-issue21 advance     [depends: 1.5]
   3.6 flybuild-issue37 advance      [depends: 1.6]
   3.7 flybuild-issue40 advance      [depends: 1.7]
   3.8 flybuild-issue64 advance      [depends: 1.8]

Batch 4 (sequential, 1 task): outcome ledger [depends: all of Batch 3]
   4.1 outcome ledger
```

Note: Batch 3 has 8 sub-tasks (3.1-3.8). Listed as "7 advance" in shorthand because 3.1 also covers the preserved-and-advanced micode case. All 8 are independent across repos and run in parallel.

---

## Batch 1: Per-repo snapshot + ownership preflight (parallel - 8 implementers)

All tasks in this batch have NO dependencies and run simultaneously. Each task is read-only: it inspects one target worktree, runs the ownership preflight, and writes an initial evidence file. No remote mutation in this batch.

Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8

### Task 1.1: Snapshot micode issue-60 (reconcile worktree)
**File:** `thoughts/shared/rescue/2026-05-10/micode-issue60.md`
**Test:** none (operational evidence file, no behavior risk)
**Depends:** none
**Domain:** general

The "issue-60 micode" target in this rescue refers to the surviving Atlas/agents/runtime work that lives on branch `reconcile/restore-local-work-20260505` in worktree `/root/CODE/reconcile-restore-local-work-20260505`. This branch was created during the earlier reconcile step and contains the preserved Atlas/agents commits. There is no separate `issue-60-*` worktree on disk; if one appears later, treat it as a second target and add a sibling evidence file.

Run these commands and capture all stdout/stderr verbatim into the evidence file:

```bash
cd /root/CODE/reconcile-restore-local-work-20260505

# State snapshot
git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -10
git rev-parse HEAD
git rev-parse @{u} 2>/dev/null || echo "(no upstream)"

# Compare against origin default branch
git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

# Ownership preflight (mandatory, even though no mutation in this batch — record now so Batch 3 inherits the classification)
git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

# PR status for this branch
gh pr list --head reconcile/restore-local-work-20260505 --state all --json number,state,title,url | head -100
```

Evidence file template (write exactly this structure, then paste captured output under each heading):

```markdown
# micode issue-60 (reconcile worktree) snapshot

**Worktree:** /root/CODE/reconcile-restore-local-work-20260505
**Branch:** reconcile/restore-local-work-20260505
**Captured:** 2026-05-10
**Snapshot status:** captured | failed

## Branch state
(git rev-parse --abbrev-ref HEAD, git status --porcelain, git log --oneline -10, git rev-parse HEAD, upstream)

## Default-branch comparison
(default branch name, "ahead of default" log, "behind default" log)

## Ownership preflight
(git remote -v, gh repo view --json output)

**Ownership classification:** safe-origin-fork | safe-origin-own | blocked-ownership
**Reasoning:** (one sentence — must reference fork status and origin owner)

## PR status
(gh pr list output)

## Dirty-work assessment
**Has uncommitted changes:** yes | no
**Has unpushed commits ahead of origin/<branch>:** yes | no  (count)
**Has unpushed commits ahead of origin/<default>:** yes | no (count)
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
grep -q "Ownership classification:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
grep -q "Has uncommitted changes:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
```
**Commit:** `chore(lifecycle): snapshot micode issue-60 reconcile worktree (#62)`

---

### Task 1.2: Snapshot FlyAuth issue-13
**File:** `thoughts/shared/rescue/2026-05-10/flyauth-issue13.md`
**Test:** none (operational evidence file)
**Depends:** none
**Domain:** general

```bash
cd /root/CODE/issue-13-flyauth-account-blocked

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -10
git rev-parse HEAD
git rev-parse @{u} 2>/dev/null || echo "(no upstream)"

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh pr list --head issue/13-account-blocked --state all --json number,state,title,url
```

Evidence file uses the same template as Task 1.1, with the title `# FlyAuth issue-13 snapshot` and worktree/branch values updated. Add a `## Project type detection` section listing whether `package.json`, `pom.xml`, `build.gradle*`, or `go.mod` exist (used by Batch 3 to choose a verification command):

```bash
ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flyauth-issue13.md
grep -q "Ownership classification:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flyauth-issue13.md
```
**Commit:** `chore(lifecycle): snapshot FlyAuth issue-13 worktree (#62)`

---

### Task 1.3: Snapshot 4399pe-register issue-16
**File:** `thoughts/shared/rescue/2026-05-10/4399-issue16.md`
**Test:** none
**Depends:** none
**Domain:** general

```bash
cd /root/CODE/issue-16-4399-box-native-crypto

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -10
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

# PR #17 is known to exist for this branch — capture its full state
gh pr view 17 --json number,state,title,url,mergeable,mergeStateStatus,isDraft,headRefName,baseRefName,statusCheckRollup
gh pr list --head issue-16-4399-box-native-crypto --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file uses the standard snapshot template with title `# 4399pe-register issue-16 snapshot`. Add a `## Existing PR detail` heading containing the `gh pr view 17` JSON.

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/4399-issue16.md
grep -q "Existing PR detail" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/4399-issue16.md
```
**Commit:** `chore(lifecycle): snapshot 4399 issue-16 worktree and PR #17 (#62)`

---

### Task 1.4: Snapshot oc-remote issue-20
**File:** `thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md`
**Test:** none
**Depends:** none
**Domain:** general

The lifecycle issue for issue-20 is closed but feature commits exist that may not be in master. This task captures evidence to decide cherry-pick vs reopen-PR vs block in Batch 3.

```bash
cd /root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -20
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"

# Critical: which feature commits are NOT in default (these are the "unmerged commits")
git log --oneline origin/$DEFAULT..HEAD | tee /tmp/issue20-ahead.txt
echo "ahead-count: $(wc -l < /tmp/issue20-ahead.txt)"

# Per-commit, check whether the patch (by commit message + diff hash) appears in default — if yes, the commit was effectively superseded
for sha in $(git log --format=%H origin/$DEFAULT..HEAD); do
  echo "--- $sha ---"
  git show --stat --format='%s%n%h' $sha | head -20
  # Search default branch for any commit with the same subject line
  SUBJ=$(git log -1 --format=%s $sha)
  echo "matches-in-default-by-subject:"
  git log --oneline origin/$DEFAULT --grep="$(echo "$SUBJ" | sed 's/[][\/.*^$]/\\&/g')" | head -5
done

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh issue view 20 --json number,state,title,closedAt 2>/dev/null || echo "(issue 20 lookup failed)"
gh pr list --head issue/20-correct-mcp-fallback-behavior-and-perform-a-stan --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file template (extends standard template with supersession analysis):

```markdown
# oc-remote issue-20 snapshot

**Worktree:** /root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan
**Branch:** issue/20-correct-mcp-fallback-behavior-and-perform-a-stan
**Lifecycle issue state:** closed | open  (from gh issue view)

## Branch state / Default-branch comparison / Ownership preflight / PR status / Project type detection
(standard sections)

## Supersession analysis
For each unmerged feature commit, record whether default branch already carries an equivalent change (matched by commit subject grep). Format:

| SHA | Subject | Equivalent in default? | Notes |
|-----|---------|-----------------------|-------|

**Supersession verdict:** fully-superseded | partially-superseded | not-superseded | unclear
**Recommended Batch 3 action:** cherry-pick remaining commits | reopen issue + PR | block-superseded | block-unclear
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md
grep -q "Supersession verdict:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md
```
**Commit:** `chore(lifecycle): snapshot oc-remote issue-20 with supersession analysis (#62)`

---

### Task 1.5: Snapshot oc-remote issue-21
**File:** `thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md`
**Test:** none
**Depends:** none
**Domain:** general

```bash
cd /root/CODE/issue-21-align-android-mcp-panel-with-opencode-web-runtim

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -10
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh pr list --head issue/21-align-android-mcp-panel-with-opencode-web-runtim --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file uses the standard snapshot template with title `# oc-remote issue-21 snapshot`.

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md
grep -q "Ownership classification:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md
```
**Commit:** `chore(lifecycle): snapshot oc-remote issue-21 worktree (#62)`

---

### Task 1.6: Snapshot FlyBuild issue-37
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue37.md`
**Test:** none
**Depends:** none
**Domain:** general

issue-37 has a "large deletion surface" per the design open questions. Capture deletion stats explicitly so Batch 3 can decide selective merge vs. confirm vs. block.

```bash
cd /root/CODE/issue-37-worker

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -20
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

# Deletion surface: which files would this branch delete from default
git diff --name-status origin/$DEFAULT..HEAD | tee /tmp/issue37-name-status.txt
echo "delete-count: $(grep -c '^D' /tmp/issue37-name-status.txt)"
echo "modify-count: $(grep -c '^M' /tmp/issue37-name-status.txt)"
echo "add-count:    $(grep -c '^A' /tmp/issue37-name-status.txt)"
git diff --shortstat origin/$DEFAULT..HEAD

# Pull the deleted-file list for human review in evidence
grep '^D' /tmp/issue37-name-status.txt | head -100

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh pr list --head issue/37-worker --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file template extends standard with:

```markdown
## Deletion surface
**Files deleted relative to default:** N
**Files modified:** N
**Files added:** N
**Shortstat:** ...

### Deleted files (top 100)
(list)

**Deletion-surface verdict:** small-mechanical | large-but-clearly-intentional | large-and-needs-user-confirmation
**Recommended Batch 3 action:** advance-to-PR (no merge) | merge-after-user-OK | block-large-deletion
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue37.md
grep -q "Deletion-surface verdict:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue37.md
```
**Commit:** `chore(lifecycle): snapshot FlyBuild issue-37 with deletion surface (#62)`

---

### Task 1.7: Snapshot FlyBuild issue-40
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue40.md`
**Test:** none
**Depends:** none
**Domain:** general

issue-40 is "research-heavy" per the design — likely better preserved as PR than merged. Snapshot captures evidence to confirm.

```bash
cd /root/CODE/issue-40-mcp-challenge-mcauth

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -20
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

# Research heaviness: ratio of doc/research files vs code files
git diff --name-only origin/$DEFAULT..HEAD | tee /tmp/issue40-files.txt
DOCS=$(grep -cE '\.(md|txt|pdf|docx?|adoc)$|^docs/|^research/|^notes/' /tmp/issue40-files.txt)
ALL=$(wc -l < /tmp/issue40-files.txt)
echo "doc-files: $DOCS / total: $ALL"
git diff --shortstat origin/$DEFAULT..HEAD

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh pr list --head issue/40-mcp-challenge-mcauth --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file template extends standard with:

```markdown
## Research-heaviness assessment
**Doc-pattern files / total:** N / M
**Shortstat:** ...

**Heaviness verdict:** mostly-research | mixed | mostly-code
**Recommended Batch 3 action:** advance-to-PR (preserve, no merge) | merge-after-tests | block-unclear
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue40.md
grep -q "Heaviness verdict:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue40.md
```
**Commit:** `chore(lifecycle): snapshot FlyBuild issue-40 research-heavy branch (#62)`

---

### Task 1.8: Snapshot FlyBuild issue-64
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue64.md`
**Test:** none
**Depends:** none
**Domain:** general

issue-64 has "real Go protocol changes" — confirm Go is the project type and capture the change scope so Batch 3 can run `go build ./...` and `go test ./...` before merge.

```bash
cd /root/CODE/issue-64-flowers-for-machines-nemc-1-21-90

git rev-parse --abbrev-ref HEAD
git status --porcelain
git log --oneline -20
git rev-parse HEAD

git fetch origin --prune
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
echo "default-branch: $DEFAULT"
git log --oneline origin/$DEFAULT..HEAD | head -50
git log --oneline HEAD..origin/$DEFAULT | head -10

# Confirm Go project + change scope
test -f go.mod && head -5 go.mod || echo "(no go.mod)"
git diff --name-only origin/$DEFAULT..HEAD | grep '\.go$' | wc -l
git diff --shortstat origin/$DEFAULT..HEAD

git remote -v
gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission

gh pr list --head issue/64-flowers-for-machines-nemc-1-21-90 --state all --json number,state,title,url

ls package.json pom.xml build.gradle build.gradle.kts go.mod 2>/dev/null
```

Evidence file template extends standard with:

```markdown
## Go project verification
**go.mod present:** yes | no
**Module:** (first line of go.mod)
**Changed .go files:** N
**Shortstat:** ...

**Verification command for Batch 3:** `go build ./... && go test ./...` (or document substitute)
```

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue64.md
grep -q "Verification command for Batch 3:" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue64.md
```
**Commit:** `chore(lifecycle): snapshot FlyBuild issue-64 Go protocol branch (#62)`

---

## Batch 2: Preserve local-only dirty work (parallel - 1 implementer)

Only the micode reconcile/issue-60 worktree may carry dirty Atlas/agents/runtime work that would be lost. This batch protects it before any merge attempt.

Tasks: 2.1

### Task 2.1: Preserve micode issue-60 dirty Atlas/agents/runtime work
**File:** `thoughts/shared/rescue/2026-05-10/micode-issue60.md` (append-only — adds a `## Preservation` section)
**Test:** none (operational; behavior risk is captured by the post-commit test run, see below)
**Depends:** 1.1
**Domain:** general

This task ONLY commits and pushes work that already exists on disk in the reconcile worktree. It does NOT create new code. If Task 1.1's evidence shows "Has uncommitted changes: no" AND "Has unpushed commits ahead of origin/<branch>: no", this task records that fact and exits without pushing.

**Procedure (read evidence file first; act only on what it says):**

1. Read the existing evidence file. Extract:
   - Ownership classification (must be `safe-origin-fork` or `safe-origin-own`; if `blocked-ownership`, append `## Preservation` with status `skipped-ownership` and STOP this task).
   - "Has uncommitted changes" flag.
   - "Has unpushed commits ahead of origin/<branch>" flag and count.

2. If ownership is safe AND uncommitted changes = yes:
   ```bash
   cd /root/CODE/reconcile-restore-local-work-20260505
   git status --porcelain  # capture for evidence
   git add -A
   # Commit message must group by surface: Atlas, agents, runtime
   git commit -m "chore(reconcile): preserve dirty Atlas/agents/runtime work

Preserves uncommitted local-only work from the reconcile worktree
before lifecycle merge rescue. Surfaces touched: see git show HEAD.

Refs: micode#62 worktree merge rescue."
   git rev-parse HEAD  # capture new commit SHA
   ```

3. If ownership is safe AND there are commits ahead of `origin/reconcile/restore-local-work-20260505` (either pre-existing or just-created):
   ```bash
   cd /root/CODE/reconcile-restore-local-work-20260505
   git push origin reconcile/restore-local-work-20260505
   git rev-parse @{u}  # confirm push landed
   ```

4. Run the project's scoped test suite to verify the preserved state still works. micode is a Bun/TypeScript project — use `bun test` if available; fall back to `npm test`. Capture full output.

   ```bash
   cd /root/CODE/reconcile-restore-local-work-20260505
   if command -v bun >/dev/null 2>&1 && [ -f package.json ]; then
     bun test 2>&1 | tail -100
   elif [ -f package.json ]; then
     npm test 2>&1 | tail -100
   else
     echo "(no scoped test command discoverable)"
   fi
   ```

5. Append to the evidence file (do not overwrite earlier sections):

   ```markdown
   ## Preservation
   **Action taken:** committed-and-pushed | already-clean-and-pushed | committed-only-push-failed | skipped-ownership | skipped-no-changes
   **New commit SHA (if any):** <sha>
   **Push result:** ok | failed: <reason> | n/a
   **Test command run:** bun test | npm test | none
   **Test result:** pass | fail (count) | not-run
   **Test summary (last 30 lines):**
   ```
   (paste captured tail)
   ```
   ```

**Critical gating rule for Batch 3:** If the test run in step 4 fails, set the evidence file's "Recommended Batch 3 action" to `block-tests-failed` and Task 3.1 will NOT attempt a merge or PR. The preserved push remains; nothing else changes.

**Verify:**
```bash
grep -q "## Preservation" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
grep -qE "Action taken: (committed-and-pushed|already-clean-and-pushed|committed-only-push-failed|skipped-ownership|skipped-no-changes)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
# If action was committed-and-pushed, verify branch tip matches origin
cd /root/CODE/reconcile-restore-local-work-20260505 && [ "$(git rev-parse HEAD)" = "$(git rev-parse @{u} 2>/dev/null || echo nope)" ] || echo "(push pending or skipped — see evidence)"
```
**Commit:** `chore(lifecycle): record micode issue-60 preservation outcome (#62)` (commit covers the evidence-file update inside the issue-62 worktree, NOT the inner reconcile worktree's own commit which is its own push)

---

## Batch 3: PR / merge / block advancement (parallel - 8 implementers)

All tasks in this batch depend on their matching Batch 1 snapshot (and 3.1 also depends on Batch 2). Each task advances exactly one repo: create or reuse PR, attempt safe merge if appropriate, or mark blocked with evidence. All remote writes are origin-only and gated by the ownership preflight result from Batch 1.

Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8

### Task 3.1: Advance micode issue-60 (reconcile branch) toward main
**File:** `thoughts/shared/rescue/2026-05-10/micode-issue60.md` (append-only — adds `## Advancement`)
**Test:** none (advancement is observed via PR state / merge state captured in evidence)
**Depends:** 1.1, 2.1
**Domain:** general

**Read gating fields from the evidence file first.** Stop and append `## Advancement` with status `blocked-<reason>` if any of:
- Ownership classification is `blocked-ownership`.
- Preservation step recorded `committed-only-push-failed`.
- Preservation test result is `fail`.
- Preservation recommendation is `block-tests-failed`.

Otherwise:

1. Re-confirm the branch is fully pushed (defense-in-depth — Task 2.1 should have done this):
   ```bash
   cd /root/CODE/reconcile-restore-local-work-20260505
   git fetch origin
   [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/reconcile/restore-local-work-20260505)" ] && echo "in-sync" || echo "OUT-OF-SYNC"
   ```
   If out of sync, mark `blocked-out-of-sync` and stop.

2. Check whether a PR already exists for this branch:
   ```bash
   gh pr list --head reconcile/restore-local-work-20260505 --state all --json number,state,title,url
   ```

3. If no PR exists, create one targeting the default branch:
   ```bash
   gh pr create \
     --base main \
     --head reconcile/restore-local-work-20260505 \
     --title "Preserve reconcile Atlas/agents/runtime work" \
     --body "Preserves the local-only Atlas/agents/runtime work captured during the 2026-05-05 reconcile step. Part of issue #62 worktree merge rescue. Tests: see thoughts/shared/rescue/2026-05-10/micode-issue60.md." \
     --draft
   ```
   Capture the new PR URL.

4. Do NOT attempt a programmatic merge in this task. micode is workflow-sensitive (agent prompts, Atlas wiring); merge requires human review. Leave the PR in draft state.

5. Append to evidence file:
   ```markdown
   ## Advancement
   **Action taken:** pr-created-draft | pr-already-exists | blocked-<reason>
   **PR URL:** <url> | n/a
   **Final branch state:** preserved-with-pr | preserved-no-pr | blocked
   ```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
grep -qE "Final branch state: (preserved-with-pr|preserved-no-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/micode-issue60.md
```
**Commit:** `chore(lifecycle): advance micode issue-60 reconcile branch (#62)`

---

### Task 3.2: Advance FlyAuth issue-13
**File:** `thoughts/shared/rescue/2026-05-10/flyauth-issue13.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.2
**Domain:** general

Read gating fields from evidence file. If ownership is `blocked-ownership`, mark `blocked-ownership` and stop.

1. Confirm branch pushed and in sync:
   ```bash
   cd /root/CODE/issue-13-flyauth-account-blocked
   git fetch origin
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH 2>/dev/null)" ] && echo "in-sync" || { echo "OUT-OF-SYNC"; git push origin $BRANCH; }
   ```

2. Check for existing PR. If none, create one:
   ```bash
   DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   gh pr list --head $BRANCH --state all --json number,state,title,url
   # If no open PR:
   gh pr create \
     --base "$DEFAULT" \
     --head "$BRANCH" \
     --title "Handle account-blocked auth flow" \
     --body "Preserves account-blocked handling work from lifecycle issue #13. Part of micode#62 worktree merge rescue. Review and merge when ready."
   ```

3. After PR creation, attempt a safe merge ONLY if all of:
   - PR is mergeable (`gh pr view <n> --json mergeable,mergeStateStatus` shows `MERGEABLE` and `CLEAN` or `UNSTABLE` with passing required checks)
   - Project verification passes. Pick command by project type detection from snapshot:
     - If `package.json`: `npm test` or `npm run build` (whichever exists; check `jq -r '.scripts.test // empty' package.json` first).
     - If `pom.xml`: `mvn -B -q -DskipTests=false test` (or `mvn -B -q verify` if test stage is heavy and slow — record which was run).
     - If `build.gradle*`: `./gradlew test` (or `gradle test`).
     - If `go.mod`: `go build ./... && go test ./...`.
     - If none discoverable: skip verification, do NOT merge, leave PR open.
   - If verification passes, merge via PR using squash:
     ```bash
     gh pr merge <PR_NUMBER> --squash --delete-branch=false
     ```
     Note: `--delete-branch=false` is mandatory. Plan-level rule: do not delete branches on origin.

4. If PR is not mergeable due to conflicts, do NOT auto-resolve unless the conflict is small/mechanical per the conflict policy. Default action: leave PR open, mark `blocked-conflict` with conflicting-file list.

5. Append to evidence:
   ```markdown
   ## Advancement
   **Action taken:** pr-created-and-merged | pr-created-pending-review | pr-already-exists | blocked-<reason>
   **PR URL:** <url>
   **Verification command:** <cmd>
   **Verification result:** pass | fail | not-run
   **Final branch state:** merged | open-pr | blocked
   ```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flyauth-issue13.md
grep -qE "Final branch state: (merged|open-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flyauth-issue13.md
```
**Commit:** `chore(lifecycle): advance FlyAuth issue-13 (#62)`

---

### Task 3.3: Advance 4399 issue-16 (PR #17 already exists)
**File:** `thoughts/shared/rescue/2026-05-10/4399-issue16.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.3
**Domain:** general

Read gating fields. If ownership is `blocked-ownership`, mark and stop.

PR #17 already exists. This task's job is to inspect, advance, and (if safe) merge it. Do NOT create a duplicate PR.

1. Refresh PR state:
   ```bash
   cd /root/CODE/issue-16-4399-box-native-crypto
   git fetch origin
   gh pr view 17 --json number,state,title,url,mergeable,mergeStateStatus,isDraft,headRefName,baseRefName,statusCheckRollup
   ```

2. Decide path by PR state:
   - `state: MERGED` → record as already-merged, set `Final branch state: already-merged`, stop.
   - `state: CLOSED` (not merged) → mark `blocked-pr-closed`, stop. Do not reopen automatically.
   - `state: OPEN, isDraft: true` → mark ready: `gh pr ready 17`. Then continue.
   - `state: OPEN, isDraft: false` → continue.

3. If branch is behind base, update via merge (NOT rebase, to preserve commit identity that may already be reviewed):
   ```bash
   gh pr update-branch 17 || git fetch origin && git merge --no-ff origin/$(gh pr view 17 --json baseRefName --jq .baseRefName)
   # If merge has conflicts: apply conflict policy (small/mechanical only); otherwise abort and mark blocked-conflict
   ```

4. Run project verification (same selection rule as Task 3.2). If `package.json`:
   ```bash
   jq -r '.scripts.test // empty' package.json
   jq -r '.scripts.build // empty' package.json
   # Pick test if exists, else build, else skip
   ```

5. If `mergeable: MERGEABLE` AND verification passes:
   ```bash
   gh pr merge 17 --squash --delete-branch=false
   ```
   If verification fails or PR has unresolved conflicts → leave PR open, mark `blocked-tests` or `blocked-conflict`.

6. Append to evidence:
   ```markdown
   ## Advancement
   **PR #17 final state:** merged | open-ready | open-draft | blocked-<reason>
   **Action taken:** marked-ready-and-merged | merged-as-is | left-open-for-review | blocked-<reason>
   **Verification command:** <cmd>
   **Verification result:** pass | fail | not-run
   **Final branch state:** merged | open-pr | blocked
   ```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/4399-issue16.md
grep -qE "Final branch state: (merged|open-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/4399-issue16.md
```
**Commit:** `chore(lifecycle): advance 4399 issue-16 PR #17 (#62)`

---

### Task 3.4: Advance oc-remote issue-20 (closed issue, possibly superseded)
**File:** `thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.4
**Domain:** general

Read gating fields. If ownership is `blocked-ownership`, mark and stop.

Branch by Task 1.4's `Supersession verdict`:

| Supersession verdict | Action |
|---|---|
| `fully-superseded` | Mark `blocked-superseded`. Append note that the unmerged commits are equivalent to commits already in default; no advancement needed. Stop. |
| `not-superseded` | Treat like an issue-21-style "pushed, no PR" case: create PR, run verification, merge if safe. The closed lifecycle issue is informational, not blocking. |
| `partially-superseded` | Cherry-pick the not-yet-in-default commits into a fresh feature branch off current default, push, open PR. Do NOT merge automatically — defer to human. |
| `unclear` | Mark `blocked-unclear`. Append the per-commit supersession table for human review. Do not push or create PR. |

Detailed flow for each case:

**not-superseded path:**
```bash
cd /root/CODE/issue-20-correct-mcp-fallback-behavior-and-perform-a-stan
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH 2>/dev/null)" ] || git push origin $BRANCH
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
gh pr list --head "$BRANCH" --state all
# If no open PR:
gh pr create --base "$DEFAULT" --head "$BRANCH" \
  --title "MCP fallback behavior fixes (recovered from closed issue-20)" \
  --body "Recovers feature work from closed lifecycle issue #20 that was never merged into $DEFAULT. Part of micode#62 rescue. Closed-issue context: see snapshot in thoughts/shared/rescue/."
# Then: verification + safe merge per Task 3.2 step 3 / step 5 rules.
```

**partially-superseded path:**
```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git fetch origin
git checkout -b rescue/issue-20-recovered-$(date +%Y%m%d) origin/$DEFAULT
# Cherry-pick only the commits Task 1.4 listed as "not in default" (read from evidence file's Supersession analysis table)
for sha in <list-from-evidence>; do git cherry-pick $sha; done
git push origin rescue/issue-20-recovered-$(date +%Y%m%d)
gh pr create --base "$DEFAULT" --head "rescue/issue-20-recovered-$(date +%Y%m%d)" \
  --title "Recover non-superseded commits from issue-20" \
  --body "Cherry-picks commits from issue/20 branch that are not yet in $DEFAULT. Defer merge to human review. Part of micode#62 rescue."
# Do NOT merge; leave for human.
```

Append to evidence:
```markdown
## Advancement
**Branch path taken:** fully-superseded | not-superseded | partially-superseded | unclear
**New rescue branch (if cherry-picked):** <name> | n/a
**PR URL:** <url> | n/a
**Verification result:** pass | fail | not-run | n/a
**Final branch state:** already-in-default | merged | open-pr | open-rescue-pr | blocked-<reason>
```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md
grep -qE "Final branch state: (already-in-default|merged|open-pr|open-rescue-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue20.md
```
**Commit:** `chore(lifecycle): advance oc-remote issue-20 with supersession-aware path (#62)`

---

### Task 3.5: Advance oc-remote issue-21
**File:** `thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.5
**Domain:** general

Same shape as Task 3.2:
1. Read gating fields; stop on `blocked-ownership`.
2. Confirm branch pushed and in sync (push if not).
3. Check existing PR; if none, create one targeting default:
   ```bash
   cd /root/CODE/issue-21-align-android-mcp-panel-with-opencode-web-runtim
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   gh pr create --base "$DEFAULT" --head "$BRANCH" \
     --title "Align Android MCP panel with OpenCode web runtime" \
     --body "Recovers lifecycle issue #21 work that was pushed but never PR'd. Part of micode#62 rescue."
   ```
4. Run project verification per Task 3.2 step 3.
5. If `MERGEABLE` and verification passes: `gh pr merge <n> --squash --delete-branch=false`. Otherwise leave PR open with status.

Append `## Advancement` with same fields as Task 3.2.

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md
grep -qE "Final branch state: (merged|open-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/oc-remote-issue21.md
```
**Commit:** `chore(lifecycle): advance oc-remote issue-21 (#62)`

---

### Task 3.6: Advance FlyBuild issue-37 (large deletion surface — cautious)
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue37.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.6
**Domain:** general

Read gating fields. If ownership is `blocked-ownership`, mark and stop.

Branch by Task 1.6's `Deletion-surface verdict`:

| Verdict | Action |
|---|---|
| `small-mechanical` | Treat like Task 3.2: ensure pushed, create PR if missing, run verification, merge if safe. |
| `large-but-clearly-intentional` | Ensure pushed, create PR (or reuse), do NOT auto-merge even if green. Leave for human review. |
| `large-and-needs-user-confirmation` | Ensure pushed, create PR with body that explicitly lists deletion stats and the deleted-file list, mark `Final branch state: open-pr-needs-user-decision`. Do not merge. |

In ALL cases, the PR body MUST include the deletion shortstat and the count of deleted files, copied from the snapshot. This makes the human review trivially auditable.

```bash
cd /root/CODE/issue-37-worker
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH 2>/dev/null)" ] || git push origin $BRANCH
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
gh pr list --head "$BRANCH" --state all
# If no open PR:
gh pr create --base "$DEFAULT" --head "$BRANCH" \
  --title "FlyBuild worker changes (issue-37)" \
  --body "$(cat <<EOF
Recovers lifecycle issue #37 worker work. Part of micode#62 rescue.

**Deletion surface (from snapshot):**
- Files deleted: <N>
- Files modified: <N>
- Files added: <N>

This branch's deletion verdict is **<verdict>**. See thoughts/shared/rescue/2026-05-10/flybuild-issue37.md for the full deleted-file list and reasoning. Merge requires explicit human confirmation of the deletion intent.
EOF
)"
```

Append to evidence:
```markdown
## Advancement
**Deletion verdict applied:** small-mechanical | large-but-clearly-intentional | large-and-needs-user-confirmation
**Action taken:** pr-created-and-merged | pr-created-pending-human | blocked-<reason>
**PR URL:** <url>
**Final branch state:** merged | open-pr | open-pr-needs-user-decision | blocked
```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue37.md
grep -qE "Final branch state: (merged|open-pr|open-pr-needs-user-decision|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue37.md
```
**Commit:** `chore(lifecycle): advance FlyBuild issue-37 with cautious deletion handling (#62)`

---

### Task 3.7: Advance FlyBuild issue-40 (research-heavy — preserve as PR)
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue40.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.7
**Domain:** general

Read gating fields. If ownership is `blocked-ownership`, mark and stop.

Default action: **PR-only, do NOT merge.** Branch by Task 1.7's `Heaviness verdict`:

| Verdict | Action |
|---|---|
| `mostly-research` | Push (if not already), create PR with `--draft`, mark for human review. Do NOT merge. |
| `mixed` | Push, create PR (non-draft), run verification but DO NOT auto-merge. Leave for human. |
| `mostly-code` | Treat like Task 3.2: PR + verification + safe merge. |

```bash
cd /root/CODE/issue-40-mcp-challenge-mcauth
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git fetch origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/$BRANCH 2>/dev/null)" ] || git push origin $BRANCH
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
gh pr list --head "$BRANCH" --state all
# If no open PR (adjust --draft per verdict):
gh pr create --base "$DEFAULT" --head "$BRANCH" \
  --title "MCP challenge mcauth research (issue-40)" \
  --body "Preserves research-heavy work from lifecycle issue #40. Part of micode#62 rescue. Default: preserve as PR rather than merge — see thoughts/shared/rescue/2026-05-10/flybuild-issue40.md for heaviness assessment." \
  $([ "<verdict>" = "mostly-research" ] && echo "--draft")
```

Append to evidence:
```markdown
## Advancement
**Heaviness verdict applied:** mostly-research | mixed | mostly-code
**Action taken:** pr-created-draft | pr-created-pending-human | pr-created-and-merged | blocked-<reason>
**PR URL:** <url>
**Verification result:** pass | fail | not-run | n/a
**Final branch state:** merged | open-pr-draft | open-pr | blocked
```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue40.md
grep -qE "Final branch state: (merged|open-pr-draft|open-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue40.md
```
**Commit:** `chore(lifecycle): advance FlyBuild issue-40 research-heavy branch as preserved PR (#62)`

---

### Task 3.8: Advance FlyBuild issue-64 (Go protocol changes)
**File:** `thoughts/shared/rescue/2026-05-10/flybuild-issue64.md` (append `## Advancement`)
**Test:** none
**Depends:** 1.8
**Domain:** general

Read gating fields. If ownership is `blocked-ownership`, mark and stop.

This is the cleanest "real-code, run-tests, merge-if-green" case. The Go protocol changes deserve a real verification gate.

1. Confirm branch pushed and in sync.
2. Check existing PR; create if missing:
   ```bash
   cd /root/CODE/issue-64-flowers-for-machines-nemc-1-21-90
   BRANCH=$(git rev-parse --abbrev-ref HEAD)
   DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   gh pr list --head "$BRANCH" --state all
   gh pr create --base "$DEFAULT" --head "$BRANCH" \
     --title "Flowers-for-machines NEMC 1.21.90 protocol updates (issue-64)" \
     --body "Recovers lifecycle issue #64 Go protocol changes. Part of micode#62 rescue. Verified via 'go build ./... && go test ./...' before merge."
   ```

3. Verification:
   ```bash
   go build ./... 2>&1 | tee /tmp/issue64-build.txt
   go test ./... 2>&1 | tee /tmp/issue64-test.txt
   ```
   - If build fails: do NOT merge. Mark `blocked-build`.
   - If tests fail: do NOT merge. Mark `blocked-tests`. Leave PR open.
   - If both pass: continue.

4. If PR `mergeable: MERGEABLE` AND verification passed:
   ```bash
   gh pr merge <n> --squash --delete-branch=false
   ```

5. Append to evidence:
   ```markdown
   ## Advancement
   **PR URL:** <url>
   **go build result:** pass | fail
   **go test result:** pass | fail (count)
   **Action taken:** pr-created-and-merged | pr-created-pending-review | blocked-<reason>
   **Final branch state:** merged | open-pr | blocked
   ```

**Verify:**
```bash
grep -q "## Advancement" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue64.md
grep -qE "Final branch state: (merged|open-pr|blocked)" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/flybuild-issue64.md
```
**Commit:** `chore(lifecycle): advance FlyBuild issue-64 Go protocol branch (#62)`

---

## Batch 4: Outcome ledger (sequential - 1 implementer)

Aggregates all per-repo evidence files into a single rescue outcome ledger and updates lifecycle issue #62 with the summary.

Tasks: 4.1

### Task 4.1: Outcome ledger and lifecycle issue update
**File:** `thoughts/shared/rescue/2026-05-10/OUTCOME.md`
**Test:** none (synthesis document)
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
**Domain:** general

Aggregate every per-repo evidence file into a single ledger and post a summary comment to lifecycle issue #62 so cross-conversation observers can see the result without opening eight files.

1. Build the ledger by reading every `thoughts/shared/rescue/2026-05-10/<repo>.md` file's `## Advancement` section.

2. Write `thoughts/shared/rescue/2026-05-10/OUTCOME.md` with this exact template:

```markdown
# Worktree merge rescue — 2026-05-10 outcome ledger

**Lifecycle issue:** #62
**Coordinator worktree:** /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br
**Run date:** 2026-05-10

## Summary

| Repo | Issue | Branch | Final state | PR | Notes |
|------|-------|--------|-------------|----|----|
| micode | 60 (reconcile) | reconcile/restore-local-work-20260505 | <state> | <url> | <one-line> |
| FlyAuth | 13 | issue/13-account-blocked | <state> | <url> | <one-line> |
| 4399pe-register | 16 | issue-16-4399-box-native-crypto | <state> | #17 | <one-line> |
| oc-remote | 20 | issue/20-correct-mcp-fallback-... | <state> | <url> | <one-line> |
| oc-remote | 21 | issue/21-align-android-mcp-... | <state> | <url> | <one-line> |
| FlyBuild | 37 | issue/37-worker | <state> | <url> | <one-line> |
| FlyBuild | 40 | issue/40-mcp-challenge-mcauth | <state> | <url> | <one-line> |
| FlyBuild | 64 | issue/64-flowers-for-machines-... | <state> | <url> | <one-line> |

## Counts
- Merged: <n>
- Open PR (pending human): <n>
- Blocked: <n>
- Already-in-default / superseded: <n>

## Worktrees retained (NONE deleted per plan rule)
(list of all eight worktree paths)

## Blocked entries (need human follow-up)
For each blocked repo:
### <repo>/<issue>
- Reason: <ownership | conflict | tests | build | superseded | unclear | out-of-sync | other>
- Evidence: thoughts/shared/rescue/2026-05-10/<file>.md
- Suggested next step: <one sentence>

## Verification commands run per repo
| Repo | Command | Result |
|------|---------|--------|
| ... | ... | pass / fail / not-run |
```

3. Post a summary comment on lifecycle issue #62 with the same Summary table (compressed to fit GitHub's comment size). Use `lifecycle_log_progress` if available; otherwise `gh issue comment 62 --body-file <tmp>`.

4. Call `lifecycle_log_progress(kind=status, summary="rescue complete: <m> merged, <p> PR open, <b> blocked")` and `lifecycle_log_progress(kind=handoff, summary="see thoughts/shared/rescue/2026-05-10/OUTCOME.md and per-repo evidence files")`.

5. Do NOT call `lifecycle_finish`. Issue #62 stays open until the user reviews blocked entries.

**Verify:**
```bash
test -f /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/OUTCOME.md
grep -q "## Summary" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/OUTCOME.md
grep -q "## Blocked entries" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/OUTCOME.md
# Confirm every per-repo evidence file is referenced
for f in micode-issue60 flyauth-issue13 4399-issue16 oc-remote-issue20 oc-remote-issue21 flybuild-issue37 flybuild-issue40 flybuild-issue64; do
  grep -q "$f" /root/CODE/issue-62-rescue-and-merge-incomplete-lifecycle-feature-br/thoughts/shared/rescue/2026-05-10/OUTCOME.md || echo "MISSING: $f"
done
```
**Commit:** `chore(lifecycle): record worktree-merge-rescue outcome ledger (#62)`
