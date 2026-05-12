---
date: 2026-05-12
topic: "Autonomous Lifecycle Recovery for Finish / Commit / Merge"
issue: 67
scope: lifecycle
contract: none
---

# Autonomous Lifecycle Recovery Implementation Plan

**Goal:** Make `lifecycle_finish` / `lifecycle_commit` / `lifecycle_current` emit structured recovery hints and let primary agents run a bounded (max 3) recovery loop instead of halting on the first failure, while preserving all safety boundaries (no force push, no destructive reset, no deletion of user work, no auto-restart).

**Architecture:** Additive types + helpers + prompt edits. Tools classify failures and expose structured `LifecycleRecoveryHint` payloads; AI/executor owns recovery orchestration. Local merge moves into a temp worktree (`/tmp/<repo>-merge-issue-<N>`) so the main worktree is never disturbed. Cleanup quarantines lifecycle-owned untracked artifacts to `thoughts/lifecycle/backups/issue-<N>/...` rather than deleting them. Resolver gains stale-record classification + branch / explicit-issue / body-marker disambiguation.

**Design:** [thoughts/shared/designs/2026-05-12-autonomous-lifecycle-recovery-design.md](../designs/2026-05-12-autonomous-lifecycle-recovery-design.md)

**Contract:** none (single-domain backend + agent-prompt; no frontend/backend API surface)

---

## Dependency Graph

```
Batch 1 (parallel, 5 tasks): foundation types + pure helpers - no deps
  1.1 LifecycleRecoveryHint types
  1.2 recovery/hint-format helper (pure formatter)
  1.3 recovery/stale-classifier helper (pure classifier)
  1.4 recovery/quarantine-classifier helper (pure classifier)
  1.5 recovery/temp-worktree helper (path + lifecycle ops)

Batch 2 (parallel, 4 tasks): core lifecycle integration - depends on Batch 1
  2.1 merge.ts: temp-worktree local merge + conflict hint  [deps: 1.1, 1.5]
  2.2 cleanup-policy.ts: artifact quarantine integration   [deps: 1.1, 1.4]
  2.3 commits.ts: richer CommitOutcome failure classes     [deps: 1.1]
  2.4 resolver.ts: stale/ambiguous candidate metadata      [deps: 1.1, 1.3]

Batch 3 (parallel, 5 tasks): tool surface hint emission - depends on Batch 2
  3.1 tools/lifecycle/finish.ts: hint section in markdown  [deps: 2.1, 1.2]
  3.2 tools/lifecycle/commit.ts: header fix + hint         [deps: 2.3, 1.2]
  3.3 tools/lifecycle/current.ts: candidate metadata       [deps: 2.4, 1.2]
  3.4 tools/lifecycle/resume.ts: force-refresh stale       [deps: 2.4]
  3.5 tools/lifecycle/recovery-decision.ts: hint passthrough [deps: 1.1, 1.2]

Batch 4 (parallel, 5 tasks): prompts + docs - depends on Batch 3
  4.1 src/agents/brainstormer.ts: bounded recovery loop    [deps: 3.1, 3.2]
  4.2 src/agents/planner.ts: ambiguous lifecycle handling  [deps: 3.3, 3.4]
  4.3 src/agents/executor.ts: commit/finish recovery       [deps: 3.1, 3.2]
  4.4 src/agents/commander.ts: operational summary         [deps: 3.1, 3.2]
  4.5 AGENTS.md mirror: lifecycle recovery section         [deps: 4.1-4.4]

Batch 5 (parallel, 3 tasks): cross-cutting safety regression tests - depends on Batch 4
  5.1 tests/lifecycle/recovery-safety-boundary.test.ts
  5.2 tests/agents/lifecycle-recovery-prompt.test.ts (full sweep)
  5.3 tests/lifecycle/recovery-hint-shape.test.ts (contract test across tools)
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: LifecycleRecoveryHint type module
**File:** `src/lifecycle/recovery/hint.ts` (NEW)
**Test:** `tests/lifecycle/recovery/hint.test.ts` (NEW)
**Depends:** none
**Domain:** backend
**Atlas-impact:** layer-update (10-impl: lifecycle module gains a recovery-hint contract surface)

Create the structural failure model that all lifecycle tools will emit. Pure types + small constructor helpers, no I/O. Co-located under existing `src/lifecycle/recovery/` directory (already used by `inspect.ts` etc.).

```typescript
// tests/lifecycle/recovery/hint.test.ts
import { describe, expect, it } from "bun:test";

import {
  LIFECYCLE_FAILURE_KINDS,
  LIFECYCLE_RECOMMENDED_ACTIONS,
  type LifecycleRecoveryHint,
  buildHint,
  isSafeToRetry,
} from "@/lifecycle/recovery/hint";

describe("LifecycleRecoveryHint", () => {
  it("exposes the 10 failure kinds named in the design", () => {
    expect(LIFECYCLE_FAILURE_KINDS).toEqual([
      "ambiguous_lifecycle",
      "stale_record",
      "record_missing",
      "invalid_issue_number",
      "dirty_base_worktree",
      "merge_conflict",
      "untracked_cleanup_blocker",
      "tracked_cleanup_blocker",
      "pr_checks_failed",
      "push_failed",
      "unknown",
    ]);
  });

  it("exposes the 7 recommended actions named in the design", () => {
    expect(LIFECYCLE_RECOMMENDED_ACTIONS).toEqual([
      "resume_issue",
      "clean_stale_records",
      "retry_finish",
      "use_temp_merge_worktree",
      "resolve_conflicts",
      "quarantine_artifacts",
      "ask_user",
    ]);
  });

  it("buildHint produces a frozen, valid hint with sensible defaults", () => {
    const hint = buildHint({
      failureKind: "ambiguous_lifecycle",
      recommendedNextAction: "ask_user",
      summary: "multiple open lifecycles",
    });
    expect(hint.failureKind).toBe("ambiguous_lifecycle");
    expect(hint.safeToRetry).toBe(false);
    expect(hint.attempt).toBe(1);
    expect(Object.isFrozen(hint)).toBe(true);
  });

  it("isSafeToRetry returns false for unknown / ask_user combos", () => {
    const hint: LifecycleRecoveryHint = buildHint({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      summary: "n/a",
    });
    expect(isSafeToRetry(hint)).toBe(false);
  });

  it("isSafeToRetry returns true when safeToRetry flag is set", () => {
    const hint: LifecycleRecoveryHint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "conflict in src/foo.ts",
      safeToRetry: true,
    });
    expect(isSafeToRetry(hint)).toBe(true);
  });
});
```

```typescript
// src/lifecycle/recovery/hint.ts
export const LIFECYCLE_FAILURE_KINDS = [
  "ambiguous_lifecycle",
  "stale_record",
  "record_missing",
  "invalid_issue_number",
  "dirty_base_worktree",
  "merge_conflict",
  "untracked_cleanup_blocker",
  "tracked_cleanup_blocker",
  "pr_checks_failed",
  "push_failed",
  "unknown",
] as const;

export type LifecycleFailureKind = (typeof LIFECYCLE_FAILURE_KINDS)[number];

export const LIFECYCLE_RECOMMENDED_ACTIONS = [
  "resume_issue",
  "clean_stale_records",
  "retry_finish",
  "use_temp_merge_worktree",
  "resolve_conflicts",
  "quarantine_artifacts",
  "ask_user",
] as const;

export type LifecycleRecommendedAction = (typeof LIFECYCLE_RECOMMENDED_ACTIONS)[number];

export interface LifecycleCandidateSummary {
  readonly issueNumber: number;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly state: string;
  readonly stale: boolean;
  readonly staleReason: string | null;
}

export interface LifecycleRecoveryHint {
  readonly failureKind: LifecycleFailureKind;
  readonly recommendedNextAction: LifecycleRecommendedAction;
  readonly summary: string;
  readonly safeToRetry: boolean;
  readonly attempt: number;
  readonly issueNumber: number | null;
  readonly branch: string | null;
  readonly worktree: string | null;
  readonly candidates: readonly LifecycleCandidateSummary[];
  readonly conflictFiles: readonly string[];
  readonly backupPath: string | null;
}

export interface BuildHintInput {
  readonly failureKind: LifecycleFailureKind;
  readonly recommendedNextAction: LifecycleRecommendedAction;
  readonly summary: string;
  readonly safeToRetry?: boolean;
  readonly attempt?: number;
  readonly issueNumber?: number | null;
  readonly branch?: string | null;
  readonly worktree?: string | null;
  readonly candidates?: readonly LifecycleCandidateSummary[];
  readonly conflictFiles?: readonly string[];
  readonly backupPath?: string | null;
}

const DEFAULT_ATTEMPT = 1;

export function buildHint(input: BuildHintInput): LifecycleRecoveryHint {
  const hint: LifecycleRecoveryHint = {
    failureKind: input.failureKind,
    recommendedNextAction: input.recommendedNextAction,
    summary: input.summary,
    safeToRetry: input.safeToRetry ?? false,
    attempt: input.attempt ?? DEFAULT_ATTEMPT,
    issueNumber: input.issueNumber ?? null,
    branch: input.branch ?? null,
    worktree: input.worktree ?? null,
    candidates: input.candidates ?? [],
    conflictFiles: input.conflictFiles ?? [],
    backupPath: input.backupPath ?? null,
  };
  return Object.freeze(hint);
}

export function isSafeToRetry(hint: LifecycleRecoveryHint): boolean {
  if (hint.recommendedNextAction === "ask_user") return false;
  if (hint.failureKind === "unknown") return false;
  return hint.safeToRetry;
}
```

**Verify:** `bun test tests/lifecycle/recovery/hint.test.ts`
**Commit:** `feat(lifecycle): add LifecycleRecoveryHint structural failure model`

---

### Task 1.2: Recovery hint markdown formatter
**File:** `src/lifecycle/recovery/hint-format.ts` (NEW)
**Test:** `tests/lifecycle/recovery/hint-format.test.ts` (NEW)
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Pure markdown rendering helper used by every `src/tools/lifecycle/*.ts` exit path. Stable section anchor (`### Recovery hint`) so prompt-side parsing is reliable.

```typescript
// tests/lifecycle/recovery/hint-format.test.ts
import { describe, expect, it } from "bun:test";

import { buildHint } from "@/lifecycle/recovery/hint";
import { RECOVERY_SECTION_HEADER, formatRecoveryHint } from "@/lifecycle/recovery/hint-format";

describe("formatRecoveryHint", () => {
  it("renders the stable section header", () => {
    const md = formatRecoveryHint(
      buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "boom" }),
    );
    expect(md.startsWith(RECOVERY_SECTION_HEADER)).toBe(true);
  });

  it("includes failure_kind, recommended_next_action, safe_to_retry, attempt", () => {
    const md = formatRecoveryHint(
      buildHint({
        failureKind: "merge_conflict",
        recommendedNextAction: "resolve_conflicts",
        summary: "two conflicts",
        safeToRetry: true,
        attempt: 2,
        issueNumber: 67,
        branch: "issue/67-foo",
        worktree: "/tmp/m",
        conflictFiles: ["a.ts", "b.ts"],
      }),
    );
    expect(md).toContain("**failure_kind:** `merge_conflict`");
    expect(md).toContain("**recommended_next_action:** `resolve_conflicts`");
    expect(md).toContain("**safe_to_retry:** `true`");
    expect(md).toContain("**attempt:** `2`");
    expect(md).toContain("**issue_number:** `67`");
    expect(md).toContain("- `a.ts`");
    expect(md).toContain("- `b.ts`");
  });

  it("omits empty candidate / conflict_files / backup_path sections", () => {
    const md = formatRecoveryHint(
      buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "x" }),
    );
    expect(md).not.toContain("**candidates:**");
    expect(md).not.toContain("**conflict_files:**");
    expect(md).not.toContain("**backup_path:**");
  });

  it("renders candidates with stale flag", () => {
    const md = formatRecoveryHint(
      buildHint({
        failureKind: "ambiguous_lifecycle",
        recommendedNextAction: "clean_stale_records",
        summary: "12 candidates",
        candidates: [
          { issueNumber: 7, branch: "issue/7-a", worktree: null, state: "branch_ready", stale: true, staleReason: "issue closed on github" },
          { issueNumber: 67, branch: "issue/67-b", worktree: "/wt", state: "in_progress", stale: false, staleReason: null },
        ],
      }),
    );
    expect(md).toContain("| 7 | `issue/7-a` | `-` | `branch_ready` | `true` | issue closed on github |");
    expect(md).toContain("| 67 | `issue/67-b` | `/wt` | `in_progress` | `false` | - |");
  });
});
```

```typescript
// src/lifecycle/recovery/hint-format.ts
import type { LifecycleCandidateSummary, LifecycleRecoveryHint } from "./hint";

export const RECOVERY_SECTION_HEADER = "### Recovery hint";

const LINE_BREAK = "\n";
const MISSING = "-";

const formatNullable = (value: string | number | null): string => {
  if (value === null) return MISSING;
  return String(value);
};

const formatCode = (value: string | number | null): string => {
  if (value === null) return `\`${MISSING}\``;
  return `\`${String(value)}\``;
};

const formatCandidates = (candidates: readonly LifecycleCandidateSummary[]): readonly string[] => {
  if (candidates.length === 0) return [];
  const header = "| Issue # | Branch | Worktree | State | Stale | Reason |";
  const sep = "| --- | --- | --- | --- | --- | --- |";
  const rows = candidates.map(
    (c) =>
      `| ${c.issueNumber} | ${formatCode(c.branch)} | ${formatCode(c.worktree)} | ${formatCode(c.state)} | ${formatCode(String(c.stale))} | ${formatNullable(c.staleReason)} |`,
  );
  return ["", "**candidates:**", "", header, sep, ...rows];
};

const formatList = (label: string, items: readonly string[]): readonly string[] => {
  if (items.length === 0) return [];
  return ["", `**${label}:**`, "", ...items.map((it) => `- \`${it}\``)];
};

const formatScalar = (label: string, value: string | number | null): string =>
  `**${label}:** ${formatCode(value)}`;

const formatBackup = (backupPath: string | null): readonly string[] => {
  if (backupPath === null) return [];
  return ["", formatScalar("backup_path", backupPath)];
};

export function formatRecoveryHint(hint: LifecycleRecoveryHint): string {
  const lines: string[] = [
    RECOVERY_SECTION_HEADER,
    "",
    formatScalar("failure_kind", hint.failureKind),
    formatScalar("recommended_next_action", hint.recommendedNextAction),
    formatScalar("safe_to_retry", String(hint.safeToRetry)),
    formatScalar("attempt", hint.attempt),
    formatScalar("issue_number", hint.issueNumber),
    formatScalar("branch", hint.branch),
    formatScalar("worktree", hint.worktree),
    "",
    `**summary:** ${hint.summary}`,
  ];
  lines.push(...formatCandidates(hint.candidates));
  lines.push(...formatList("conflict_files", hint.conflictFiles));
  lines.push(...formatBackup(hint.backupPath));
  return lines.join(LINE_BREAK);
}
```

**Verify:** `bun test tests/lifecycle/recovery/hint-format.test.ts`
**Commit:** `feat(lifecycle): add hint markdown formatter with stable header anchor`

---

### Task 1.3: Stale lifecycle record classifier
**File:** `src/lifecycle/recovery/stale-classifier.ts` (NEW)
**Test:** `tests/lifecycle/recovery/stale-classifier.test.ts` (NEW)
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Pure classifier deciding whether an open lifecycle record should be treated as stale (and therefore excluded from ambiguous resolution). Mirrors the design's disambiguation order. NO I/O — caller (resolver in 2.4) supplies probed observations.

```typescript
// tests/lifecycle/recovery/stale-classifier.test.ts
import { describe, expect, it } from "bun:test";

import { classifyStale, type StaleProbe } from "@/lifecycle/recovery/stale-classifier";

const baseProbe = (overrides: Partial<StaleProbe> = {}): StaleProbe => ({
  issueNumber: 7,
  state: "in_progress",
  worktreeExists: true,
  worktreeIsRegistered: true,
  branchExists: true,
  branchMergedIntoBase: false,
  issueClosedOnGithub: false,
  ...overrides,
});

describe("classifyStale", () => {
  it("returns stale when GitHub issue is closed", () => {
    const result = classifyStale(baseProbe({ issueClosedOnGithub: true }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("issue_closed");
  });

  it("returns stale when worktree is missing on disk and not registered", () => {
    const result = classifyStale(baseProbe({ worktreeExists: false, worktreeIsRegistered: false }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("worktree_missing");
  });

  it("returns stale when branch is already merged into base", () => {
    const result = classifyStale(baseProbe({ branchMergedIntoBase: true }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("branch_merged");
  });

  it("returns stale when branch no longer exists locally or on remote", () => {
    const result = classifyStale(baseProbe({ branchExists: false }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("branch_missing");
  });

  it("returns NOT stale for an active in-progress lifecycle", () => {
    const result = classifyStale(baseProbe());
    expect(result.stale).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("treats terminal local states as stale (defensive: should not be in open list)", () => {
    const result = classifyStale(baseProbe({ state: "closed" }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("local_state_terminal");
  });
});
```

```typescript
// src/lifecycle/recovery/stale-classifier.ts
export interface StaleProbe {
  readonly issueNumber: number;
  readonly state: string;
  readonly worktreeExists: boolean;
  readonly worktreeIsRegistered: boolean;
  readonly branchExists: boolean;
  readonly branchMergedIntoBase: boolean;
  readonly issueClosedOnGithub: boolean;
}

export interface StaleClassification {
  readonly stale: boolean;
  readonly reason: string | null;
}

const TERMINAL_LOCAL_STATES: readonly string[] = ["closed", "cleaned", "aborted"];

const fresh = (): StaleClassification => ({ stale: false, reason: null });
const stale = (reason: string): StaleClassification => ({ stale: true, reason });

export function classifyStale(probe: StaleProbe): StaleClassification {
  if (TERMINAL_LOCAL_STATES.includes(probe.state)) return stale(`local_state_terminal: ${probe.state}`);
  if (probe.issueClosedOnGithub) return stale("issue_closed_on_github");
  if (!probe.worktreeExists && !probe.worktreeIsRegistered) return stale("worktree_missing");
  if (!probe.branchExists) return stale("branch_missing");
  if (probe.branchMergedIntoBase) return stale("branch_merged_into_base");
  return fresh();
}
```

**Verify:** `bun test tests/lifecycle/recovery/stale-classifier.test.ts`
**Commit:** `feat(lifecycle): add stale lifecycle record classifier`

---

### Task 1.4: Cleanup quarantine classifier
**File:** `src/lifecycle/recovery/quarantine-classifier.ts` (NEW)
**Test:** `tests/lifecycle/recovery/quarantine-classifier.test.ts` (NEW)
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Pure classifier: given an untracked path inside a lifecycle worktree + the lifecycle record's known artifact pointers, decide whether the path can be safely moved to backup, vs must block. Conservative defaults: only paths under known lifecycle-owned prefixes AND/OR explicitly listed in record.artifacts qualify. NO disk I/O.

```typescript
// tests/lifecycle/recovery/quarantine-classifier.test.ts
import { describe, expect, it } from "bun:test";

import { classifyQuarantine } from "@/lifecycle/recovery/quarantine-classifier";

describe("classifyQuarantine", () => {
  it("quarantines untracked files matching known lifecycle artifact pointers", () => {
    const r = classifyQuarantine({
      untrackedPath: "thoughts/shared/designs/2026-05-12-foo-design.md",
      artifactPointers: ["thoughts/shared/designs/2026-05-12-foo-design.md"],
    });
    expect(r.kind).toBe("quarantine");
    expect(r.reason).toContain("matches_artifact_pointer");
  });

  it("quarantines files under thoughts/shared/designs/ even without explicit pointer", () => {
    const r = classifyQuarantine({
      untrackedPath: "thoughts/shared/designs/2026-05-12-anything.md",
      artifactPointers: [],
    });
    expect(r.kind).toBe("quarantine");
    expect(r.reason).toContain("lifecycle_owned_prefix");
  });

  it("quarantines files under thoughts/shared/plans/ and thoughts/shared/atlas-deltas/", () => {
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/plans/x.md", artifactPointers: [] }).kind).toBe(
      "quarantine",
    );
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/atlas-deltas/x.md", artifactPointers: [] }).kind).toBe(
      "quarantine",
    );
  });

  it("blocks unknown untracked files (could be user work)", () => {
    const r = classifyQuarantine({ untrackedPath: "src/some-new-file.ts", artifactPointers: [] });
    expect(r.kind).toBe("block");
    expect(r.reason).toContain("unknown_untracked");
  });

  it("blocks .env, .secret*, credentials*, regardless of prefix", () => {
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/designs/.env", artifactPointers: [] }).kind).toBe(
      "block",
    );
    expect(classifyQuarantine({ untrackedPath: "thoughts/shared/plans/credentials.json", artifactPointers: [] }).kind).toBe(
      "block",
    );
  });

  it("blocks paths attempting to escape via ../", () => {
    const r = classifyQuarantine({ untrackedPath: "../outside/file.md", artifactPointers: [] });
    expect(r.kind).toBe("block");
    expect(r.reason).toContain("path_escape");
  });
});
```

```typescript
// src/lifecycle/recovery/quarantine-classifier.ts
export interface QuarantineProbe {
  readonly untrackedPath: string;
  readonly artifactPointers: readonly string[];
}

export type QuarantineKind = "quarantine" | "block";

export interface QuarantineClassification {
  readonly kind: QuarantineKind;
  readonly reason: string;
}

const LIFECYCLE_OWNED_PREFIXES: readonly string[] = [
  "thoughts/shared/designs/",
  "thoughts/shared/plans/",
  "thoughts/shared/atlas-deltas/",
  "thoughts/lifecycle/",
];

const SECRET_NAME_PATTERN = /(^|\/)(\.env(\..+)?|.*credentials.*|.*secret.*|.*\.key|.*\.pem)$/i;

const block = (reason: string): QuarantineClassification => ({ kind: "block", reason });
const quarantine = (reason: string): QuarantineClassification => ({ kind: "quarantine", reason });

export function classifyQuarantine(probe: QuarantineProbe): QuarantineClassification {
  const path = probe.untrackedPath;

  if (path.split("/").some((seg) => seg === "..")) return block(`path_escape: ${path}`);
  if (SECRET_NAME_PATTERN.test(path)) return block(`looks_like_secret: ${path}`);

  if (probe.artifactPointers.includes(path)) return quarantine(`matches_artifact_pointer: ${path}`);

  for (const prefix of LIFECYCLE_OWNED_PREFIXES) {
    if (path.startsWith(prefix)) return quarantine(`lifecycle_owned_prefix(${prefix}): ${path}`);
  }

  return block(`unknown_untracked: ${path}`);
}
```

**Verify:** `bun test tests/lifecycle/recovery/quarantine-classifier.test.ts`
**Commit:** `feat(lifecycle): add quarantine classifier for cleanup blockers`

---

### Task 1.5: Temp merge worktree helper
**File:** `src/lifecycle/recovery/temp-worktree.ts` (NEW)
**Test:** `tests/lifecycle/recovery/temp-worktree.test.ts` (NEW)
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Helper that creates / inspects / removes a `/tmp/<repo>-merge-issue-<N>` worktree using the existing `LifecycleRunner` interface (`runner.git`). Pure orchestration on top of git commands; safety properties are tested through fake runner. Path uses `os.tmpdir()` so tests can override.

Design choice: the helper does NOT execute the merge itself. It only sets up / inspects / tears down the worktree. The actual `git merge` step lives in `merge.ts` (Task 2.1). Conflict detection is done by reading `git status --porcelain` after the merge; the helper exposes a `readConflicts()` query.

```typescript
// tests/lifecycle/recovery/temp-worktree.test.ts
import { describe, expect, it } from "bun:test";

import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "@/lifecycle/recovery/temp-worktree";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
}

const recorder = (results: readonly RunResult[]): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  let i = 0;
  const runner: LifecycleRunner = {
    git: async (args) => {
      calls.push({ bin: "git", args });
      const r = results[i] ?? ok();
      i += 1;
      return r;
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      return ok();
    },
  };
  return { runner, calls };
};

describe("computeTempWorktreePath", () => {
  it("uses /tmp/<repo>-merge-issue-<N> shape", () => {
    const path = computeTempWorktreePath({ repoRoot: "/home/user/CODE/micode", issueNumber: 67, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/micode-merge-issue-67");
  });

  it("falls back to repo basename when path has trailing slash", () => {
    const path = computeTempWorktreePath({ repoRoot: "/x/y/repo/", issueNumber: 5, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/repo-merge-issue-5");
  });
});

describe("createTempMergeWorktree", () => {
  it("issues `git worktree add <path> <baseBranch>` and returns path on success", async () => {
    const { runner, calls } = recorder([ok()]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("type narrow");
    expect(result.path).toBe("/tmp/micode-merge-issue-67");
    expect(calls[0]?.args).toEqual(["worktree", "add", "/tmp/micode-merge-issue-67", "main"]);
  });

  it("returns failed when git worktree add fails", async () => {
    const { runner } = recorder([fail("path exists")]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("failed");
  });
});

describe("readMergeConflicts", () => {
  it("returns conflict files from git status --porcelain UU/AA/DD lines", async () => {
    const { runner } = recorder([
      ok("UU src/a.ts\nAA src/b.ts\n M src/c.ts\nDD src/d.ts\n?? untracked.ts\n"),
    ]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/d.ts"]);
  });

  it("returns empty list when git status fails (caller decides what to do)", async () => {
    const { runner } = recorder([fail()]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual([]);
  });
});

describe("removeTempMergeWorktree", () => {
  it("issues `git worktree remove --force <path>` from repo root", async () => {
    const { runner, calls } = recorder([ok()]);
    await removeTempMergeWorktree(runner, { repoRoot: "/r/micode", path: "/tmp/micode-merge-issue-67" });
    expect(calls[0]?.args).toEqual(["worktree", "remove", "--force", "/tmp/micode-merge-issue-67"]);
  });
});
```

```typescript
// src/lifecycle/recovery/temp-worktree.ts
import { basename } from "node:path";

import type { LifecycleRunner } from "@/lifecycle/runner";

export interface TempWorktreePathInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly tmpDir: string;
}

export function computeTempWorktreePath(input: TempWorktreePathInput): string {
  const stripped = input.repoRoot.replace(/\/+$/, "");
  const repo = basename(stripped);
  return `${input.tmpDir.replace(/\/+$/, "")}/${repo}-merge-issue-${input.issueNumber}`;
}

export interface CreateTempInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly tmpDir: string;
}

export type CreateTempResult =
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly reason: string };

const OK = 0;
const CONFLICT_PREFIXES: readonly string[] = ["UU", "AA", "DD", "AU", "UA", "DU", "UD"];

export async function createTempMergeWorktree(
  runner: LifecycleRunner,
  input: CreateTempInput,
): Promise<CreateTempResult> {
  const path = computeTempWorktreePath({
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    tmpDir: input.tmpDir,
  });
  const result = await runner.git(["worktree", "add", path, input.baseBranch], { cwd: input.repoRoot });
  if (result.exitCode === OK) return { kind: "created", path };
  return { kind: "failed", path, reason: `${result.stderr}\n${result.stdout}`.trim() };
}

export async function readMergeConflicts(runner: LifecycleRunner, worktreePath: string): Promise<readonly string[]> {
  const status = await runner.git(["status", "--porcelain"], { cwd: worktreePath });
  if (status.exitCode !== OK) return [];
  return status.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length >= 3)
    .filter((line) => CONFLICT_PREFIXES.some((p) => line.startsWith(p)))
    .map((line) => line.slice(3).trim())
    .filter((p) => p.length > 0);
}

export interface RemoveTempInput {
  readonly repoRoot: string;
  readonly path: string;
}

export async function removeTempMergeWorktree(runner: LifecycleRunner, input: RemoveTempInput): Promise<void> {
  await runner.git(["worktree", "remove", "--force", input.path], { cwd: input.repoRoot });
}
```

**Verify:** `bun test tests/lifecycle/recovery/temp-worktree.test.ts`
**Commit:** `feat(lifecycle): add temp merge worktree helper`

---

## Batch 2: Core Lifecycle Integration (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Local merge uses temp worktree + emits conflict hint
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/merge-temp-worktree.test.ts` (NEW)
**Depends:** 1.1, 1.5
**Domain:** backend
**Atlas-impact:** layer-update (20-behavior: local merge no longer touches main worktree)

Refactor `finishViaLocalMerge` to perform `git merge --no-ff` inside a temp worktree created via Task 1.5. Extend `FinishOutcome` (or use a sibling `recoveryHint` field — see below) so merge conflict failures expose `conflict_files` and `worktree` (the temp path that the AI / executor can use to resolve conflicts).

**Design decision (gap-fill):** Rather than mutate the existing `FinishOutcome` type (which is referenced widely), add an OPTIONAL `recoveryHint?: LifecycleRecoveryHint` field. All success paths leave it undefined. Tool-layer (Batch 3) reads it when present.

Required edits inside `src/lifecycle/merge.ts`:

1. Import `createTempMergeWorktree`, `readMergeConflicts`, `removeTempMergeWorktree` from `./recovery/temp-worktree`.
2. Import `buildHint` from `./recovery/hint`.
3. Replace `finishViaLocalMerge` body to:
   - Create temp worktree at `/tmp/<repo>-merge-issue-<N>` using `runner.git(["worktree", "add", tmp, baseBranch])` from `input.cwd`.
   - Run `fetch origin <baseBranch>` then `merge --no-ff <issueBranch>` from inside `tmp`.
   - On merge failure, call `readMergeConflicts(runner, tmp)`. If non-empty, return a `FinishOutcome` with `recoveryHint = buildHint({ failureKind: "merge_conflict", recommendedNextAction: "resolve_conflicts", summary: "...", safeToRetry: false, conflictFiles, worktree: tmp, issueNumber: derivedFromBranch })`. Do NOT remove tmp worktree — the AI needs it to resolve. On checkout failure or other unexpected git failure, return `dirty_base_worktree` or `unknown` hint.
   - On merge success, push base branch from `tmp` (`runner.git(["push", "origin", baseBranch], { cwd: tmp })`); on push failure emit `push_failed` hint.
   - On overall success: remove temp worktree, then run existing `runPostMergeCleanup` against the lifecycle worktree (not tmp).
4. Add `derivedIssueNumberFromBranch(branch)` helper (regex `^issue\/(\d+)-`); used to populate `hint.issueNumber`.
5. Update `FinishOutcome` type — but since it lives in `src/lifecycle/types.ts`, the field add is done THERE under Task 2.1 too. Add: `readonly recoveryHint?: LifecycleRecoveryHint;` as optional. Wire helper constructors (`createOutcome`, `createPreCleanupOutcome`) to accept and pass it through.

```typescript
// tests/lifecycle/merge-temp-worktree.test.ts
import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

const recorder = (queue: Map<string, RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ bin: "git", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      return r ?? OK();
    },
    gh: async (args, opts) => {
      calls.push({ bin: "gh", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      // Default: no remote CI so resolveStrategy stays in local-merge mode.
      return r ?? OK("[]");
    },
  };
  return { runner, calls };
};

describe("finishViaLocalMerge with temp worktree", () => {
  it("creates /tmp/<repo>-merge-issue-<N>, runs merge inside it, pushes, then removes it", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]"), OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [OK()]);
    queue.set("fetch origin main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [OK()]);
    queue.set("push origin main", [OK()]);
    queue.set("worktree remove --force /tmp/micode-merge-issue-67", [OK()]);
    queue.set("worktree list --porcelain", [OK("worktree /r/micode-issue-67\n")]);
    queue.set("worktree remove /r/micode-issue-67", [OK()]);
    queue.set("status --porcelain", [OK()]);
    queue.set("ls-files --others --exclude-standard", [OK()]);
    queue.set("branch -d issue/67-x", [OK()]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.recoveryHint).toBeUndefined();

    const cwds = calls.map((c) => `${c.args.join(" ")}@${c.cwd}`);
    expect(cwds).toContain("merge --no-ff issue/67-x@/tmp/micode-merge-issue-67");
    expect(cwds).toContain("push origin main@/tmp/micode-merge-issue-67");
    // main worktree was NEVER `git checkout`'d
    expect(cwds.some((s) => s.startsWith("checkout main@/r/micode"))).toBe(false);
  });

  it("on merge conflict, keeps tmp worktree, returns merge_conflict hint with conflict_files", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [OK()]);
    queue.set("fetch origin main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [FAIL("CONFLICT")]);
    queue.set("status --porcelain", [OK("UU src/a.ts\nAA src/b.ts\n")]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.recoveryHint?.conflictFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(outcome.recoveryHint?.worktree).toBe("/tmp/micode-merge-issue-67");
    // tmp worktree must NOT have been removed (AI needs to resolve conflicts in it)
    expect(calls.some((c) => c.args.join(" ") === "worktree remove --force /tmp/micode-merge-issue-67")).toBe(false);
  });

  it("safety: never executes `git reset --hard` against the main worktree", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [FAIL("path exists")]);

    const { runner, calls } = recorder(queue);
    await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(calls.some((c) => c.args.join(" ").startsWith("reset --hard"))).toBe(false);
    expect(calls.some((c) => c.args.join(" ").includes("--force-with-lease"))).toBe(false);
    expect(calls.some((c) => c.args.join(" ").startsWith("push --force"))).toBe(false);
  });
});
```

```typescript
// Inside src/lifecycle/types.ts — add OPTIONAL field (additive, no breakage):
// import type { LifecycleRecoveryHint } from "./recovery/hint";
// In FinishOutcome interface add:
//   readonly recoveryHint?: LifecycleRecoveryHint;
// In CommitOutcome interface add (used by 2.3):
//   readonly recoveryHint?: LifecycleRecoveryHint;

// In src/lifecycle/merge.ts — replace finishViaLocalMerge and helpers:
import { buildHint, type LifecycleRecoveryHint } from "./recovery/hint";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "./recovery/temp-worktree";
import { tmpdir } from "node:os";

const TMP_DIR = tmpdir();
const ISSUE_BRANCH_RE = /^issue\/(\d+)-/;

const deriveIssueNumber = (branch: string): number | null => {
  const m = ISSUE_BRANCH_RE.exec(branch);
  const raw = m?.[1];
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const finishViaLocalMerge = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const baseBranch = getBaseBranch(input);
  const issueNumber = deriveIssueNumber(input.branch);
  if (issueNumber === null) {
    const hint = buildHint({
      failureKind: "invalid_issue_number",
      recommendedNextAction: "ask_user",
      summary: `cannot derive issue number from branch '${input.branch}'`,
      branch: input.branch,
    });
    return withHint(createPreCleanupOutcome(false, null, "invalid_issue_branch"), hint);
  }

  const tmpPath = computeTempWorktreePath({ repoRoot: input.cwd, issueNumber, tmpDir: TMP_DIR });

  const create = await createTempMergeWorktree(runner, {
    repoRoot: input.cwd,
    issueNumber,
    baseBranch,
    tmpDir: TMP_DIR,
  });
  if (create.kind === "failed") {
    return withHint(
      createPreCleanupOutcome(false, null, `temp_worktree_create_failed: ${create.reason}`),
      buildHint({
        failureKind: "dirty_base_worktree",
        recommendedNextAction: "use_temp_merge_worktree",
        summary: create.reason,
        issueNumber,
        branch: input.branch,
        worktree: tmpPath,
        safeToRetry: false,
      }),
    );
  }

  const fetchNote = await runGitStep(runner, ["fetch", "origin", baseBranch], create.path, "git_fetch");
  if (fetchNote) return withHint(createPreCleanupOutcome(false, null, fetchNote), unknownHint(issueNumber, input.branch, fetchNote, tmpPath));

  const mergeRun = await runner.git(["merge", "--no-ff", input.branch], { cwd: create.path });
  if (mergeRun.exitCode !== OK_EXIT_CODE) {
    const conflicts = await readMergeConflicts(runner, create.path);
    if (conflicts.length > 0) {
      const hint = buildHint({
        failureKind: "merge_conflict",
        recommendedNextAction: "resolve_conflicts",
        summary: `merge conflicts in ${conflicts.length} file(s); resolve in temp worktree then retry`,
        issueNumber,
        branch: input.branch,
        worktree: create.path,
        conflictFiles: conflicts,
        safeToRetry: false,
      });
      return withHint(createPreCleanupOutcome(false, null, "merge_conflict"), hint);
    }
    return withHint(
      createPreCleanupOutcome(false, null, formatCommandFailure("git_merge", mergeRun)),
      unknownHint(issueNumber, input.branch, mergeRun.stderr || "git_merge_failed", tmpPath),
    );
  }

  const pushRun = await runner.git(["push", "origin", baseBranch], { cwd: create.path });
  if (pushRun.exitCode !== OK_EXIT_CODE) {
    return withHint(
      createPreCleanupOutcome(false, null, formatCommandFailure("git_push", pushRun)),
      buildHint({
        failureKind: "push_failed",
        recommendedNextAction: "retry_finish",
        summary: pushRun.stderr || "push failed",
        issueNumber,
        branch: input.branch,
        worktree: create.path,
        safeToRetry: true,
      }),
    );
  }

  await removeTempMergeWorktree(runner, { repoRoot: input.cwd, path: create.path });

  const cleanup = await runPostMergeCleanup(runner, input);
  let branchDeleteNote: string | null = null;
  if (worktreeRemovedFromCleanup(cleanup)) {
    branchDeleteNote = await runGitStep(
      runner,
      [GIT_BRANCH, GIT_DELETE_FLAG, input.branch],
      input.cwd,
      "git_branch_delete",
    );
  }
  return createOutcome(true, null, cleanup, mergeNotes(cleanupNote(cleanup), branchDeleteNote));
};

const withHint = (outcome: FinishOutcome, hint: LifecycleRecoveryHint): FinishOutcome => ({ ...outcome, recoveryHint: hint });

const unknownHint = (
  issueNumber: number,
  branch: string,
  detail: string,
  worktree: string,
): LifecycleRecoveryHint =>
  buildHint({
    failureKind: "unknown",
    recommendedNextAction: "ask_user",
    summary: detail,
    issueNumber,
    branch,
    worktree,
    safeToRetry: false,
  });
```

**Verify:** `bun test tests/lifecycle/merge-temp-worktree.test.ts && bun test tests/lifecycle/merge.test.ts`
**Commit:** `feat(lifecycle): local merge runs in temp worktree with merge_conflict hint`

---

### Task 2.2: Cleanup-policy artifact quarantine integration
**File:** `src/lifecycle/cleanup-policy.ts`
**Test:** `tests/lifecycle/cleanup-quarantine.test.ts` (NEW)
**Depends:** 1.1, 1.4
**Domain:** backend
**Atlas-impact:** layer-update (20-behavior: cleanup now quarantines lifecycle-owned untracked artifacts)

Extend `runCleanup` to: when classifier returns `ambiguous` (untracked files only) AND every untracked path classifies as `quarantine` per Task 1.4, move them under `<repoRoot>/thoughts/lifecycle/backups/issue-<N>/<timestamp>/<relative-path>` via `git mv` (or, since they are untracked, `node:fs` rename) and return a successful `CleanupOutcome` of `removed` with `note` describing the backup path. If ANY path classifies as `block`, retain existing block behavior and emit a hint.

**Design choice (gap-fill):** because untracked files are by definition not tracked, use `node:fs` `mkdirSync(recursive=true)` + `renameSync` rather than `git mv`. This keeps the move outside git's tracking — exactly the desired behavior.

Required edits to `CleanupPolicyInput`:
- Add `readonly issueNumber: number;`
- Add `readonly artifactPointers: readonly string[];` (passed from caller, comes from `LifecycleRecord.artifacts` flattened)
- Add `readonly now?: () => Date;` (test injection)
- Add `readonly fsOps?: { mkdir: (p: string) => void; rename: (from: string, to: string) => void; };` (test injection; defaults to `node:fs` sync ops)

Required edits to `runCleanup` flow:
- After classifier returns `ambiguous`, run `classifyQuarantine` from Task 1.4 against each untracked path.
- If all paths `quarantine` → perform moves, then RE-RUN classifier; if now `clean`, proceed to `git worktree remove`. Return `removed` outcome with note: `quarantined N files to <backupPath>`.
- If ANY path `block` → return existing `blocked-ambiguous` outcome but also include a `quarantineDecisions` summary in `reason` so 3.x tools can build the hint.

Update existing call sites (`merge.ts runPostMergeCleanup`, `runner.ts` if applicable) to pass `issueNumber` and `artifactPointers`.

```typescript
// tests/lifecycle/cleanup-quarantine.test.ts
import { describe, expect, it } from "bun:test";

import { runCleanup } from "@/lifecycle/cleanup-policy";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

interface Captured {
  readonly mkdirs: string[];
  readonly renames: Array<{ from: string; to: string }>;
}

const fakeRunner = (status: string, untracked: string): LifecycleRunner => ({
  git: async (args) => {
    const key = args.join(" ");
    if (key.startsWith("worktree list")) return OK("worktree /r/wt\n");
    if (key.startsWith("status --porcelain")) return OK(status);
    if (key.startsWith("ls-files --others")) return OK(untracked);
    if (key.startsWith("worktree remove")) return OK();
    if (key.startsWith("worktree prune")) return OK();
    return OK();
  },
  gh: async () => OK(),
});

describe("runCleanup with quarantine", () => {
  it("quarantines lifecycle-owned untracked artifacts then succeeds", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    const outcome = await runCleanup(fakeRunner("", "thoughts/shared/designs/x.md\nthoughts/shared/plans/y.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: {
        mkdir: (p) => captured.mkdirs.push(p),
        rename: (from, to) => captured.renames.push({ from, to }),
      },
      now: () => new Date("2026-05-12T10:00:00Z"),
    });
    expect(outcome.kind).toBe("removed");
    expect(captured.renames.length).toBe(2);
    expect(captured.renames[0].to.startsWith("/r/thoughts/lifecycle/backups/issue-67/")).toBe(true);
    expect(captured.renames[0].to.endsWith("thoughts/shared/designs/x.md")).toBe(true);
    expect(outcome.reason).toContain("quarantined 2");
  });

  it("blocks when an untracked file looks like a secret or unknown user work", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    const outcome = await runCleanup(fakeRunner("", "src/new-feature.ts\nthoughts/shared/designs/x.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: { mkdir: (p) => captured.mkdirs.push(p), rename: (from, to) => captured.renames.push({ from, to }) },
    });
    expect(outcome.kind).toBe("blocked-ambiguous");
    expect(captured.renames.length).toBe(0);
    expect(outcome.reason).toContain("unknown_untracked");
  });

  it("never deletes untracked files (rename only, no rm)", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    await runCleanup(fakeRunner("", "thoughts/shared/designs/x.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: { mkdir: (p) => captured.mkdirs.push(p), rename: (from, to) => captured.renames.push({ from, to }) },
    });
    // We don't shell out to rm; only rename
    expect(captured.renames.length).toBe(1);
  });
});
```

```typescript
// src/lifecycle/cleanup-policy.ts (edit, additive)
import { mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { classifyQuarantine, type QuarantineClassification } from "./recovery/quarantine-classifier";
// ... existing imports ...

export interface CleanupFsOps {
  readonly mkdir: (path: string) => void;
  readonly rename: (from: string, to: string) => void;
}

export interface CleanupPolicyInput {
  // ... existing fields ...
  readonly issueNumber: number;
  readonly artifactPointers: readonly string[];
  readonly now?: () => Date;
  readonly fsOps?: CleanupFsOps;
}

const defaultFsOps: CleanupFsOps = {
  mkdir: (p) => mkdirSync(p, { recursive: true }),
  rename: (from, to) => renameSync(from, to),
};

const buildBackupBase = (cwd: string, issueNumber: number, ts: Date): string =>
  join(cwd, "thoughts", "lifecycle", "backups", `issue-${issueNumber}`, ts.toISOString().replace(/[:.]/g, "-"));

const quarantineUntracked = (
  cwd: string,
  worktree: string,
  paths: readonly string[],
  artifactPointers: readonly string[],
  issueNumber: number,
  now: Date,
  fsOps: CleanupFsOps,
): { kind: "ok"; backupBase: string; count: number } | { kind: "blocked"; reason: string } => {
  const decisions: QuarantineClassification[] = paths.map((p) =>
    classifyQuarantine({ untrackedPath: p, artifactPointers }),
  );
  const blocked = decisions.find((d) => d.kind === "block");
  if (blocked) return { kind: "blocked", reason: blocked.reason };

  const backupBase = buildBackupBase(cwd, issueNumber, now);
  for (const rel of paths) {
    const from = join(worktree, rel);
    const to = join(backupBase, rel);
    fsOps.mkdir(dirname(to));
    fsOps.rename(from, to);
  }
  return { kind: "ok", backupBase, count: paths.length };
};

// In runCleanup, after the existing classifyCleanup() call:
// if (classification.kind === "ambiguous") {
//   const q = quarantineUntracked(input.cwd, input.worktree, untrackedPaths, input.artifactPointers, input.issueNumber, (input.now ?? (() => new Date()))(), input.fsOps ?? defaultFsOps);
//   if (q.kind === "blocked") return blockedAmbiguous(`quarantine_blocked: ${q.reason}`);
//   // Re-run cleanup recursively (or fall through to git worktree remove now that worktree is clean).
//   const first = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
//   if (completed(first)) return { kind: "removed", reason: `quarantined ${q.count} files to ${q.backupBase}`, retried: false };
//   // existing retry path...
// }
```

**Verify:** `bun test tests/lifecycle/cleanup-quarantine.test.ts && bun test tests/lifecycle/cleanup-policy.test.ts && bun test tests/lifecycle/cleanup-classifier.test.ts`
**Commit:** `feat(lifecycle): quarantine lifecycle-owned untracked artifacts during cleanup`

---

### Task 2.3: commits.ts richer CommitOutcome failure classes
**File:** `src/lifecycle/commits.ts`
**Test:** `tests/lifecycle/commit-recovery.test.ts` (NEW)
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Attach a `recoveryHint` to each non-success `CommitOutcome` path. The committed-but-push-failed path gets `failureKind: "push_failed", recommendedNextAction: "retry_finish", safeToRetry: true`. The stage-failed and commit-failed paths get `failureKind: "unknown", recommendedNextAction: "ask_user"`. The nothing-to-commit path stays `committed=false, recoveryHint=undefined` (it is normal, not a failure).

Add `recoveryHint?: LifecycleRecoveryHint` to `CommitOutcome` in `types.ts` (already done as part of Task 2.1 if executed in order; otherwise add here). Wire it through `failureOutcome` / `retainedOutcome`.

```typescript
// tests/lifecycle/commit-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { commitAndPush } from "@/lifecycle/commits";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const FAIL = (e = "boom"): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

const runner = (handler: (args: readonly string[]) => RunResult): LifecycleRunner => ({
  git: async (args) => handler(args),
  gh: async () => OK(),
});

describe("commitAndPush recovery hints", () => {
  it("push_failed after retry attaches push_failed hint with safeToRetry=true", async () => {
    let pushAttempts = 0;
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return OK();
      if (k === "rev-parse HEAD") return OK("abc123\n");
      if (k.startsWith("push")) {
        pushAttempts += 1;
        return FAIL("network");
      }
      if (k.startsWith("diff-tree")) return OK();
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.pushed).toBe(false);
    expect(pushAttempts).toBe(2);
    expect(outcome.recoveryHint?.failureKind).toBe("push_failed");
    expect(outcome.recoveryHint?.safeToRetry).toBe(true);
    expect(outcome.recoveryHint?.issueNumber).toBe(67);
  });

  it("stage failure attaches unknown hint with safeToRetry=false", async () => {
    const r = runner((args) => {
      if (args[0] === "add") return FAIL("perm denied");
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("unknown");
    expect(outcome.recoveryHint?.recommendedNextAction).toBe("ask_user");
  });

  it("nothing-to-commit returns no hint (not a failure)", async () => {
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return { stdout: "nothing to commit", stderr: "", exitCode: 1 };
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.recoveryHint).toBeUndefined();
  });
});
```

```typescript
// In src/lifecycle/commits.ts:
import { buildHint, type LifecycleRecoveryHint } from "./recovery/hint";

// Replace failureOutcome / retainedOutcome to accept optional hint:
const failureOutcome = (note: string, hint?: LifecycleRecoveryHint): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note,
  recoveryHint: hint,
});

const retainedOutcome = (sha: string | null, retried: boolean, note: string, hint?: LifecycleRecoveryHint): CommitOutcome => ({
  committed: true,
  sha,
  pushed: false,
  retried,
  note,
  recoveryHint: hint,
});

// Where we currently return failureOutcome(noteFor(STAGING_FAILED_NOTE, staged)):
//   return failureOutcome(noteFor(STAGING_FAILED_NOTE, staged), buildHint({
//     failureKind: "unknown", recommendedNextAction: "ask_user",
//     summary: STAGING_FAILED_NOTE, issueNumber: input.issueNumber, branch: input.branch,
//   }));
// Same for COMMIT_FAILED_NOTE and SHA_FAILED_NOTE.
// In pushWithRetry retainedOutcome path:
//   return retainedOutcome(sha, true, noteFor(PUSH_FAILED_NOTE, retried), buildHint({
//     failureKind: "push_failed", recommendedNextAction: "retry_finish",
//     summary: noteFor(PUSH_FAILED_NOTE, retried),
//     issueNumber: input.issueNumber, branch: input.branch,
//     safeToRetry: true,
//   }));
```

**Verify:** `bun test tests/lifecycle/commit-recovery.test.ts && bun test tests/lifecycle/commits.test.ts`
**Commit:** `feat(lifecycle): attach recovery hints to commit/push failure outcomes`

---

### Task 2.4: resolver.ts stale candidates + ambiguous metadata
**File:** `src/lifecycle/resolver.ts`
**Test:** `tests/lifecycle/resolver-recovery.test.ts` (NEW)
**Depends:** 1.1, 1.3
**Domain:** backend
**Atlas-impact:** layer-update (20-behavior: ambiguous lifecycle now filters stale + supplies metadata)

Extend `ResolverResult.ambiguous` to carry `candidates: readonly LifecycleCandidateSummary[]` (rich shape from Task 1.1) instead of `readonly number[]`. Resolver's `current()` runs `classifyStale` from Task 1.3 against each open record using cheap git probes (no GitHub call required for the in-memory case). Stale records are removed from the active candidate list; if exactly one fresh record remains it becomes `kind: resolved`.

**Backwards compatibility:** keep a `numbers` getter on the ambiguous result for any caller that still wants flat numbers. Actually — the only consumer is `src/tools/lifecycle/current.ts` and `log-progress.ts`. They will be updated in Batch 3. So we can change the shape directly here and fix the call sites in Batch 3.

Add a new method `resolver.resolveExplicit(issueNumber)`: prefer local store; if missing, call `resume()` flow (issue body reconstruct); if the resulting record's branch / worktree probes classify as stale, throw a typed `StaleRecordError` so the tool layer can build `failureKind: "stale_record"`.

Add `forceRefresh(issueNumber)`: like resume but always re-reads issue body and overwrites local record. Used by Task 3.4.

```typescript
// tests/lifecycle/resolver-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { createResolver } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { LifecycleStore } from "@/lifecycle/store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const ok = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const fail = (e = ""): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

const mkRecord = (n: number, branch = `issue/${n}-x`, state = LIFECYCLE_STATES.IN_PROGRESS): LifecycleRecord => ({
  issueNumber: n,
  issueUrl: `https://github.com/o/r/issues/${n}`,
  branch,
  worktree: `/wt/${n}`,
  state,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [], [ARTIFACT_KINDS.PLAN]: [], [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [], [ARTIFACT_KINDS.PR]: [], [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [], updatedAt: 0,
});

const fakeStore = (records: readonly LifecycleRecord[], open: readonly number[]): LifecycleStore => {
  const map = new Map(records.map((r) => [r.issueNumber, r]));
  return {
    async save(r) { map.set(r.issueNumber, r); },
    async load(n) { return map.get(n) ?? null; },
    async delete(n) { map.delete(n); },
    async list() { return [...map.keys()].sort((a, b) => a - b); },
    async listOpen() { return [...open]; },
  };
};

describe("resolver.current with stale classification", () => {
  it("filters out stale records (branch merged, worktree missing) and resolves the single remaining", async () => {
    // 3 records open: #7 stale (branch merged), #9 stale (worktree missing), #67 fresh
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/67-x");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        if (k.startsWith("show-ref --verify --quiet refs/heads/issue/7-")) return ok();
        if (k.startsWith("merge-base --is-ancestor")) return ok(); // branch merged
        if (k.startsWith("show-ref --verify --quiet refs/heads/issue/9-")) return fail();
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(7), mkRecord(9), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [7, 9, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.record.issueNumber).toBe(67);
  });

  it("returns ambiguous with rich candidate metadata when 2+ fresh records remain and branch matches none", async () => {
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        if (k.startsWith("show-ref")) return ok();
        if (k.startsWith("merge-base --is-ancestor")) return fail(); // not merged
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(66), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [66, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].issueNumber).toBe(66);
      expect(result.candidates[0].stale).toBe(false);
    }
  });

  it("when current branch matches one record, resolves to it even if other records exist", async () => {
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/67-x");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(7), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [7, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.record.issueNumber).toBe(67);
  });
});
```

```typescript
// In src/lifecycle/resolver.ts — add types and methods:
import { classifyStale } from "./recovery/stale-classifier";
import type { LifecycleCandidateSummary } from "./recovery/hint";

export type ResolverResult =
  | { readonly kind: "resolved"; readonly record: LifecycleRecord }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly LifecycleCandidateSummary[] };

export class StaleRecordError extends Error {
  constructor(readonly summary: LifecycleCandidateSummary) {
    super(`stale_record: #${summary.issueNumber} ${summary.staleReason}`);
  }
}

export interface Resolver {
  readonly current: () => Promise<ResolverResult>;
  readonly resume: (issueNumber: number) => Promise<LifecycleRecord>;
  readonly forceRefresh: (issueNumber: number) => Promise<LifecycleRecord>;
  readonly resolveExplicit: (issueNumber: number) => Promise<LifecycleRecord>;
}

// probeStale(record): cheap git probes (show-ref, merge-base --is-ancestor, existsSync(worktree))
// produces StaleProbe and runs classifyStale. Builds LifecycleCandidateSummary.

// In current(): after branch-match resolution, build summaries for all open records using probeStale,
// drop terminal/stale ones; if 1 fresh remains -> resolved; else ambiguous with summaries.
```

**Verify:** `bun test tests/lifecycle/resolver-recovery.test.ts && bun test tests/lifecycle/resolver.test.ts`
**Commit:** `feat(lifecycle): resolver classifies stale records and exposes candidate metadata`

---

## Batch 3: Tool Surface Hint Emission (parallel - 5 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5

### Task 3.1: tools/lifecycle/finish.ts emits recovery hint section
**File:** `src/tools/lifecycle/finish.ts`
**Test:** `tests/lifecycle/finish-recovery.test.ts` (NEW)
**Depends:** 2.1, 1.2
**Domain:** backend
**Atlas-impact:** none

Wire `formatRecoveryHint` from Task 1.2 into `formatOutcome` AND the outer `catch (error)` branch. Every non-success markdown now ends with `### Recovery hint` block. Exception path builds an `unknown` hint with the error message as `summary`. Success path emits no hint.

```typescript
// tests/lifecycle/finish-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";
import { buildHint } from "@/lifecycle/recovery/hint";
import type { FinishOutcome, LifecycleHandle } from "@/lifecycle";

const fakeHandle = (outcome: FinishOutcome | Error): Pick<LifecycleHandle, "finish"> => ({
  finish: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
});

describe("lifecycle_finish tool recovery hint", () => {
  it("success outcome contains no `### Recovery hint` section", async () => {
    const tool = createLifecycleFinishTool(fakeHandle({
      merged: true, prUrl: null, closedAt: Date.now(), worktreeRemoved: true,
      cleanupOutcome: { kind: "removed", reason: "x", retried: false }, note: null,
    }));
    const md = await tool.execute({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, {});
    expect(md).not.toContain("### Recovery hint");
  });

  it("merge_conflict outcome contains recovery hint with conflict_files and worktree", async () => {
    const hint = buildHint({
      failureKind: "merge_conflict", recommendedNextAction: "resolve_conflicts",
      summary: "2 conflicts", issueNumber: 67, worktree: "/tmp/m",
      conflictFiles: ["a.ts", "b.ts"],
    });
    const tool = createLifecycleFinishTool(fakeHandle({
      merged: false, prUrl: null, closedAt: null, worktreeRemoved: false,
      cleanupOutcome: { kind: "failed", reason: "n/a", retried: false }, note: "merge_conflict",
      recoveryHint: hint,
    }));
    const md = await tool.execute({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, {});
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `merge_conflict`");
    expect(md).toContain("- `a.ts`");
  });

  it("exception path emits unknown hint with summary=error message", async () => {
    const tool = createLifecycleFinishTool(fakeHandle(new Error("boom")));
    const md = await tool.execute({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, {});
    expect(md).toContain("## Lifecycle finish failed");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `unknown`");
    expect(md).toContain("boom");
  });
});
```

```typescript
// In src/tools/lifecycle/finish.ts:
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";

const formatHintSuffix = (hint: LifecycleRecoveryHint | undefined): string => {
  if (!hint) return "";
  return `${LINE_BREAK}${LINE_BREAK}${formatRecoveryHint(hint)}`;
};

const formatReport = (header: string, table: string, note: string | null, hint?: LifecycleRecoveryHint): string => {
  return `${header}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(note)}${formatHintSuffix(hint)}`;
};

// In formatOutcome paths, pass outcome.recoveryHint as third arg to formatReport.
// In catch (error) branch:
//   const hint = buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: extractErrorMessage(error), issueNumber: args.issue_number });
//   return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}${LINE_BREAK}${LINE_BREAK}${formatRecoveryHint(hint)}`;
```

**Verify:** `bun test tests/lifecycle/finish-recovery.test.ts`
**Commit:** `feat(lifecycle): finish tool emits structured recovery hint section`

---

### Task 3.2: tools/lifecycle/commit.ts header fix + hint emission
**File:** `src/tools/lifecycle/commit.ts`
**Test:** `tests/lifecycle/commit-tool-recovery.test.ts` (NEW)
**Depends:** 2.3, 1.2
**Domain:** backend
**Atlas-impact:** none

Two fixes:
1. **Misleading header bug.** Today, when commit fails (`committed=false`) but no exception was thrown, the tool still renders `## Lifecycle commit recorded`. Classify and emit one of: `Lifecycle commit recorded` (committed && pushed), `Push failed (commit retained locally)` (committed && !pushed), `Nothing to commit` (!committed && !recoveryHint), `Lifecycle commit failed` (!committed && recoveryHint).
2. **Hint emission.** When `outcome.recoveryHint` is present, append the Recovery hint section. The catch branch also emits a hint.

```typescript
// tests/lifecycle/commit-tool-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleCommitTool } from "@/tools/lifecycle/commit";
import { buildHint } from "@/lifecycle/recovery/hint";
import type { CommitOutcome, LifecycleHandle } from "@/lifecycle";

const handle = (outcome: CommitOutcome | Error): Pick<LifecycleHandle, "commit"> => ({
  commit: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
});

const run = async (h: Pick<LifecycleHandle, "commit">) => {
  const tool = createLifecycleCommitTool(h);
  return tool.execute({ issue_number: 67, scope: "lifecycle", summary: "x", push: true }, {});
};

describe("lifecycle_commit tool header + recovery hint", () => {
  it("success: header is `Lifecycle commit recorded`", async () => {
    const md = await run(handle({ committed: true, sha: "abc", pushed: true, retried: false, note: null }));
    expect(md).toContain("## Lifecycle commit recorded");
    expect(md).not.toContain("### Recovery hint");
  });

  it("staging failure: header is `Lifecycle commit failed`, NOT `recorded`", async () => {
    const hint = buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "Staging failed" });
    const md = await run(handle({ committed: false, sha: null, pushed: false, retried: false, note: "Staging failed", recoveryHint: hint }));
    expect(md).toContain("## Lifecycle commit failed");
    expect(md).not.toContain("## Lifecycle commit recorded");
    expect(md).toContain("### Recovery hint");
  });

  it("push failed but commit retained: header is `Push failed (commit retained locally)`", async () => {
    const hint = buildHint({ failureKind: "push_failed", recommendedNextAction: "retry_finish", summary: "net err", safeToRetry: true });
    const md = await run(handle({ committed: true, sha: "abc", pushed: false, retried: true, note: "Push failed", recoveryHint: hint }));
    expect(md).toContain("## Push failed (commit retained locally)");
    expect(md).toContain("**safe_to_retry:** `true`");
  });

  it("nothing-to-commit: header is `Nothing to commit`, no hint", async () => {
    const md = await run(handle({ committed: false, sha: null, pushed: false, retried: false, note: null }));
    expect(md).toContain("## Nothing to commit");
    expect(md).not.toContain("### Recovery hint");
  });

  it("exception: header is `Lifecycle commit failed`, contains hint", async () => {
    const md = await run(handle(new Error("explode")));
    expect(md).toContain("## Lifecycle commit failed");
    expect(md).toContain("### Recovery hint");
  });
});
```

```typescript
// In src/tools/lifecycle/commit.ts:
const NOTHING_TO_COMMIT_HEADER = "## Nothing to commit";

const formatOutcome = (issueNumber: number, outcome: CommitOutcome): string => {
  const table = formatTable(issueNumber, outcome);
  const hintSuffix = outcome.recoveryHint
    ? `${LINE_BREAK}${LINE_BREAK}${formatRecoveryHint(outcome.recoveryHint)}`
    : "";

  if (outcome.committed && outcome.pushed)
    return `${SUCCESS_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
  if (outcome.committed && !outcome.pushed)
    return `${PUSH_FAILED_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
  if (!outcome.committed && outcome.recoveryHint === undefined)
    return `${NOTHING_TO_COMMIT_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}`;
  return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
};
// catch (error) branch: append formatRecoveryHint(buildHint({ failureKind: "unknown", ... }))
```

**Verify:** `bun test tests/lifecycle/commit-tool-recovery.test.ts && bun test tests/lifecycle/commits.test.ts`
**Commit:** `fix(lifecycle): commit tool header no longer claims success on failure`

---

### Task 3.3: tools/lifecycle/current.ts emits candidate metadata + ambiguous hint
**File:** `src/tools/lifecycle/current.ts`
**Test:** `tests/lifecycle/current-recovery.test.ts` (NEW)
**Depends:** 2.4, 1.2
**Domain:** backend
**Atlas-impact:** none

Adapt to new `ResolverResult.ambiguous.candidates: LifecycleCandidateSummary[]`. Ambiguous output now includes (a) the existing candidate table for human readability and (b) the structured `### Recovery hint` section with full candidate metadata, so primary agents can decide what to do.

```typescript
// tests/lifecycle/current-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";

describe("lifecycle_current ambiguous output", () => {
  it("emits Recovery hint with candidate table when ambiguous", async () => {
    const tool = createLifecycleCurrentTool({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          { issueNumber: 7, branch: "issue/7-a", worktree: null, state: "branch_ready", stale: true, staleReason: "branch_merged" },
          { issueNumber: 67, branch: "issue/67-b", worktree: "/wt", state: "in_progress", stale: false, staleReason: null },
        ],
      }),
    });
    const md = await tool.execute({}, {});
    expect(md).toContain("## Ambiguous active lifecycle");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `ambiguous_lifecycle`");
    expect(md).toContain("| 7 | `issue/7-a` | `-` | `branch_ready` | `true` | branch_merged |");
    expect(md).toContain("| 67 | `issue/67-b` | `/wt` | `in_progress` | `false` | - |");
  });

  it("resolved output contains no Recovery hint", async () => {
    const tool = createLifecycleCurrentTool({
      current: async () => ({
        kind: "resolved",
        record: {
          issueNumber: 67, issueUrl: "", branch: "issue/67-x", worktree: "/wt",
          state: "in_progress" as const, artifacts: {} as never, notes: [], updatedAt: 0,
        },
      }),
    });
    const md = await tool.execute({}, {});
    expect(md).not.toContain("### Recovery hint");
  });
});
```

```typescript
// In src/tools/lifecycle/current.ts formatAmbiguous():
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";

const formatAmbiguous = (result: Extract<ResolverResult, { kind: "ambiguous" }>): string => {
  const lines = result.candidates.map(
    (c) => `- #${c.issueNumber} \`${c.branch ?? "-"}\` state=\`${c.state}\` stale=\`${c.stale}\``,
  );
  const recommendedAction = result.candidates.some((c) => c.stale)
    ? "clean_stale_records"
    : "ask_user";
  const hint = buildHint({
    failureKind: "ambiguous_lifecycle",
    recommendedNextAction: recommendedAction,
    summary: `${result.candidates.length} candidate lifecycle(s); ${result.candidates.filter((c) => c.stale).length} stale`,
    candidates: result.candidates,
  });
  return `${AMBIGUOUS_HEADER}${DOUBLE_LINE_BREAK}${lines.join(LINE_BREAK)}${DOUBLE_LINE_BREAK}${formatRecoveryHint(hint)}`;
};
```

**Verify:** `bun test tests/lifecycle/current-recovery.test.ts`
**Commit:** `feat(lifecycle): current tool exposes candidate metadata + ambiguous hint`

---

### Task 3.4: tools/lifecycle/resume.ts force-refresh + stale handling
**File:** `src/tools/lifecycle/resume.ts`
**Test:** `tests/lifecycle/resume-recovery.test.ts` (NEW)
**Depends:** 2.4
**Domain:** backend
**Atlas-impact:** none

Accept an optional `force_refresh: boolean` flag. When true, call `resolver.forceRefresh(issueNumber)` (Task 2.4) which bypasses local store cache and reconstructs from GitHub issue body. On `StaleRecordError`, return `## lifecycle_resume failed` with a `stale_record` recovery hint listing the staleness reason.

```typescript
// tests/lifecycle/resume-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleResumeTool } from "@/tools/lifecycle/resume";
import { StaleRecordError } from "@/lifecycle/resolver";

describe("lifecycle_resume tool", () => {
  it("calls forceRefresh when force_refresh=true", async () => {
    let forced = false;
    const tool = createLifecycleResumeTool({
      resume: async () => { throw new Error("should not be called"); },
      forceRefresh: async () => {
        forced = true;
        return {
          issueNumber: 67, issueUrl: "", branch: "issue/67-x", worktree: "/wt",
          state: "in_progress" as const, artifacts: {} as never, notes: [], updatedAt: 0,
        };
      },
    });
    const md = await tool.execute({ issue_number: 67, force_refresh: true }, {});
    expect(forced).toBe(true);
    expect(md).toContain("## Lifecycle resumed");
  });

  it("StaleRecordError -> stale_record recovery hint", async () => {
    const tool = createLifecycleResumeTool({
      resume: async () => {
        throw new StaleRecordError({
          issueNumber: 7, branch: "issue/7-a", worktree: null, state: "branch_ready",
          stale: true, staleReason: "issue_closed_on_github",
        });
      },
      forceRefresh: async () => { throw new Error("nope"); },
    });
    const md = await tool.execute({ issue_number: 7 }, {});
    expect(md).toContain("## lifecycle_resume failed");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `stale_record`");
    expect(md).toContain("issue_closed_on_github");
  });
});
```

```typescript
// In src/tools/lifecycle/resume.ts:
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";
import { StaleRecordError } from "@/lifecycle/resolver";

args: {
  issue_number: tool.schema.number().describe("..."),
  force_refresh: tool.schema.boolean().optional().describe("Bypass local cache; reconstruct from issue body"),
},
execute: async (args) => {
  try {
    const issueNumber = args.issue_number;
    const record = args.force_refresh
      ? await resolver.forceRefresh(issueNumber)
      : await resolver.resume(issueNumber);
    return formatRecord(record);
  } catch (error) {
    if (error instanceof StaleRecordError) {
      const hint = buildHint({
        failureKind: "stale_record",
        recommendedNextAction: "clean_stale_records",
        summary: error.summary.staleReason ?? "stale",
        issueNumber: error.summary.issueNumber,
        branch: error.summary.branch,
        worktree: error.summary.worktree,
        candidates: [error.summary],
      });
      return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${error.message}${DOUBLE_LINE_BREAK}${formatRecoveryHint(hint)}`;
    }
    return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
  }
},
```

**Verify:** `bun test tests/lifecycle/resume-recovery.test.ts`
**Commit:** `feat(lifecycle): resume tool gains force_refresh and stale_record hint`

---

### Task 3.5: tools/lifecycle/recovery-decision.ts hint passthrough
**File:** `src/tools/lifecycle/recovery-decision.ts`
**Test:** `tests/lifecycle/recovery-decision-tool.test.ts` (NEW)
**Depends:** 1.1, 1.2
**Domain:** backend
**Atlas-impact:** none

When `decideRecovery` returns `kind: "blocked"`, append a recovery hint suggesting `ask_user`. This keeps the tool surface consistent so prompts can parse all lifecycle tool outputs uniformly.

```typescript
// tests/lifecycle/recovery-decision-tool.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";

describe("lifecycle_recovery_decision tool", () => {
  it("appends recovery hint when decision is blocked", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => ({
        kind: "blocked",
        lastSeq: 5,
        reason: "lease_conflict",
        detail: "another owner holds the lease",
      }),
    });
    const md = await tool.execute({ issue_number: 67, owner: "test-session" }, {});
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `unknown`");
    expect(md).toContain("**recommended_next_action:** `ask_user`");
    expect(md).toContain("lease_conflict");
  });

  it("clean_resume contains no hint", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => ({ kind: "clean_resume", lastSeq: 5, nextBatchId: "b2" }),
    });
    const md = await tool.execute({ issue_number: 67, owner: "test-session" }, {});
    expect(md).not.toContain("### Recovery hint");
  });
});
```

```typescript
// In src/tools/lifecycle/recovery-decision.ts formatDecision():
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";

const formatDecision = (decision: RecoveryDecision, issueNumber: number): string => {
  // existing body...
  if (decision.kind === "blocked") {
    const hint = buildHint({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      summary: `${decision.reason}: ${decision.detail}`,
      issueNumber,
    });
    return [SUCCESS_HEADER, "", ...lines, "", formatRecoveryHint(hint)].join(LINE_BREAK);
  }
  return [SUCCESS_HEADER, "", ...lines].join(LINE_BREAK);
};
```

**Verify:** `bun test tests/lifecycle/recovery-decision-tool.test.ts`
**Commit:** `feat(lifecycle): recovery_decision tool emits hint for blocked outcomes`

---

## Batch 4: Prompts and AGENTS.md Mirror (parallel - 5 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5

### Task 4.1: brainstormer.ts bounded recovery loop
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer-lifecycle-recovery.test.ts` (NEW)
**Depends:** 3.1, 3.2
**Domain:** general (agent-prompt)
**Atlas-impact:** layer-update (20-behavior: brainstormer lifecycle phase now uses bounded recovery)

Replace the `<rule>Single attempt per call. Do not retry on failure; surface the tool's note and halt.</rule>` line (currently around line 338) with a `<bounded-recovery-loop>` block. New rule: when a lifecycle tool reports a non-success outcome with a `### Recovery hint` section, the brainstormer reads `recommended_next_action`, attempts at most 3 recovery rounds following the action mapping, then halts.

Required textual additions inside `<lifecycle>` block:

```xml
<bounded-recovery-loop priority="HIGH">
<rule>If any lifecycle_* tool response contains a `### Recovery hint` section, you MUST attempt bounded recovery (max 3 rounds total) before surfacing failure to the user.</rule>
<rule>Each round: parse `failure_kind` and `recommended_next_action` from the hint, take the matching action, then re-invoke the original lifecycle tool with the SAME arguments. Stop on success, or on a hint with `safe_to_retry: false` and `recommended_next_action: ask_user`.</rule>

<action-map>
  <map kind="ambiguous_lifecycle" action="clean_stale_records">For each candidate with `stale: true`, call lifecycle_resume(issue_number=N, force_refresh=true) to refresh that record's state; then retry the original tool. If multiple non-stale candidates remain, surface to user.</map>
  <map kind="stale_record" action="clean_stale_records">Call lifecycle_resume(issue_number=N, force_refresh=true). On success retry the original tool.</map>
  <map kind="record_missing" action="resume_issue">Call lifecycle_resume(issue_number=N). On success retry the original tool.</map>
  <map kind="invalid_issue_number" action="ask_user">Halt and ask user.</map>
  <map kind="dirty_base_worktree" action="use_temp_merge_worktree">The tool already uses temp worktrees automatically. If the hint says the temp creation itself failed, report and halt.</map>
  <map kind="merge_conflict" action="resolve_conflicts">The hint includes `worktree` (temp path) and `conflict_files`. Tell the user the temp worktree path and the conflict files. Do NOT auto-resolve. Halt with a clear next-step description.</map>
  <map kind="untracked_cleanup_blocker" action="quarantine_artifacts">The tool already quarantines automatically when paths are lifecycle-owned. If the hint surfaces, it means an unknown untracked file is blocking. Halt and ask user.</map>
  <map kind="tracked_cleanup_blocker" action="ask_user">Tracked dirty changes mean user work. Halt and ask user.</map>
  <map kind="pr_checks_failed" action="ask_user">CI failed; halt and surface URL.</map>
  <map kind="push_failed" action="retry_finish">Wait briefly (the tool already retried once); retry the original tool. After 3 rounds, halt.</map>
  <map kind="unknown" action="ask_user">Halt and ask user with the summary.</map>
</action-map>

<rule>Maximum 3 recovery rounds per top-level lifecycle invocation. After 3, halt regardless.</rule>
<rule>NEVER call git push --force, git push --force-with-lease, git --no-verify, or git reset --hard during recovery.</rule>
<rule>NEVER restart OpenCode as part of recovery.</rule>
<rule>NEVER delete user files. Only the tools may move lifecycle-owned untracked artifacts to quarantine; the agent never invokes rm / fs deletes.</rule>
</bounded-recovery-loop>
```

Also delete the obsolete line `<rule>Single attempt per call. Do not retry on failure; surface the tool's note and halt.</rule>`.

```typescript
// tests/agents/brainstormer-lifecycle-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";

describe("brainstormer lifecycle recovery prompt", () => {
  it("does NOT contain the legacy single-attempt halt rule", () => {
    expect(BRAINSTORMER_PROMPT).not.toContain("Single attempt per call. Do not retry on failure");
  });

  it("contains the bounded-recovery-loop block", () => {
    expect(BRAINSTORMER_PROMPT).toContain("<bounded-recovery-loop");
    expect(BRAINSTORMER_PROMPT).toContain("Maximum 3 recovery rounds");
  });

  it("explicitly forbids force push, --no-verify, reset --hard during recovery", () => {
    expect(BRAINSTORMER_PROMPT).toContain("--force");
    expect(BRAINSTORMER_PROMPT).toContain("--no-verify");
    expect(BRAINSTORMER_PROMPT).toContain("reset --hard");
  });

  it("explicitly forbids restarting OpenCode during recovery", () => {
    expect(BRAINSTORMER_PROMPT).toContain("NEVER restart OpenCode as part of recovery");
  });

  it("maps each failure_kind to an action", () => {
    for (const kind of [
      "ambiguous_lifecycle", "stale_record", "record_missing", "invalid_issue_number",
      "dirty_base_worktree", "merge_conflict", "untracked_cleanup_blocker",
      "tracked_cleanup_blocker", "pr_checks_failed", "push_failed", "unknown",
    ]) {
      expect(BRAINSTORMER_PROMPT).toContain(`kind="${kind}"`);
    }
  });
});
```

**Verify:** `bun test tests/agents/brainstormer-lifecycle-recovery.test.ts && bun test tests/agents/brainstormer.test.ts`
**Commit:** `feat(agents): brainstormer adopts bounded lifecycle recovery loop`

---

### Task 4.2: planner.ts ambiguous lifecycle handling
**File:** `src/agents/planner.ts`
**Test:** `tests/agents/planner-lifecycle-recovery.test.ts` (NEW)
**Depends:** 3.3, 3.4
**Domain:** general (agent-prompt)
**Atlas-impact:** none

Replace the existing planner action `If kind=ambiguous, surface the candidates to the user and stop.` (around line 196) with: read the `### Recovery hint`; if all candidates are stale or all but one are stale, call `lifecycle_resume(force_refresh=true)` once for each stale candidate to settle them, then retry `lifecycle_current`. If still ambiguous, surface to user. Max 2 recovery rounds (planner is not a primary lifecycle agent — brainstormer owns the deeper loop).

Also: the planner's lifecycle phase currently calls `lifecycle_commit` once; on recovery hint `push_failed safe_to_retry=true`, retry once. On any other hint, surface and continue (planner's job is to write the plan, not own commit).

```typescript
// tests/agents/planner-lifecycle-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { PLANNER_PROMPT } from "@/agents/planner";

describe("planner lifecycle recovery prompt", () => {
  it("references the Recovery hint section explicitly", () => {
    expect(PLANNER_PROMPT).toContain("### Recovery hint");
  });

  it("documents the bounded retry (max 2 rounds for planner)", () => {
    expect(PLANNER_PROMPT).toMatch(/max(imum)? 2 recovery (round|attempt)/i);
  });

  it("handles ambiguous lifecycle by calling lifecycle_resume on stale candidates", () => {
    expect(PLANNER_PROMPT).toContain("force_refresh");
    expect(PLANNER_PROMPT).toContain("stale");
  });

  it("forbids force push / --no-verify / reset --hard", () => {
    expect(PLANNER_PROMPT).toContain("--force");
    expect(PLANNER_PROMPT).toContain("--no-verify");
  });
});
```

Replace the planner's lifecycle output phase rule with:

```xml
<phase name="output">
  ...
  <action>Call lifecycle_current.
    - kind=resolved: call lifecycle_commit(issue_number, scope, summary). On `### Recovery hint` with failure_kind=push_failed and safe_to_retry=true, retry once.
    - kind=ambiguous: read the hint. For each candidate with stale=true, call lifecycle_resume(issue_number=N, force_refresh=true) once. Then retry lifecycle_current. Maximum 2 recovery rounds; if still ambiguous, surface candidates to user and stop (do not write a plan against the wrong issue).
    - kind=none: leave the plan uncommitted.
  </action>
  <rule>NEVER push --force, --force-with-lease, --no-verify, or reset --hard during planner recovery.</rule>
</phase>
```

**Verify:** `bun test tests/agents/planner-lifecycle-recovery.test.ts && bun test tests/agents/planner.test.ts`
**Commit:** `feat(agents): planner bounded recovery for ambiguous lifecycle`

---

### Task 4.3: executor.ts commit/finish recovery reporting
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-lifecycle-recovery.test.ts` (NEW)
**Depends:** 3.1, 3.2
**Domain:** general (agent-prompt)
**Atlas-impact:** layer-update (20-behavior: executor recovery reporting)

Currently around line 404: `If lifecycle_commit fails, include the failure note in the final report and exit; do not block subsequent runs.`

Update to: read `### Recovery hint`. For `push_failed safe_to_retry=true`, retry `lifecycle_commit` once. For any other failure, include the structured hint summary (failure_kind, recommended_next_action) in the final report so brainstormer can pick up recovery. Executor itself does NOT call `lifecycle_finish`; that stays with brainstormer.

```typescript
// tests/agents/executor-lifecycle-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { EXECUTOR_PROMPT } from "@/agents/executor";

describe("executor lifecycle recovery prompt", () => {
  it("references the Recovery hint section", () => {
    expect(EXECUTOR_PROMPT).toContain("### Recovery hint");
  });

  it("documents the single retry for push_failed safe_to_retry", () => {
    expect(EXECUTOR_PROMPT).toContain("push_failed");
    expect(EXECUTOR_PROMPT).toContain("safe_to_retry");
  });

  it("keeps the rule that executor never calls lifecycle_finish", () => {
    expect(EXECUTOR_PROMPT).toContain("Never call lifecycle_finish");
  });

  it("propagates hint summary to final report so brainstormer can recover", () => {
    expect(EXECUTOR_PROMPT).toMatch(/include.*hint.*final report/i);
  });
});
```

Concrete prompt edits to `<lifecycle-commit>` block (around line 388-410):

```xml
<rule>If lifecycle_commit returns a `### Recovery hint`:
  - failure_kind=push_failed AND safe_to_retry=true: retry lifecycle_commit ONCE with the same arguments. Stop if it succeeds.
  - any other failure_kind: do NOT retry. Include the failure_kind, recommended_next_action, and summary verbatim in the final report so the brainstormer can run its bounded recovery loop.
</rule>
<rule>Never call lifecycle_finish. That is the brainstormer's responsibility.</rule>
<rule>NEVER push --force, --force-with-lease, --no-verify, or reset --hard during executor recovery.</rule>
```

**Verify:** `bun test tests/agents/executor-lifecycle-recovery.test.ts && bun test tests/agents/executor.test.ts`
**Commit:** `feat(agents): executor reports lifecycle recovery hints to brainstormer`

---

### Task 4.4: commander.ts operational merge/recovery summary
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander-lifecycle-recovery.test.ts` (NEW)
**Depends:** 3.1, 3.2
**Domain:** general (agent-prompt)
**Atlas-impact:** none

Commander handles direct user "do operational lifecycle" requests (merge this issue, finish, etc.). Add a bounded recovery loop block mirroring brainstormer's but scoped to commander's quick-op routing. Specifically, when the user says "merge issue #N" / "finish #N", commander calls `lifecycle_finish(N)` and on recovery hint follows the same action map (max 3 rounds).

Also: when the user reports the `Ambiguous active lifecycle` symptom (this issue's user-facing trigger), commander now follows the hint instead of returning the candidate list raw.

```typescript
// tests/agents/commander-lifecycle-recovery.test.ts
import { describe, expect, it } from "bun:test";

import { COMMANDER_PROMPT } from "@/agents/commander";

describe("commander lifecycle recovery prompt", () => {
  it("documents bounded recovery loop", () => {
    expect(COMMANDER_PROMPT).toContain("bounded-recovery-loop");
  });

  it("forbids force push and reset --hard in recovery", () => {
    expect(COMMANDER_PROMPT).toContain("--force");
    expect(COMMANDER_PROMPT).toContain("reset --hard");
  });

  it("handles ambiguous lifecycle via lifecycle_resume force_refresh of stale candidates", () => {
    expect(COMMANDER_PROMPT).toContain("force_refresh");
  });

  it("maximum 3 recovery rounds", () => {
    expect(COMMANDER_PROMPT).toMatch(/(maximum|max) 3 recovery (round|attempt)/i);
  });
});
```

Insert a `<bounded-recovery-loop>` block matching Task 4.1's content (verbatim where possible — drift guard test will be added in 5.2).

**Verify:** `bun test tests/agents/commander-lifecycle-recovery.test.ts && bun test tests/agents/commander.test.ts`
**Commit:** `feat(agents): commander adopts bounded lifecycle recovery loop`

---

### Task 4.5: AGENTS.md mirror — lifecycle recovery section
**File:** `AGENTS.md`
**Test:** `tests/agents/agents-md-lifecycle-recovery.test.ts` (NEW)
**Depends:** 4.1, 4.2, 4.3, 4.4
**Domain:** general
**Atlas-impact:** layer-update (40-decisions: bounded lifecycle recovery is now project policy)

Add a new section `## Autonomous Lifecycle Recovery` to `/root/CODE/issue-67-lifecycle-finish-commit-ai-ambiguous-stale-merge/AGENTS.md` (after the existing `## Project Memory Active Maintenance` section, before `## Knowledge Bootstrap Commands`). Section content: short description of the bounded recovery contract, the action map summary table, hard safety rules (no force push, no --no-verify, no reset --hard on main worktree, no auto-delete, no auto-restart), and a drift guard pointer to the prompt source.

The mirror must include all 11 `failure_kind` strings and all 7 `recommended_next_action` strings verbatim so it can be grep-asserted.

```typescript
// tests/agents/agents-md-lifecycle-recovery.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const AGENTS_MD = readFileSync("AGENTS.md", "utf8");

describe("AGENTS.md lifecycle recovery mirror", () => {
  it("contains the Autonomous Lifecycle Recovery section", () => {
    expect(AGENTS_MD).toContain("## Autonomous Lifecycle Recovery");
  });

  it("lists all 11 failure_kind values", () => {
    for (const k of [
      "ambiguous_lifecycle", "stale_record", "record_missing", "invalid_issue_number",
      "dirty_base_worktree", "merge_conflict", "untracked_cleanup_blocker",
      "tracked_cleanup_blocker", "pr_checks_failed", "push_failed", "unknown",
    ]) {
      expect(AGENTS_MD).toContain(k);
    }
  });

  it("lists all 7 recommended_next_action values", () => {
    for (const a of [
      "resume_issue", "clean_stale_records", "retry_finish",
      "use_temp_merge_worktree", "resolve_conflicts", "quarantine_artifacts", "ask_user",
    ]) {
      expect(AGENTS_MD).toContain(a);
    }
  });

  it("states the hard safety rules verbatim", () => {
    expect(AGENTS_MD).toContain("no force push");
    expect(AGENTS_MD).toContain("--no-verify");
    expect(AGENTS_MD).toContain("reset --hard");
    expect(AGENTS_MD).toContain("auto-restart");
  });

  it("points to the prompt single-source via drift guard", () => {
    expect(AGENTS_MD).toMatch(/Drift guard.*brainstormer\.ts/);
  });
});
```

Concrete markdown to insert in `AGENTS.md`:

```markdown
## Autonomous Lifecycle Recovery

Lifecycle 工具（`lifecycle_finish` / `lifecycle_commit` / `lifecycle_current` / `lifecycle_resume` / `lifecycle_recovery_decision`）在失败时输出结构化 `### Recovery hint` 段。primary agent（brainstormer / commander）按 hint 在最多 3 轮内自主恢复；planner / executor 在自身职责范围内最多 2 轮。

### Failure kinds and recommended actions

| failure_kind | recommended_next_action | 含义 |
|---|---|---|
| `ambiguous_lifecycle` | `clean_stale_records` / `ask_user` | 多个 active lifecycle，按 stale 标记分流 |
| `stale_record` | `clean_stale_records` | record 与 GitHub / 仓库现状脱节 |
| `record_missing` | `resume_issue` | 本地缺记录，从 issue body 重建 |
| `invalid_issue_number` | `ask_user` | 编号非法或无法归一 |
| `dirty_base_worktree` | `use_temp_merge_worktree` | 主 worktree dirty，工具已切临时 worktree |
| `merge_conflict` | `resolve_conflicts` | 临时 worktree 内冲突待人工或 AI 解决 |
| `untracked_cleanup_blocker` | `quarantine_artifacts` / `ask_user` | 未跟踪文件分类归属 |
| `tracked_cleanup_blocker` | `ask_user` | tracked 改动疑似用户作品 |
| `pr_checks_failed` | `ask_user` | CI 失败，需要改代码 |
| `push_failed` | `retry_finish` | 网络/竞争，允许有界重试 |
| `unknown` | `ask_user` | 工具未能归类 |

### Hard safety rules (no exceptions during recovery)

- 不 force push，禁止 `git push --force` / `--force-with-lease`。
- 不跳过 git hooks，禁止 `--no-verify`。
- 不对主 worktree 执行 `git reset --hard`。
- 不自动删除用户文件；只能 quarantine 明确归属 lifecycle 的 untracked artifacts 到 `thoughts/lifecycle/backups/issue-<N>/...`。
- 不自动重启 OpenCode。
- bounded recovery 最多 3 轮（primary）/ 2 轮（planner、executor）；超过即 halt。

### Drift guard

`src/agents/brainstormer.ts` 与 `src/agents/commander.ts` 的 `<bounded-recovery-loop>` 块是单源；`src/agents/planner.ts` 与 `src/agents/executor.ts` 的相应规则与之语义对齐但裁剪到本职范围。本节是 markdown 镜像，drift 由 `tests/agents/agents-md-lifecycle-recovery.test.ts` 强制。
```

**Verify:** `bun test tests/agents/agents-md-lifecycle-recovery.test.ts`
**Commit:** `docs(agents): mirror bounded lifecycle recovery contract in AGENTS.md`

---

## Batch 5: Cross-Cutting Safety Regression Tests (parallel - 3 implementers)

All tasks in this batch depend on Batch 4 completing.
Tasks: 5.1, 5.2, 5.3

### Task 5.1: Safety boundary regression test (forbidden commands never run)
**File:** `tests/lifecycle/recovery-safety-boundary.test.ts` (NEW)
**Test:** `tests/lifecycle/recovery-safety-boundary.test.ts` (NEW; this IS the test file)
**Depends:** 2.1, 2.2, 2.3, 2.4
**Domain:** general (test)
**Atlas-impact:** new-node (50-risks: codified safety invariants for autonomous recovery)

Single, focused integration test that drives `finishLifecycle` and `commitAndPush` through several recovery scenarios (clean success, merge conflict, push retry, ambiguous + stale, untracked quarantine, untracked unknown blocker) with a recording runner. Asserts that across ALL scenarios:

- Zero invocations of `git push --force` / `--force-with-lease`
- Zero invocations of `--no-verify`
- Zero invocations of `git reset --hard` against `cwd` (main worktree)
- Zero invocations of `rm -rf` / direct file deletion calls
- No `process.exit` / OpenCode restart / `systemctl restart` shell calls
- All quarantine ops are `fs.rename`, never `fs.unlink` / `fs.rm`

This is a meta-test that runs ALL the recovery paths back-to-back with a single recording runner and then asserts global invariants on the captured call log.

```typescript
// tests/lifecycle/recovery-safety-boundary.test.ts
import { describe, expect, it } from "bun:test";

import { commitAndPush } from "@/lifecycle/commits";
import { finishLifecycle } from "@/lifecycle/merge";
import { runCleanup } from "@/lifecycle/cleanup-policy";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const FAIL = (e = "err"): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

interface Call { readonly bin: "git" | "gh"; readonly args: readonly string[]; readonly cwd: string | undefined; }

const FORBIDDEN_TOKENS = ["--force", "--force-with-lease", "--no-verify"] as const;
const FORBIDDEN_FULL_COMMANDS = [
  "reset --hard",
  "push --force",
] as const;

const recorder = (): { runner: LifecycleRunner; calls: Call[]; fsDeletes: string[]; fsRenames: string[] } => {
  const calls: Call[] = [];
  const fsDeletes: string[] = [];
  const fsRenames: string[] = [];
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ bin: "git", args, cwd: opts?.cwd });
      const k = args.join(" ");
      if (k === "rev-parse HEAD") return OK("sha\n");
      if (k.startsWith("status --porcelain")) return OK();
      if (k.startsWith("ls-files --others")) return OK();
      if (k.startsWith("worktree list")) return OK("worktree /r/wt\n");
      return OK();
    },
    gh: async (args, opts) => {
      calls.push({ bin: "gh", args, cwd: opts?.cwd });
      return OK("[]");
    },
  };
  return { runner, calls, fsDeletes, fsRenames };
};

describe("recovery safety boundary", () => {
  it("never invokes --force / --force-with-lease / --no-verify in any recovery path", async () => {
    const r = recorder();
    // Drive multiple paths
    await commitAndPush(r.runner, { cwd: "/r", issueNumber: 67, branch: "issue/67-x", type: "feat", scope: "lifecycle", summary: "s", push: true });
    await finishLifecycle(r.runner, { cwd: "/r", branch: "issue/67-x", worktree: "/r/wt", mergeStrategy: "local-merge", waitForChecks: false, baseBranch: "main" });

    for (const call of r.calls) {
      const flat = call.args.join(" ");
      for (const tok of FORBIDDEN_TOKENS) {
        expect(flat.includes(tok)).toBe(false);
      }
      for (const cmd of FORBIDDEN_FULL_COMMANDS) {
        expect(flat.includes(cmd)).toBe(false);
      }
    }
  });

  it("local merge never runs `git checkout <base>` in the main worktree (always in temp)", async () => {
    const r = recorder();
    await finishLifecycle(r.runner, { cwd: "/r", branch: "issue/67-x", worktree: "/r/wt", mergeStrategy: "local-merge", waitForChecks: false, baseBranch: "main" });
    const mainCwdCheckouts = r.calls.filter((c) => c.cwd === "/r" && c.args[0] === "checkout");
    expect(mainCwdCheckouts).toEqual([]);
  });

  it("cleanup quarantine uses fs.rename only, never fs.unlink/fs.rm", async () => {
    const r = recorder();
    await runCleanup(r.runner, {
      cwd: "/r", worktree: "/r/wt", branch: "issue/67-x", baseBranch: "main",
      issueClosed: true, branchMerged: true, issueNumber: 67, artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: {
        mkdir: () => undefined,
        rename: (from, to) => r.fsRenames.push(`${from}=>${to}`),
        // No unlink / rm capability exposed at all
      } as any,
    });
    // fsDeletes intentionally never populated — there is no API to populate it
    expect(r.fsDeletes).toEqual([]);
  });

  it("no shell call attempts to restart OpenCode or systemctl", async () => {
    // Lifecycle code uses runner.git / runner.gh only; spawn outside them would surface here.
    // This test documents the invariant.
    const r = recorder();
    await finishLifecycle(r.runner, { cwd: "/r", branch: "issue/67-x", worktree: "/r/wt", mergeStrategy: "local-merge", waitForChecks: false, baseBranch: "main" });
    expect(r.calls.every((c) => c.bin === "git" || c.bin === "gh")).toBe(true);
  });
});
```

**Verify:** `bun test tests/lifecycle/recovery-safety-boundary.test.ts`
**Commit:** `test(lifecycle): codify safety boundary invariants for autonomous recovery`

---

### Task 5.2: Cross-agent prompt drift guard
**File:** `tests/agents/lifecycle-recovery-prompt.test.ts` (NEW)
**Test:** `tests/agents/lifecycle-recovery-prompt.test.ts` (this IS the test file)
**Depends:** 4.1, 4.2, 4.3, 4.4, 4.5
**Domain:** general (test)
**Atlas-impact:** none

Single drift-guard test asserting:

- `BRAINSTORMER_PROMPT` and `COMMANDER_PROMPT` both contain a `<bounded-recovery-loop>` block.
- The `<action-map>` blocks in `BRAINSTORMER_PROMPT` and `COMMANDER_PROMPT` are byte-identical between the two prompts (drift guard).
- `PLANNER_PROMPT` and `EXECUTOR_PROMPT` contain the smaller "max 2 round" rule.
- All four prompts contain the literal safety strings `--force`, `--no-verify`, `reset --hard`.
- The legacy `Single attempt per call. Do not retry on failure; surface the tool's note and halt.` rule is NOT present in any of brainstormer / planner / executor / commander.

```typescript
// tests/agents/lifecycle-recovery-prompt.test.ts
import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";
import { EXECUTOR_PROMPT } from "@/agents/executor";
import { PLANNER_PROMPT } from "@/agents/planner";

const ACTION_MAP_RE = /<action-map>([\s\S]*?)<\/action-map>/;

describe("lifecycle recovery prompt drift guard", () => {
  it("brainstormer and commander both expose <bounded-recovery-loop>", () => {
    expect(BRAINSTORMER_PROMPT).toContain("<bounded-recovery-loop");
    expect(COMMANDER_PROMPT).toContain("<bounded-recovery-loop");
  });

  it("brainstormer and commander <action-map> blocks are byte-identical", () => {
    const a = ACTION_MAP_RE.exec(BRAINSTORMER_PROMPT)?.[1];
    const b = ACTION_MAP_RE.exec(COMMANDER_PROMPT)?.[1];
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).toBe(b);
  });

  it("planner uses max 2 recovery rounds (its narrower scope)", () => {
    expect(PLANNER_PROMPT).toMatch(/max(imum)? 2 recovery (round|attempt)/i);
  });

  it("executor reports lifecycle recovery hints in final report (no own loop)", () => {
    expect(EXECUTOR_PROMPT).toMatch(/include.*hint.*final report/i);
    expect(EXECUTOR_PROMPT).toContain("Never call lifecycle_finish");
  });

  it("legacy single-attempt-halt rule is removed everywhere", () => {
    for (const p of [BRAINSTORMER_PROMPT, COMMANDER_PROMPT, PLANNER_PROMPT, EXECUTOR_PROMPT]) {
      expect(p).not.toContain("Single attempt per call. Do not retry on failure");
    }
  });

  it("all four prompts contain the literal safety strings", () => {
    for (const p of [BRAINSTORMER_PROMPT, COMMANDER_PROMPT, PLANNER_PROMPT, EXECUTOR_PROMPT]) {
      expect(p).toContain("--force");
      expect(p).toContain("--no-verify");
      expect(p).toContain("reset --hard");
    }
  });
});
```

**Verify:** `bun test tests/agents/lifecycle-recovery-prompt.test.ts`
**Commit:** `test(agents): drift guard for lifecycle recovery prompt blocks`

---

### Task 5.3: Recovery hint shape contract test across tools
**File:** `tests/lifecycle/recovery-hint-shape.test.ts` (NEW)
**Test:** `tests/lifecycle/recovery-hint-shape.test.ts` (this IS the test file)
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5
**Domain:** general (test)
**Atlas-impact:** none

Single contract test: for every lifecycle tool (`lifecycle_finish`, `lifecycle_commit`, `lifecycle_current`, `lifecycle_resume`, `lifecycle_recovery_decision`), drive at least one failure path and assert that the markdown output contains the EXACT same `### Recovery hint` section header plus all of: `**failure_kind:**`, `**recommended_next_action:**`, `**safe_to_retry:**`, `**attempt:**`, `**summary:**`. This is the wire format that all primary agent prompts parse. Drift here breaks the recovery loop silently — the test catches it.

```typescript
// tests/lifecycle/recovery-hint-shape.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleCommitTool } from "@/tools/lifecycle/commit";
import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";
import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";
import { createLifecycleResumeTool } from "@/tools/lifecycle/resume";
import { buildHint } from "@/lifecycle/recovery/hint";

const REQUIRED_FIELDS = [
  "### Recovery hint",
  "**failure_kind:**",
  "**recommended_next_action:**",
  "**safe_to_retry:**",
  "**attempt:**",
  "**summary:**",
];

const expectAllFields = (md: string): void => {
  for (const field of REQUIRED_FIELDS) {
    expect(md).toContain(field);
  }
};

describe("recovery hint shape contract", () => {
  it("lifecycle_finish failure path emits all required fields", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: false, prUrl: null, closedAt: null, worktreeRemoved: false,
        cleanupOutcome: { kind: "failed", reason: "x", retried: false },
        note: "merge_conflict",
        recoveryHint: buildHint({
          failureKind: "merge_conflict", recommendedNextAction: "resolve_conflicts",
          summary: "conflicts", issueNumber: 67,
        }),
      }),
    });
    expectAllFields(await tool.execute({ issue_number: 67 }, {}));
  });

  it("lifecycle_commit failure path emits all required fields", async () => {
    const tool = createLifecycleCommitTool({
      commit: async () => ({
        committed: false, sha: null, pushed: false, retried: false, note: "Staging failed",
        recoveryHint: buildHint({ failureKind: "unknown", recommendedNextAction: "ask_user", summary: "x" }),
      }),
    });
    expectAllFields(await tool.execute({ issue_number: 67, scope: "x", summary: "y", push: true }, {}));
  });

  it("lifecycle_current ambiguous emits all required fields", async () => {
    const tool = createLifecycleCurrentTool({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          { issueNumber: 7, branch: null, worktree: null, state: "in_progress", stale: false, staleReason: null },
          { issueNumber: 67, branch: null, worktree: null, state: "in_progress", stale: false, staleReason: null },
        ],
      }),
    });
    expectAllFields(await tool.execute({}, {}));
  });

  it("lifecycle_resume StaleRecordError emits all required fields", async () => {
    const tool = createLifecycleResumeTool({
      resume: async () => {
        const { StaleRecordError } = await import("@/lifecycle/resolver");
        throw new StaleRecordError({
          issueNumber: 7, branch: null, worktree: null, state: "in_progress",
          stale: true, staleReason: "branch_merged",
        });
      },
      forceRefresh: async () => { throw new Error("nope"); },
    });
    expectAllFields(await tool.execute({ issue_number: 7 }, {}));
  });

  it("lifecycle_recovery_decision blocked emits all required fields", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => ({ kind: "blocked", lastSeq: 0, reason: "x", detail: "y" }),
    });
    expectAllFields(await tool.execute({ issue_number: 67, owner: "o" }, {}));
  });
});
```

**Verify:** `bun test tests/lifecycle/recovery-hint-shape.test.ts`
**Commit:** `test(lifecycle): contract test for recovery hint wire format across tools`
