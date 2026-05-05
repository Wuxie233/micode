---
date: 2026-05-05
topic: "atlas autopush after auto-commit"
contract: none
---

# Atlas Auto-Push Implementation Plan

**Goal:** Make `/atlas-init` and `/atlas-translate` push the freshly created atlas-only commit to `origin` automatically, while preserving the existing safety gates (atlas-only validation, no upstream, no amend, no retry).

**Architecture:** Both atlas agent prompts already contain an `<auto-commit>` block whose final step is `git commit`. We extend that block with a new step 6 (`git push origin HEAD`), keep all existing safety gates intact, and add explicit Chinese-friendly fallback wording so a push failure leaves the local commit intact and surfaces a clear next action. No new helpers are added: `git push origin HEAD` is sufficient and matches the AGENTS policy that pushes go to fork `origin` only.

**Design:** No design doc; this is a minimal prompt-and-test fix. Source spec is the bug report from the user.

**Contract:** none (single-domain, prompt-text only).

---

## Gap-filling decisions (planner)

- **Push command:** `git push origin HEAD`. This pushes the current HEAD to its tracking branch on `origin` without naming `main` explicitly, so it works on any branch the user runs `/atlas-init` from. AGENTS policy already restricts `origin` to the user's fork.
- **No `--force` and no upstream-set:** never `--force`, never `--set-upstream`. If the branch has no upstream, the push fails and we report the failure. We do not auto-create remote branches.
- **Skip-push conditions:** if step 1 reports `no atlas changes` (no commit was created) OR if any earlier step aborted (validation failure, commit failure), do NOT run `git push`. Report the same way the existing block does.
- **Push failure wording:** if `git push origin HEAD` exits non-zero, append the error to the maintenance log and report exactly: `commit <sha> retained locally; push failed: <one-line stderr>. Run \`git push origin HEAD\` manually to retry.` This satisfies the user requirement that the retained local commit and exact next action are surfaced.
- **Output line replacement:** the current closing sentence "当前工作树干净，未 push。" is produced by whatever wraps the agent run; we don't grep for it. The fix is to make the agent actually push, so on success the agent reports `pushed <sha> to origin/<branch>`. The wrapper's stale "未 push" line is no longer reachable when the new step succeeds, and the user-visible final summary becomes accurate.
- **Helper file (`src/atlas/git.ts`):** untouched. It only builds commit messages; push is a single one-line shell command and does not warrant a new helper.
- **Deploy note:** runtime is `/root/.micode`. After this lands in `/root/CODE/micode`, run `bun run deploy:runtime` and ASK the user before any OpenCode restart, per `runtime-core.md`.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [prompt edits - no deps between agents]
Batch 2 (parallel): 2.1, 2.2 [test updates - depend on batch 1 prompt strings]
```

---

## Batch 1: Prompt Edits (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Add auto-push step to atlas-initializer prompt
**File:** `src/agents/atlas-initializer.ts`
**Test:** `tests/agents/atlas-initializer.test.ts` (asserted in Task 2.1)
**Depends:** none
**Domain:** general

Edit the existing `<auto-commit>` block. Keep steps 1-5 unchanged. After step 5, insert a new step 6 and update the closing paragraph so push failures are documented but never trigger amend or retry.

Use Edit on `src/agents/atlas-initializer.ts`. Replace the existing closing block of `<auto-commit>` (the `<step number="5">...</step>` block plus the trailing paragraph that begins with `Do NOT push.`) with:

```text
    <step number="5">
      Run \`git commit -m "<message>"\`. Capture the new commit SHA from \`git rev-parse HEAD\`.
    </step>
    <step number="6">
      Run \`git push origin HEAD\`. This pushes the freshly created atlas-only commit to the
      \`origin\` remote (the user's fork; never upstream). Do NOT pass \`--force\`, do NOT pass
      \`--set-upstream\`, do NOT push any other ref.

      On success, append \`pushed <sha> to origin/<branch>\` to the maintenance log and report
      the same one-line summary.

      On failure (non-zero exit), append the failure to the maintenance log and report exactly:
      \`commit <sha> retained locally; push failed: <one-line stderr>. Run \\\`git push origin HEAD\\\` manually to retry.\`
      The local commit MUST stay; do NOT amend, do NOT reset, do NOT retry automatically.

      Skip this step entirely if step 1 reported \`no atlas changes\` or any earlier step
      aborted: there is no commit to push.
    </step>

    Push only to \`origin\`, never to \`upstream\` or any other remote. Do NOT amend. Do NOT
    touch other branches. On any git command failure (commit OR push), append the failure to
    the maintenance log and report one sentence. Do not retry automatically.
```

The TDD shape applies (test in Task 2.1 will assert the new strings); this task is a string edit only and the new behavior is observed indirectly through the prompt assertions.

**Verify:** `bun run typecheck` (no runtime change, just a string constant)
**Commit:** `feat(atlas): atlas-initializer auto-pushes commit to origin after init`

### Task 1.2: Add auto-push step to atlas-translator prompt
**File:** `src/agents/atlas-translator.ts`
**Test:** `tests/agents/atlas-translator.test.ts` (asserted in Task 2.2)
**Depends:** none
**Domain:** general

Mirror Task 1.1 in `src/agents/atlas-translator.ts`. The existing translator `<auto-commit>` block ends at `<step number="5">` (commit) followed by `Do NOT push. Do NOT amend. ...`.

Use Edit on `src/agents/atlas-translator.ts`. Replace the existing closing block of `<auto-commit>` (the `<step number="5">...</step>` block plus the trailing paragraph that begins with `Do NOT push.`) with:

```text
    <step number="5">
      Run \`git commit -m "<message>"\`. Capture the new commit SHA from \`git rev-parse HEAD\`.
    </step>
    <step number="6">
      Run \`git push origin HEAD\`. This pushes the freshly created atlas-only commit to the
      \`origin\` remote (the user's fork; never upstream). Do NOT pass \`--force\`, do NOT pass
      \`--set-upstream\`, do NOT push any other ref.

      On success, append \`pushed <sha> to origin/<branch>\` to the maintenance log and report
      the same one-line summary.

      On failure (non-zero exit), append the failure to the maintenance log and report exactly:
      \`commit <sha> retained locally; push failed: <one-line stderr>. Run \\\`git push origin HEAD\\\` manually to retry.\`
      The local commit MUST stay; do NOT amend, do NOT reset, do NOT retry automatically.

      Skip this step entirely if step 1 reported \`no atlas changes\` or any earlier step
      aborted: there is no commit to push.
    </step>

    Push only to \`origin\`, never to \`upstream\` or any other remote. Do NOT amend. Do NOT
    touch other branches. On any git command failure (commit OR push), append the failure to
    the maintenance log and report one sentence. Do not retry automatically.
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): atlas-translator auto-pushes commit to origin after translate`

---

## Batch 2: Test Assertions (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 (the prompt strings they assert against).
Tasks: 2.1, 2.2

### Task 2.1: Update atlas-initializer test for auto-push assertions
**File:** `tests/agents/atlas-initializer.test.ts`
**Test:** self (this IS the test file)
**Depends:** 1.1
**Domain:** general

The existing test currently asserts `expect(p.toLowerCase()).toContain("do not push");`. That assertion is now wrong (we DO push). Replace it with assertions that the prompt requires auto-push to `origin` with the documented safety gates.

Use Edit on `tests/agents/atlas-initializer.test.ts`. Replace the body of the existing `it("instructs atlas-only auto-commit after a successful run", ...)` block (lines 70-82) with the following test body, and add a NEW `it(...)` block immediately after it for push-failure handling:

```typescript
  it("instructs atlas-only auto-commit after a successful run", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("<auto-commit>");
    expect(p).toContain("git status --porcelain");
    expect(p).toContain("no atlas changes");
    expect(p).toContain("git add atlas/");
    expect(p).toContain("git diff --cached --name-only");
    expect(p).toContain("validateStagedPaths");
    expect(p).toContain("buildAtlasInitCommitSummary");
    expect(p).toContain("atlas: init vault (run <runId>)");
    expect(p).toContain('git commit -m "<message>"');
  });

  it("auto-pushes the atlas-only commit to origin", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("git push origin HEAD");
    expect(p).toContain("origin");
    expect(p).toContain("pushed <sha> to origin/<branch>");
    // Safety gates: no force, no upstream-set, no upstream-remote push
    expect(p).toContain("--force");
    expect(p.toLowerCase()).toContain("do not pass `--force`");
    expect(p.toLowerCase()).toContain("never to `upstream`");
  });

  it("retains the local commit and surfaces next action when push fails", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("retained locally");
    expect(p).toContain("push failed");
    expect(p.toLowerCase()).toContain("do not amend");
    expect(p.toLowerCase()).toContain("do not retry automatically");
    expect(p.toLowerCase()).toContain("manually to retry");
  });

  it("skips push when no commit was created", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("Skip this step entirely");
    expect(p).toContain("no atlas changes");
  });
```

Run `bun test tests/agents/atlas-initializer.test.ts` and confirm all assertions pass against the prompt edited in Task 1.1. If any string was edited slightly differently in 1.1, align here (these strings are the contract between 1.1 and 2.1).

**Verify:** `bun test tests/agents/atlas-initializer.test.ts`
**Commit:** `test(atlas): atlas-initializer asserts auto-push and push-failure recovery`

### Task 2.2: Update atlas-translator test for auto-push assertions
**File:** `tests/agents/atlas-translator.test.ts`
**Test:** self
**Depends:** 1.2
**Domain:** general

Mirror Task 2.1 in `tests/agents/atlas-translator.test.ts`. The existing translator test asserts `expect(p.toLowerCase()).toContain("do not push");` (line 43) — that line is now wrong.

Use Edit on `tests/agents/atlas-translator.test.ts`. Replace the body of `it("instructs atlas-only auto-commit after a successful run", ...)` (lines 32-44) with the body below, and add new push-related `it(...)` blocks immediately after it:

```typescript
  it("instructs atlas-only auto-commit after a successful run", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("<auto-commit>");
    expect(p).toContain("git status --porcelain");
    expect(p).toContain("no atlas changes");
    expect(p).toContain("git add atlas/");
    expect(p).toContain("git diff --cached --name-only");
    expect(p).toContain("validateStagedPaths");
    expect(p).toContain("buildAtlasTranslateCommitSummary");
    expect(p).toContain("atlas: translate <targetPath> (run <runId>)");
    expect(p).toContain('git commit -m "<message>"');
  });

  it("auto-pushes the atlas-only commit to origin", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("git push origin HEAD");
    expect(p).toContain("origin");
    expect(p).toContain("pushed <sha> to origin/<branch>");
    expect(p).toContain("--force");
    expect(p.toLowerCase()).toContain("do not pass `--force`");
    expect(p.toLowerCase()).toContain("never to `upstream`");
  });

  it("retains the local commit and surfaces next action when push fails", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("retained locally");
    expect(p).toContain("push failed");
    expect(p.toLowerCase()).toContain("do not amend");
    expect(p.toLowerCase()).toContain("do not retry automatically");
    expect(p.toLowerCase()).toContain("manually to retry");
  });

  it("skips push when no commit was created", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("Skip this step entirely");
    expect(p).toContain("no atlas changes");
  });
```

**Verify:** `bun test tests/agents/atlas-translator.test.ts`
**Commit:** `test(atlas): atlas-translator asserts auto-push and push-failure recovery`

---

## Post-batch deploy note

After both batches pass `bun run check`, deploy to the live runtime so `/atlas-init` and `/atlas-translate` actually pick up the new behavior:

```sh
bun run deploy:runtime
```

The helper preserves `node_modules`, `.git`, `thoughts`, and env files. It does NOT restart OpenCode. After it prints `Runtime ready. Restart of OpenCode requires explicit user approval.`, ASK the user before running any restart command. Per `runtime-core.md`, never restart unilaterally.
