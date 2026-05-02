---
date: 2026-05-02
topic: "PR-first lifecycle with GitHub-visible AI review summary"
issue: 21
scope: lifecycle
contract: none
---

# PR-first Lifecycle with GitHub-visible AI Review Summary Implementation Plan

**Goal:** Make lifecycle finish open or reuse a PR, inject a stable AI review summary section into the PR body, optionally post a single non-state-changing PR comment, and refuse to finish when executor journal shows blocked tasks.

**Architecture:** Add three lifecycle modules: `review-summary.ts` (collects a structured summary from the journal + record), `pr.ts` (PR upsert + body section injection + optional one-shot comment), and extend `merge.ts` to drive the new PR-first flow. Reuse the existing `issue-body-markers.ts` helper pattern for stable section injection. The executor's internal reviewer loop and `lifecycle_commit` are unchanged. `lifecycle_finish` becomes the only place where GitHub-visible review summary is written.

**Design:** [thoughts/shared/designs/2026-05-02-pr-first-github-visible-ai-review-design.md](../designs/2026-05-02-pr-first-github-visible-ai-review-design.md)

**Contract:** none (single-domain backend / general; no frontend tasks)

---

## Gap-filling decisions (planner judgments)

The design is silent on several implementation details. Decisions made here:

- **Summary source**: read from the lifecycle journal (`review_completed`, `commit_observed`, `batch_completed` events) plus the `LifecycleRecord.notes`/`artifacts`. This avoids re-spawning the executor or re-running reviewers and gives a deterministic, replayable summary. Future iterations can layer in PR check results, but v1 sources from executor final state only (matching design's "summary should be generated once from the final executor report").
- **PR body markers**: reuse the established `<!-- micode:lifecycle:* -->` comment-marker convention. Add `AI_REVIEW_BEGIN` / `AI_REVIEW_END` constants alongside the existing markers in `issue-body-markers.ts`. The same `extractBetween` / `replaceBetween` helpers handle insert-or-update idempotently.
- **PR detection**: use `gh pr view <branch> --json number,url,body` to detect a reusable PR, then `gh pr edit <number> --body <new>` to update body, falling back to `gh pr create --fill --base <base> --head <branch>` when no PR exists. This is what the design calls "PR upsert".
- **Optional comment**: gated by `config.lifecycle.postPrSummaryComment` (new flag, defaults to `false`). When enabled, posts a single body comment via `gh pr comment`. Failure is non-blocking unless `requirePrSummaryComment` is also set; v1 keeps it strictly non-blocking (design constraint: "Optional PR comment failure should not block merge unless the user explicitly configures it as required").
- **Blocked-prevents-finish**: `lifecycle_finish` reads the journal and refuses to merge when the most recent `batch_completed` for any task carries `reviewOutcome: "blocked"` (or no `batch_completed` at all when `batch_dispatched` exists). Returns a `FinishOutcome` with `merged=false` and a `note` of `executor_blocked: <task ids>`.
- **Comment idempotency**: design says "posted once or updated according to configuration". v1 posts at most ONE comment per lifecycle finish call, identified by a stable `<!-- micode:lifecycle:ai-review-comment -->` marker scanned via `gh pr comment list` (actually `gh api repos/.../pulls/.../comments`). On re-finish with marker present, skip; do not edit comments in v1 (avoids second-state-changing API surface).
- **Local-merge path**: when strategy resolves to `local-merge` (no remote CI), there is no PR to update. Skip summary injection silently and emit a journal note so users know summary was deferred.
- **Test harness**: reuse the existing `FakeRunner` pattern from `tests/lifecycle/merge.test.ts`. No new test infrastructure required.

---

## Dependency Graph

```
Batch 1 (parallel, no deps):
  1.1 Add PR-body markers + AI_REVIEW section helpers to issue-body-markers.ts
  1.2 Add config.lifecycle.postPrSummaryComment flag in src/utils/config.ts
  1.3 Add review-summary types in src/lifecycle/review-summary-types.ts

Batch 2 (parallel, depends on Batch 1):
  2.1 Implement src/lifecycle/review-summary.ts (collects summary from journal + record)
  2.2 Implement src/lifecycle/pr.ts (upsert + body inject + optional comment)
  2.3 Add executor-blocked guard helper in src/lifecycle/finish-guards.ts

Batch 3 (depends on Batch 2):
  3.1 Wire PR-first flow into src/lifecycle/merge.ts (finishLifecycle changes)

Batch 4 (depends on Batch 3):
  4.1 Wire summary + guard into src/lifecycle/index.ts createFinisher
  4.2 Update lifecycle_finish tool output formatting in src/tools/lifecycle/finish.ts
```

---

## Batch 1: Foundation (parallel - 3 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Add AI review section markers to issue-body-markers.ts
**File:** `src/lifecycle/issue-body-markers.ts`
**Test:** `tests/lifecycle/issue-body-markers.test.ts` (extend existing)
**Depends:** none
**Domain:** backend

```typescript
// tests/lifecycle/issue-body-markers.test.ts (additions; keep existing cases)
import { describe, expect, it } from "bun:test";

import { extractBetween, ISSUE_BODY_MARKERS, replaceBetween } from "@/lifecycle/issue-body-markers";

describe("ISSUE_BODY_MARKERS AI review section", () => {
  it("exposes stable AI review begin/end markers", () => {
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN).toBe("<!-- micode:lifecycle:ai-review:begin -->");
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_END).toBe("<!-- micode:lifecycle:ai-review:end -->");
  });

  it("exposes a stable comment marker for the optional PR comment", () => {
    expect(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT).toBe("<!-- micode:lifecycle:ai-review-comment -->");
  });

  it("inserts the AI review block when missing", () => {
    const body = "Original PR description.";
    const next = replaceBetween(
      body,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      "## AI Review Summary\n- Verdict: approved",
    );

    expect(next).toContain("Original PR description.");
    expect(next).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(next).toContain("## AI Review Summary");
    expect(next).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_END);
  });

  it("updates the AI review block in place without duplicating", () => {
    const initial = replaceBetween(
      "Body.",
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      "## AI Review Summary\nold",
    );
    const updated = replaceBetween(
      initial,
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      "## AI Review Summary\nnew",
    );

    expect(updated.match(/AI Review Summary/g)?.length ?? 0).toBe(1);
    expect(updated).toContain("new");
    expect(updated).not.toContain("old");
  });

  it("extracts the AI review block content", () => {
    const body = replaceBetween(
      "Body.",
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      "## AI Review Summary\nverdict",
    );
    expect(extractBetween(body, ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN, ISSUE_BODY_MARKERS.AI_REVIEW_END)).toContain(
      "verdict",
    );
  });
});
```

```typescript
// src/lifecycle/issue-body-markers.ts (full replacement)
export const ISSUE_BODY_MARKERS = {
  STATE_BEGIN: "<!-- micode:lifecycle:state:begin -->",
  STATE_END: "<!-- micode:lifecycle:state:end -->",
  ARTIFACTS_BEGIN: "<!-- micode:lifecycle:artifacts:begin -->",
  ARTIFACTS_END: "<!-- micode:lifecycle:artifacts:end -->",
  CHECKLIST_BEGIN: "<!-- micode:lifecycle:checklist:begin -->",
  CHECKLIST_END: "<!-- micode:lifecycle:checklist:end -->",
  AI_REVIEW_BEGIN: "<!-- micode:lifecycle:ai-review:begin -->",
  AI_REVIEW_END: "<!-- micode:lifecycle:ai-review:end -->",
  AI_REVIEW_COMMENT: "<!-- micode:lifecycle:ai-review-comment -->",
} as const;

export function extractBetween(body: string, begin: string, end: string): string | null {
  const startIdx = body.indexOf(begin);
  if (startIdx === -1) return null;
  const endIdx = body.indexOf(end, startIdx + begin.length);
  if (endIdx === -1) return null;
  return body.slice(startIdx + begin.length, endIdx).trim();
}

export function replaceBetween(body: string, begin: string, end: string, replacement: string): string {
  const block = `${begin}\n${replacement}\n${end}`;
  const startIdx = body.indexOf(begin);
  if (startIdx === -1) return `${body.trimEnd()}\n\n${block}\n`;
  const endIdx = body.indexOf(end, startIdx + begin.length);
  if (endIdx === -1) return `${body.trimEnd()}\n\n${block}\n`;
  return `${body.slice(0, startIdx)}${block}${body.slice(endIdx + end.length)}`;
}
```

**Verify:** `bun test tests/lifecycle/issue-body-markers.test.ts`
**Commit:** `feat(lifecycle): add AI review section markers to issue body helpers`

### Task 1.2: Add lifecycle.postPrSummaryComment config flag
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config.test.ts` (extend; create file if absent)
**Depends:** none
**Domain:** general

```typescript
// tests/utils/config.test.ts (extend or create)
import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("config.lifecycle PR summary flags", () => {
  it("exposes postPrSummaryComment with a safe default of false", () => {
    expect(config.lifecycle.postPrSummaryComment).toBe(false);
  });

  it("keeps existing autoPush / mergeStrategy / prCheckTimeoutMs values", () => {
    expect(config.lifecycle.autoPush).toBe(true);
    expect(["auto", "pr", "local-merge"]).toContain(config.lifecycle.mergeStrategy);
    expect(config.lifecycle.prCheckTimeoutMs).toBeGreaterThan(0);
  });
});
```

Edit `src/utils/config.ts`: inside the existing `lifecycle: { ... }` block (currently around line 189), add the flag immediately after `prCheckTimeoutMs: 600_000,`:

```typescript
    prCheckTimeoutMs: 600_000,
    /**
     * When true, lifecycle_finish posts ONE non-state-changing PR comment
     * containing the AI review summary. The PR body summary block is always
     * written regardless of this flag. Default: false (body-only).
     */
    postPrSummaryComment: false,
    lifecycleDir: "thoughts/lifecycle",
```

Do NOT touch any other key. Do NOT introduce a new top-level config namespace.

**Verify:** `bun test tests/utils/config.test.ts && bun run typecheck`
**Commit:** `feat(lifecycle): add postPrSummaryComment config flag`

### Task 1.3: Define review summary types
**File:** `src/lifecycle/review-summary-types.ts`
**Test:** `tests/lifecycle/review-summary-types.test.ts`
**Depends:** none
**Domain:** backend

```typescript
// tests/lifecycle/review-summary-types.test.ts
import { describe, expect, it } from "bun:test";

import {
  REVIEW_SUMMARY_VERDICTS,
  type ReviewSummary,
  type ReviewSummaryVerdict,
} from "@/lifecycle/review-summary-types";

describe("REVIEW_SUMMARY_VERDICTS", () => {
  it("exposes the three valid verdicts as a const map", () => {
    expect(REVIEW_SUMMARY_VERDICTS.APPROVED).toBe("approved");
    expect(REVIEW_SUMMARY_VERDICTS.CHANGES_REQUESTED).toBe("changes_requested");
    expect(REVIEW_SUMMARY_VERDICTS.BLOCKED).toBe("blocked");
  });

  it("derives a union type from the const map", () => {
    const v: ReviewSummaryVerdict = REVIEW_SUMMARY_VERDICTS.APPROVED;
    expect(v).toBe("approved");
  });

  it("ReviewSummary holds the fields the design calls for", () => {
    const summary: ReviewSummary = {
      verdict: REVIEW_SUMMARY_VERDICTS.APPROVED,
      issueNumber: 21,
      branch: "issue/21-x",
      taskCount: 4,
      approvedCount: 4,
      changesRequestedCount: 0,
      blockedCount: 0,
      blockedTaskIds: [],
      lastCommitSha: "abc1234",
      generatedAt: 1_700_000_000_000,
      notes: ["resolved-base=main(remote)"],
    };
    expect(summary.verdict).toBe("approved");
    expect(summary.taskCount).toBe(4);
  });
});
```

```typescript
// src/lifecycle/review-summary-types.ts
export const REVIEW_SUMMARY_VERDICTS = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  BLOCKED: "blocked",
} as const;

export type ReviewSummaryVerdict = (typeof REVIEW_SUMMARY_VERDICTS)[keyof typeof REVIEW_SUMMARY_VERDICTS];

export interface ReviewSummary {
  readonly verdict: ReviewSummaryVerdict;
  readonly issueNumber: number;
  readonly branch: string;
  readonly taskCount: number;
  readonly approvedCount: number;
  readonly changesRequestedCount: number;
  readonly blockedCount: number;
  readonly blockedTaskIds: readonly string[];
  readonly lastCommitSha: string | null;
  readonly generatedAt: number;
  readonly notes: readonly string[];
}
```

**Verify:** `bun test tests/lifecycle/review-summary-types.test.ts`
**Commit:** `feat(lifecycle): add ReviewSummary types`

---

## Batch 2: Core Modules (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Implement review summary collector
**File:** `src/lifecycle/review-summary.ts`
**Test:** `tests/lifecycle/review-summary.test.ts`
**Depends:** 1.3 (types), 1.1 (markers used by renderer)
**Domain:** backend

```typescript
// tests/lifecycle/review-summary.test.ts
import { describe, expect, it } from "bun:test";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";
import { collectReviewSummary, renderReviewSummarySection } from "@/lifecycle/review-summary";
import { REVIEW_SUMMARY_VERDICTS } from "@/lifecycle/review-summary-types";
import type { LifecycleRecord } from "@/lifecycle/types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";

const baseRecord = (): LifecycleRecord => ({
  issueNumber: 21,
  issueUrl: "https://github.com/Wuxie233/micode/issues/21",
  branch: "issue/21-x",
  worktree: "/tmp/wt",
  state: LIFECYCLE_STATES.MERGING,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: ["d.md"],
    [ARTIFACT_KINDS.PLAN]: ["p.md"],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: ["abc1234"],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: ["/tmp/wt"],
  },
  notes: ["resolved-base=main(remote)"],
  updatedAt: 1_700_000_000_000,
});

const reviewEvent = (
  taskId: string,
  outcome: JournalEvent["reviewOutcome"],
  seq: number,
): JournalEvent => ({
  kind: JOURNAL_EVENT_KINDS.REVIEW_COMPLETED,
  issueNumber: 21,
  seq,
  at: 1_700_000_000_000 + seq,
  batchId: "batch-1",
  taskId,
  attempt: 1,
  summary: `review ${taskId}`,
  commitMarker: null,
  reviewOutcome: outcome,
});

describe("collectReviewSummary", () => {
  it("returns approved when every task's last review is approved", () => {
    const events: JournalEvent[] = [reviewEvent("1.1", "approved", 1), reviewEvent("1.2", "approved", 2)];
    const summary = collectReviewSummary({ record: baseRecord(), events, now: 1_700_000_000_999 });
    expect(summary.verdict).toBe(REVIEW_SUMMARY_VERDICTS.APPROVED);
    expect(summary.taskCount).toBe(2);
    expect(summary.approvedCount).toBe(2);
    expect(summary.blockedCount).toBe(0);
    expect(summary.blockedTaskIds).toEqual([]);
    expect(summary.lastCommitSha).toBe("abc1234");
  });

  it("uses the latest review outcome per task when a task was retried", () => {
    const events: JournalEvent[] = [
      reviewEvent("1.1", "changes_requested", 1),
      reviewEvent("1.1", "approved", 2),
    ];
    const summary = collectReviewSummary({ record: baseRecord(), events, now: 1 });
    expect(summary.verdict).toBe(REVIEW_SUMMARY_VERDICTS.APPROVED);
    expect(summary.approvedCount).toBe(1);
    expect(summary.changesRequestedCount).toBe(0);
  });

  it("returns blocked when any task's last review is blocked", () => {
    const events: JournalEvent[] = [reviewEvent("1.1", "approved", 1), reviewEvent("1.2", "blocked", 2)];
    const summary = collectReviewSummary({ record: baseRecord(), events, now: 1 });
    expect(summary.verdict).toBe(REVIEW_SUMMARY_VERDICTS.BLOCKED);
    expect(summary.blockedTaskIds).toEqual(["1.2"]);
    expect(summary.blockedCount).toBe(1);
  });

  it("returns changes_requested when no blocked but some pending changes", () => {
    const events: JournalEvent[] = [
      reviewEvent("1.1", "approved", 1),
      reviewEvent("1.2", "changes_requested", 2),
    ];
    const summary = collectReviewSummary({ record: baseRecord(), events, now: 1 });
    expect(summary.verdict).toBe(REVIEW_SUMMARY_VERDICTS.CHANGES_REQUESTED);
    expect(summary.changesRequestedCount).toBe(1);
  });

  it("treats no review events as taskCount=0 and verdict approved (nothing to block)", () => {
    const summary = collectReviewSummary({ record: baseRecord(), events: [], now: 1 });
    expect(summary.taskCount).toBe(0);
    expect(summary.verdict).toBe(REVIEW_SUMMARY_VERDICTS.APPROVED);
  });

  it("ignores non-review events when counting tasks", () => {
    const events: JournalEvent[] = [
      reviewEvent("1.1", "approved", 1),
      {
        kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
        issueNumber: 21,
        seq: 2,
        at: 2,
        batchId: "batch-1",
        taskId: null,
        attempt: 1,
        summary: "commit",
        commitMarker: null,
        reviewOutcome: null,
      },
    ];
    const summary = collectReviewSummary({ record: baseRecord(), events, now: 1 });
    expect(summary.taskCount).toBe(1);
  });
});

describe("renderReviewSummarySection", () => {
  it("emits a Markdown block containing verdict, counts, branch, commit and notes", () => {
    const summary = collectReviewSummary({
      record: baseRecord(),
      events: [reviewEvent("1.1", "approved", 1)],
      now: 1_700_000_000_500,
    });
    const md = renderReviewSummarySection(summary);
    expect(md).toContain("## AI Review Summary");
    expect(md).toContain("Verdict: approved");
    expect(md).toContain("Branch: issue/21-x");
    expect(md).toContain("Tasks reviewed: 1");
    expect(md).toContain("abc1234");
    expect(md).toContain("resolved-base=main(remote)");
    expect(md).toContain("This summary is produced by an automated AI review");
  });

  it("lists blocked task ids when present", () => {
    const summary = collectReviewSummary({
      record: baseRecord(),
      events: [reviewEvent("1.1", "blocked", 1)],
      now: 1,
    });
    const md = renderReviewSummarySection(summary);
    expect(md).toContain("Blocked tasks: 1.1");
  });

  it("does not contain the begin/end markers themselves (caller wraps them)", () => {
    const summary = collectReviewSummary({ record: baseRecord(), events: [], now: 1 });
    const md = renderReviewSummarySection(summary);
    expect(md).not.toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(md).not.toContain(ISSUE_BODY_MARKERS.AI_REVIEW_END);
  });
});
```

```typescript
// src/lifecycle/review-summary.ts
import type { JournalEvent } from "./journal/types";
import { JOURNAL_EVENT_KINDS } from "./journal/types";
import {
  REVIEW_SUMMARY_VERDICTS,
  type ReviewSummary,
  type ReviewSummaryVerdict,
} from "./review-summary-types";
import { ARTIFACT_KINDS, type LifecycleRecord } from "./types";

export interface CollectInput {
  readonly record: LifecycleRecord;
  readonly events: readonly JournalEvent[];
  readonly now: number;
}

const HEADING = "## AI Review Summary";
const DISCLAIMER =
  "This summary is produced by an automated AI review pipeline. " +
  "It is not a formal GitHub Review and does not imply human approval.";
const LINE_BREAK = "\n";
const BULLET = "- ";
const NONE = "(none)";

const lastReviewByTask = (events: readonly JournalEvent[]): Map<string, JournalEvent["reviewOutcome"]> => {
  const latest = new Map<string, { seq: number; outcome: JournalEvent["reviewOutcome"] }>();
  for (const event of events) {
    if (event.kind !== JOURNAL_EVENT_KINDS.REVIEW_COMPLETED) continue;
    if (event.taskId === null) continue;
    const prior = latest.get(event.taskId);
    if (!prior || prior.seq < event.seq) latest.set(event.taskId, { seq: event.seq, outcome: event.reviewOutcome });
  }
  const out = new Map<string, JournalEvent["reviewOutcome"]>();
  for (const [taskId, value] of latest) out.set(taskId, value.outcome);
  return out;
};

const decideVerdict = (
  blocked: number,
  changesRequested: number,
): ReviewSummaryVerdict => {
  if (blocked > 0) return REVIEW_SUMMARY_VERDICTS.BLOCKED;
  if (changesRequested > 0) return REVIEW_SUMMARY_VERDICTS.CHANGES_REQUESTED;
  return REVIEW_SUMMARY_VERDICTS.APPROVED;
};

export function collectReviewSummary(input: CollectInput): ReviewSummary {
  const last = lastReviewByTask(input.events);
  let approved = 0;
  let changes = 0;
  let blocked = 0;
  const blockedIds: string[] = [];
  for (const [taskId, outcome] of last) {
    if (outcome === "approved") approved += 1;
    else if (outcome === "changes_requested") changes += 1;
    else if (outcome === "blocked") {
      blocked += 1;
      blockedIds.push(taskId);
    }
  }
  blockedIds.sort();
  const commits = input.record.artifacts[ARTIFACT_KINDS.COMMIT];
  const lastCommitSha = commits.at(-1) ?? null;
  return {
    verdict: decideVerdict(blocked, changes),
    issueNumber: input.record.issueNumber,
    branch: input.record.branch,
    taskCount: last.size,
    approvedCount: approved,
    changesRequestedCount: changes,
    blockedCount: blocked,
    blockedTaskIds: blockedIds,
    lastCommitSha,
    generatedAt: input.now,
    notes: input.record.notes,
  };
}

const formatNotes = (notes: readonly string[]): string => {
  if (notes.length === 0) return `${BULLET}${NONE}`;
  return notes.map((note) => `${BULLET}${note}`).join(LINE_BREAK);
};

const formatBlockedIds = (ids: readonly string[]): string => {
  if (ids.length === 0) return NONE;
  return ids.join(", ");
};

export function renderReviewSummarySection(summary: ReviewSummary): string {
  const lines = [
    HEADING,
    "",
    `${BULLET}Verdict: ${summary.verdict}`,
    `${BULLET}Branch: ${summary.branch}`,
    `${BULLET}Issue: #${summary.issueNumber}`,
    `${BULLET}Tasks reviewed: ${summary.taskCount} (approved=${summary.approvedCount}, changes_requested=${summary.changesRequestedCount}, blocked=${summary.blockedCount})`,
    `${BULLET}Blocked tasks: ${formatBlockedIds(summary.blockedTaskIds)}`,
    `${BULLET}Last commit: ${summary.lastCommitSha ?? NONE}`,
    `${BULLET}Generated at: ${new Date(summary.generatedAt).toISOString()}`,
    "",
    "**Notes**:",
    formatNotes(summary.notes),
    "",
    `_${DISCLAIMER}_`,
  ];
  return lines.join(LINE_BREAK);
}
```

**Verify:** `bun test tests/lifecycle/review-summary.test.ts`
**Commit:** `feat(lifecycle): add review summary collector and renderer`

### Task 2.2: Implement PR upsert + body inject + optional comment
**File:** `src/lifecycle/pr.ts`
**Test:** `tests/lifecycle/pr.test.ts`
**Depends:** 1.1 (markers), 1.3 (types via review-summary-types are not strictly needed here, but ReviewSummary may be threaded by caller)
**Domain:** backend

```typescript
// tests/lifecycle/pr.test.ts
import { describe, expect, it } from "bun:test";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import {
  postOnceSummaryComment,
  upsertPullRequest,
  writeReviewSummaryToPrBody,
} from "@/lifecycle/pr";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = "") => ({ stdout, stderr: "", exitCode: 0 }) as RunResult;
const FAIL = (stderr = "boom") => ({ stdout: "", stderr, exitCode: 1 }) as RunResult;

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const fakeRunner = (gh: readonly RunResult[]): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  let i = 0;
  const runner: LifecycleRunner = {
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return OK();
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const result = gh[i] ?? OK();
      i += 1;
      return result;
    },
  };
  return { runner, calls };
};

describe("upsertPullRequest", () => {
  it("returns the existing PR when gh pr view succeeds", async () => {
    const view = OK(JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7", body: "old" }));
    const { runner, calls } = fakeRunner([view]);
    const outcome = await upsertPullRequest(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      baseBranch: "main",
    });
    expect(outcome.kind).toBe("reused");
    expect(outcome.prNumber).toBe(7);
    expect(outcome.body).toBe("old");
    expect(calls[0]?.args).toEqual(["pr", "view", "issue/21-x", "--json", "number,url,body"]);
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "create")).toBe(false);
  });

  it("creates a PR when gh pr view fails (no PR exists)", async () => {
    const view = FAIL("no pull requests found");
    const create = OK("https://github.com/o/r/pull/8\n");
    const reread = OK(JSON.stringify({ number: 8, url: "https://github.com/o/r/pull/8", body: "" }));
    const { runner, calls } = fakeRunner([view, create, reread]);
    const outcome = await upsertPullRequest(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      baseBranch: "main",
    });
    expect(outcome.kind).toBe("created");
    expect(outcome.prNumber).toBe(8);
    expect(outcome.url).toBe("https://github.com/o/r/pull/8");
    expect(calls[1]?.args).toEqual(["pr", "create", "--fill", "--base", "main", "--head", "issue/21-x"]);
  });

  it("returns failure when pr create fails", async () => {
    const view = FAIL();
    const create = FAIL("network");
    const { runner } = fakeRunner([view, create]);
    const outcome = await upsertPullRequest(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      baseBranch: "main",
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("gh_pr_create");
  });
});

describe("writeReviewSummaryToPrBody", () => {
  it("inserts the AI review block when missing and edits the PR body", async () => {
    const view = OK(JSON.stringify({ number: 7, url: "u", body: "Original." }));
    const edit = OK();
    const { runner, calls } = fakeRunner([view, edit]);
    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary\nVerdict: approved",
    });
    expect(outcome.kind).toBe("updated");
    expect(calls[1]?.args[0]).toBe("pr");
    expect(calls[1]?.args[1]).toBe("edit");
    const bodyArg = calls[1]?.args[calls[1].args.length - 1] ?? "";
    expect(bodyArg).toContain("Original.");
    expect(bodyArg).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(bodyArg).toContain("Verdict: approved");
    expect(bodyArg).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_END);
  });

  it("updates the existing AI review block in place (idempotent)", async () => {
    const initial =
      "Body.\n\n" +
      `${ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN}\n## AI Review Summary\nold\n${ISSUE_BODY_MARKERS.AI_REVIEW_END}\n`;
    const view = OK(JSON.stringify({ number: 7, url: "u", body: initial }));
    const edit = OK();
    const { runner, calls } = fakeRunner([view, edit]);
    await writeReviewSummaryToPrBody(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary\nnew",
    });
    const bodyArg = calls[1]?.args[calls[1].args.length - 1] ?? "";
    expect((bodyArg.match(/AI Review Summary/g) ?? []).length).toBe(1);
    expect(bodyArg).toContain("new");
    expect(bodyArg).not.toContain("old");
  });

  it("returns blocker when gh pr edit fails", async () => {
    const view = OK(JSON.stringify({ number: 7, url: "u", body: "" }));
    const edit = FAIL("permission");
    const { runner } = fakeRunner([view, edit]);
    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary",
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("pr_body_update_failed");
  });

  it("returns no_pr when gh pr view fails (caller decides)", async () => {
    const view = FAIL();
    const { runner } = fakeRunner([view]);
    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary",
    });
    expect(outcome.kind).toBe("no_pr");
  });
});

describe("postOnceSummaryComment", () => {
  it("posts a single comment with the marker when the marker is absent", async () => {
    const list = OK(JSON.stringify([{ body: "unrelated" }]));
    const post = OK();
    const { runner, calls } = fakeRunner([list, post]);
    const outcome = await postOnceSummaryComment(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary",
    });
    expect(outcome.kind).toBe("posted");
    const commentBody = calls[1]?.args[calls[1].args.length - 1] ?? "";
    expect(commentBody).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT);
    expect(commentBody).toContain("## AI Review Summary");
  });

  it("skips when an AI-review-marked comment already exists", async () => {
    const list = OK(JSON.stringify([{ body: `${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\nold` }]));
    const { runner, calls } = fakeRunner([list]);
    const outcome = await postOnceSummaryComment(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary",
    });
    expect(outcome.kind).toBe("skipped");
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "comment")).toBe(false);
  });

  it("returns failed (non-blocking; caller decides) when comment post fails", async () => {
    const list = OK("[]");
    const post = FAIL("rate-limit");
    const { runner } = fakeRunner([list, post]);
    const outcome = await postOnceSummaryComment(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      section: "## AI Review Summary",
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("pr_comment_failed");
  });
});
```

```typescript
// src/lifecycle/pr.ts
import * as v from "valibot";

import { ISSUE_BODY_MARKERS, replaceBetween } from "./issue-body-markers";
import type { LifecycleRunner, RunResult } from "./runner";

const OK_EXIT_CODE = 0;
const PR_URL_PATTERN = /https:\/\/github\.com\/\S+\/pull\/(\d+)/;
const DETAIL_SEPARATOR = ": ";
const OUTPUT_SEPARATOR = " ";
const PR_BODY_UPDATE_FAILED = "pr_body_update_failed";
const PR_COMMENT_FAILED = "pr_comment_failed";
const GH_PR_CREATE_FAILED = "gh_pr_create";
const PR_VIEW_FIELDS = "number,url,body";

const PR_VIEW = ["pr", "view"] as const;
const PR_CREATE = ["pr", "create"] as const;
const PR_EDIT = ["pr", "edit"] as const;
const PR_COMMENT = ["pr", "comment"] as const;
const FILL_FLAG = "--fill";
const BASE_FLAG = "--base";
const HEAD_FLAG = "--head";
const JSON_FLAG = "--json";
const BODY_FLAG = "--body";

const PrViewSchema = v.object({
  number: v.number(),
  url: v.string(),
  body: v.optional(v.nullable(v.string())),
});

const CommentItemSchema = v.object({
  body: v.optional(v.nullable(v.string())),
});
const CommentListSchema = v.array(CommentItemSchema);

const succeeded = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const formatFailure = (label: string, run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length > 0) return `${label}${DETAIL_SEPARATOR}${pieces.join(OUTPUT_SEPARATOR)}`;
  return `${label}${DETAIL_SEPARATOR}exit code ${run.exitCode}`;
};

interface PrIdentity {
  readonly prNumber: number;
  readonly url: string;
  readonly body: string;
}

const parsePrView = (stdout: string): PrIdentity | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(PrViewSchema, raw);
    if (!parsed.success) return null;
    return { prNumber: parsed.output.number, url: parsed.output.url, body: parsed.output.body ?? "" };
  } catch {
    // gh sometimes prints non-JSON when --json is unsupported; fall back to URL extraction.
    const match = PR_URL_PATTERN.exec(stdout);
    if (!match) return null;
    const prNumber = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isSafeInteger(prNumber) || prNumber <= 0) return null;
    return { prNumber, url: match[0], body: "" };
  }
};

const ghPrView = async (
  runner: LifecycleRunner,
  cwd: string,
  branch: string,
): Promise<PrIdentity | null> => {
  const run = await runner.gh([...PR_VIEW, branch, JSON_FLAG, PR_VIEW_FIELDS], { cwd });
  if (!succeeded(run)) return null;
  return parsePrView(run.stdout);
};

export interface UpsertInput {
  readonly cwd: string;
  readonly branch: string;
  readonly baseBranch: string;
}

export type UpsertOutcome =
  | { readonly kind: "reused"; readonly prNumber: number; readonly url: string; readonly body: string }
  | { readonly kind: "created"; readonly prNumber: number; readonly url: string; readonly body: string }
  | { readonly kind: "failed"; readonly note: string };

export async function upsertPullRequest(runner: LifecycleRunner, input: UpsertInput): Promise<UpsertOutcome> {
  const existing = await ghPrView(runner, input.cwd, input.branch);
  if (existing) return { kind: "reused", ...existing };

  const created = await runner.gh(
    [...PR_CREATE, FILL_FLAG, BASE_FLAG, input.baseBranch, HEAD_FLAG, input.branch],
    { cwd: input.cwd },
  );
  if (!succeeded(created)) return { kind: "failed", note: formatFailure(GH_PR_CREATE_FAILED, created) };

  const fresh = await ghPrView(runner, input.cwd, input.branch);
  if (fresh) return { kind: "created", ...fresh };
  return { kind: "failed", note: formatFailure(GH_PR_CREATE_FAILED, created) };
}

export interface BodyInjectInput {
  readonly cwd: string;
  readonly branch: string;
  readonly section: string;
}

export type BodyInjectOutcome =
  | { readonly kind: "updated"; readonly prNumber: number }
  | { readonly kind: "no_pr" }
  | { readonly kind: "failed"; readonly note: string };

export async function writeReviewSummaryToPrBody(
  runner: LifecycleRunner,
  input: BodyInjectInput,
): Promise<BodyInjectOutcome> {
  const pr = await ghPrView(runner, input.cwd, input.branch);
  if (!pr) return { kind: "no_pr" };

  const nextBody = replaceBetween(
    pr.body,
    ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
    ISSUE_BODY_MARKERS.AI_REVIEW_END,
    input.section,
  );

  const edited = await runner.gh([...PR_EDIT, String(pr.prNumber), BODY_FLAG, nextBody], { cwd: input.cwd });
  if (!succeeded(edited)) return { kind: "failed", note: formatFailure(PR_BODY_UPDATE_FAILED, edited) };
  return { kind: "updated", prNumber: pr.prNumber };
}

export interface CommentInput {
  readonly cwd: string;
  readonly branch: string;
  readonly section: string;
}

export type CommentOutcome =
  | { readonly kind: "posted" }
  | { readonly kind: "skipped" }
  | { readonly kind: "no_pr" }
  | { readonly kind: "failed"; readonly note: string };

const COMMENT_LIST_FIELDS = "comments";

const commentAlreadyPosted = (stdout: string): boolean => {
  try {
    const raw: unknown = JSON.parse(stdout);
    if (Array.isArray(raw)) {
      const parsed = v.safeParse(CommentListSchema, raw);
      if (!parsed.success) return false;
      return parsed.output.some((entry) => (entry.body ?? "").includes(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT));
    }
    const wrapper = v.safeParse(v.object({ comments: v.optional(CommentListSchema) }), raw);
    if (!wrapper.success) return false;
    const comments = wrapper.output.comments ?? [];
    return comments.some((entry) => (entry.body ?? "").includes(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT));
  } catch {
    return false;
  }
};

export async function postOnceSummaryComment(
  runner: LifecycleRunner,
  input: CommentInput,
): Promise<CommentOutcome> {
  const list = await runner.gh([...PR_VIEW, input.branch, JSON_FLAG, COMMENT_LIST_FIELDS], { cwd: input.cwd });
  if (!succeeded(list)) return { kind: "no_pr" };
  if (commentAlreadyPosted(list.stdout)) return { kind: "skipped" };

  const body = `${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\n${input.section}`;
  const posted = await runner.gh([...PR_COMMENT, input.branch, BODY_FLAG, body], { cwd: input.cwd });
  if (!succeeded(posted)) return { kind: "failed", note: formatFailure(PR_COMMENT_FAILED, posted) };
  return { kind: "posted" };
}
```

**Verify:** `bun test tests/lifecycle/pr.test.ts`
**Commit:** `feat(lifecycle): add PR upsert and body summary injection helpers`

### Task 2.3: Implement executor-blocked guard
**File:** `src/lifecycle/finish-guards.ts`
**Test:** `tests/lifecycle/finish-guards.test.ts`
**Depends:** 1.3 (review summary types not strictly required), reads journal types
**Domain:** backend

```typescript
// tests/lifecycle/finish-guards.test.ts
import { describe, expect, it } from "bun:test";

import { detectBlockedTasks } from "@/lifecycle/finish-guards";
import { JOURNAL_EVENT_KINDS, type JournalEvent } from "@/lifecycle/journal/types";

const review = (taskId: string, outcome: JournalEvent["reviewOutcome"], seq: number): JournalEvent => ({
  kind: JOURNAL_EVENT_KINDS.REVIEW_COMPLETED,
  issueNumber: 21,
  seq,
  at: seq,
  batchId: "b",
  taskId,
  attempt: 1,
  summary: "r",
  commitMarker: null,
  reviewOutcome: outcome,
});

describe("detectBlockedTasks", () => {
  it("returns empty when there are no review events", () => {
    expect(detectBlockedTasks([])).toEqual([]);
  });

  it("returns empty when every task's last review is approved", () => {
    expect(detectBlockedTasks([review("1.1", "approved", 1), review("1.2", "approved", 2)])).toEqual([]);
  });

  it("returns blocked task ids sorted", () => {
    const events = [review("1.1", "blocked", 1), review("1.2", "approved", 2), review("1.3", "blocked", 3)];
    expect(detectBlockedTasks(events)).toEqual(["1.1", "1.3"]);
  });

  it("uses only the latest review per task (so a fixed task does not register as blocked)", () => {
    const events = [review("1.1", "blocked", 1), review("1.1", "approved", 2)];
    expect(detectBlockedTasks(events)).toEqual([]);
  });

  it("ignores non-review events", () => {
    const events: JournalEvent[] = [
      review("1.1", "approved", 1),
      {
        kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
        issueNumber: 21,
        seq: 2,
        at: 2,
        batchId: "b",
        taskId: null,
        attempt: 1,
        summary: "commit",
        commitMarker: null,
        reviewOutcome: null,
      },
    ];
    expect(detectBlockedTasks(events)).toEqual([]);
  });

  it("ignores review events with null taskId", () => {
    const events = [{ ...review("1.1", "blocked", 1), taskId: null }];
    expect(detectBlockedTasks(events)).toEqual([]);
  });
});
```

```typescript
// src/lifecycle/finish-guards.ts
import { JOURNAL_EVENT_KINDS, type JournalEvent } from "./journal/types";

const BLOCKED = "blocked";

export function detectBlockedTasks(events: readonly JournalEvent[]): readonly string[] {
  const latest = new Map<string, { seq: number; outcome: JournalEvent["reviewOutcome"] }>();
  for (const event of events) {
    if (event.kind !== JOURNAL_EVENT_KINDS.REVIEW_COMPLETED) continue;
    if (event.taskId === null) continue;
    const prior = latest.get(event.taskId);
    if (!prior || prior.seq < event.seq) latest.set(event.taskId, { seq: event.seq, outcome: event.reviewOutcome });
  }
  const blocked: string[] = [];
  for (const [taskId, value] of latest) {
    if (value.outcome === BLOCKED) blocked.push(taskId);
  }
  return blocked.sort();
}
```

**Verify:** `bun test tests/lifecycle/finish-guards.test.ts`
**Commit:** `feat(lifecycle): add executor-blocked guard helper`

---

## Batch 3: Merge integration (1 implementer)

This batch depends on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Wire PR-first flow into finishLifecycle
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/merge.test.ts` (extend; do not rename existing tests)
**Depends:** 2.2 (PR helpers)
**Domain:** backend

The existing `finishLifecycle` already routes via `resolveStrategy` (PR vs local-merge). We extend the PR path so that PR creation/reuse and review-summary injection happen BEFORE the optional checks wait, and BEFORE the merge call. The signature gains an optional `reviewSummarySection` and an optional `postSummaryComment` flag, both injected by the lifecycle handle (Task 4.1).

```typescript
// tests/lifecycle/merge.test.ts (additions; preserve existing cases verbatim)
import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = "", exitCode = 0): RunResult => ({ stdout, stderr: "", exitCode });
const FAIL = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const mkRunner = (gh: readonly RunResult[], git: readonly RunResult[] = []) => {
  const calls: Call[] = [];
  let gi = 0;
  let hi = 0;
  const runner: LifecycleRunner = {
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const r = git[gi] ?? OK();
      gi += 1;
      return r;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const r = gh[hi] ?? OK();
      hi += 1;
      return r;
    },
  };
  return { runner, calls };
};

const PR_VIEW = OK(
  JSON.stringify({ number: 12, url: "https://github.com/Wuxie233/micode/pull/12", body: "Original PR body." }),
);
const PR_EDIT = OK();
const CHECKS_OK = OK(JSON.stringify([{ state: "SUCCESS", name: "ci" }]));
const MERGE_OK = OK();

describe("finishLifecycle PR-first review summary", () => {
  it("reuses existing PR, injects review summary into body, then merges", async () => {
    const { runner, calls } = mkRunner([PR_VIEW, PR_EDIT, CHECKS_OK, MERGE_OK]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary\nVerdict: approved",
      postSummaryComment: false,
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.prUrl).toBe("https://github.com/Wuxie233/micode/pull/12");
    const ghCalls = calls.filter((c) => c.bin === "gh");
    expect(ghCalls[0]?.args.slice(0, 2)).toEqual(["pr", "view"]);
    expect(ghCalls[1]?.args.slice(0, 2)).toEqual(["pr", "edit"]);
    const editBody = ghCalls[1]?.args.at(-1) ?? "";
    expect(editBody).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(editBody).toContain("Verdict: approved");
  });

  it("creates a PR when none exists then injects summary", async () => {
    const noPr = FAIL("no PR");
    const create = OK("https://github.com/Wuxie233/micode/pull/15\n");
    const reread = OK(JSON.stringify({ number: 15, url: "https://github.com/Wuxie233/micode/pull/15", body: "" }));
    const reread2 = OK(JSON.stringify({ number: 15, url: "https://github.com/Wuxie233/micode/pull/15", body: "" }));
    const { runner } = mkRunner([noPr, create, reread, reread2, PR_EDIT, CHECKS_OK, MERGE_OK]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary\nVerdict: approved",
      postSummaryComment: false,
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.prUrl).toBe("https://github.com/Wuxie233/micode/pull/15");
  });

  it("blocks merge with pr_body_update_failed when summary injection fails", async () => {
    const { runner } = mkRunner([PR_VIEW, FAIL("permission")]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary",
      postSummaryComment: false,
    });
    expect(outcome.merged).toBe(false);
    expect(outcome.note ?? "").toContain("pr_body_update_failed");
    expect(outcome.prUrl).toBe("https://github.com/Wuxie233/micode/pull/12");
  });

  it("posts a single PR comment when postSummaryComment is true", async () => {
    const commentList = OK("[]");
    const commentPost = OK();
    const { runner, calls } = mkRunner([PR_VIEW, PR_EDIT, commentList, commentPost, CHECKS_OK, MERGE_OK]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary\nVerdict: approved",
      postSummaryComment: true,
    });
    expect(outcome.merged).toBe(true);
    expect(calls.some((c) => c.bin === "gh" && c.args[0] === "pr" && c.args[1] === "comment")).toBe(true);
  });

  it("does NOT block merge when optional comment posting fails", async () => {
    const commentList = OK("[]");
    const commentPost = FAIL("rate-limit");
    const { runner } = mkRunner([PR_VIEW, PR_EDIT, commentList, commentPost, CHECKS_OK, MERGE_OK]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary",
      postSummaryComment: true,
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.note ?? "").toContain("pr_comment_failed");
  });

  it("local-merge path still works and skips summary injection", async () => {
    const { runner, calls } = mkRunner([OK("[]")], [OK(), OK(), OK(), OK(), OK()]);
    const outcome = await finishLifecycle(runner, {
      cwd: "/cwd",
      branch: "issue/21-x",
      worktree: "/cwd-wt",
      mergeStrategy: "local-merge",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
      reviewSummarySection: "## AI Review Summary",
      postSummaryComment: true,
    });
    expect(outcome.merged).toBe(true);
    expect(calls.some((c) => c.bin === "gh" && c.args[0] === "pr" && c.args[1] === "edit")).toBe(false);
    expect(calls.some((c) => c.bin === "gh" && c.args[0] === "pr" && c.args[1] === "comment")).toBe(false);
  });
});
```

Edit `src/lifecycle/merge.ts`:

1. Add imports at the top (after existing imports):

```typescript
import { postOnceSummaryComment, upsertPullRequest, writeReviewSummaryToPrBody } from "./pr";
```

2. Extend `FinishLifecycleInput`:

```typescript
export interface FinishLifecycleInput {
  readonly cwd: string;
  readonly branch: string;
  readonly worktree: string;
  readonly mergeStrategy?: FinishInput["mergeStrategy"] | "auto";
  readonly waitForChecks: boolean;
  readonly baseBranch?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly reviewSummarySection?: string;
  readonly postSummaryComment?: boolean;
}
```

3. Add a small helper near the other helpers:

```typescript
const PR_BODY_INJECT_FAILED_PREFIX = "pr_body_update_failed";

const injectAndCommentIfNeeded = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  prUrl: string | null,
): Promise<{ readonly ok: boolean; readonly prUrl: string | null; readonly note: string | null }> => {
  const note: string[] = [];
  const section = input.reviewSummarySection;
  if (!section) return { ok: true, prUrl, note: null };

  const injected = await writeReviewSummaryToPrBody(runner, {
    cwd: input.cwd,
    branch: input.branch,
    section,
  });
  if (injected.kind === "failed") return { ok: false, prUrl, note: injected.note };
  if (injected.kind === "no_pr") return { ok: false, prUrl, note: `${PR_BODY_INJECT_FAILED_PREFIX}: pr disappeared` };

  if (input.postSummaryComment === true) {
    const commented = await postOnceSummaryComment(runner, {
      cwd: input.cwd,
      branch: input.branch,
      section,
    });
    if (commented.kind === "failed") note.push(commented.note);
  }
  return { ok: true, prUrl, note: note.length === 0 ? null : note.join("; ") };
};
```

4. Replace the body of `finishViaPr` with the upsert-then-inject-then-checks-then-merge flow:

```typescript
const finishViaPr = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const upsert = await upsertPullRequest(runner, {
    cwd: input.cwd,
    branch: input.branch,
    baseBranch: getBaseBranch(input),
  });
  if (upsert.kind === "failed") return createOutcome(false, null, false, upsert.note);

  const prUrl = upsert.url;
  const inject = await injectAndCommentIfNeeded(runner, input, prUrl);
  if (!inject.ok) return createOutcome(false, prUrl, false, inject.note);

  const checksNote = input.waitForChecks ? await waitForPrChecks(runner, input) : null;
  if (checksNote) return createOutcome(false, prUrl, false, mergeNotes(inject.note, checksNote));

  const merged = await runner.gh([GH_PR, GH_MERGE, input.branch, GH_SQUASH_FLAG], { cwd: input.cwd });
  if (!completed(merged))
    return createOutcome(false, prUrl, false, mergeNotes(inject.note, formatCommandFailure("gh_pr_merge", merged)));

  const cleanup = await cleanupPr(runner, input);
  return createOutcome(true, prUrl, cleanup.worktreeRemoved, mergeNotes(inject.note, cleanup.note));
};

const mergeNotes = (a: string | null, b: string | null): string | null => {
  const filtered = [a, b].filter((piece): piece is string => piece !== null && piece.length > 0);
  if (filtered.length === 0) return null;
  return filtered.join("; ");
};
```

5. `finishViaLocalMerge` is unchanged (silently ignores `reviewSummarySection` and `postSummaryComment`; the local path has no PR to update).

**Verify:** `bun test tests/lifecycle/merge.test.ts && bun run typecheck`
**Commit:** `feat(lifecycle): drive PR-first flow with review summary injection`

---

## Batch 4: Lifecycle handle and tool wiring (parallel - 2 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2

### Task 4.1: Wire summary collector + blocked guard into createFinisher
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/index.test.ts` (extend with new cases; do not break existing ones)
**Depends:** 2.1, 2.3, 3.1
**Domain:** backend

```typescript
// tests/lifecycle/index.test.ts (NEW cases to append at end of file; reuse existing FakeRunner harness)
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { createLifecycleStore } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface CallEntry {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
}

const runnerWith = (gh: readonly RunResult[], git: readonly RunResult[] = []) => {
  const calls: CallEntry[] = [];
  let gi = 0;
  let hi = 0;
  const runner: LifecycleRunner = {
    git: async (args) => {
      calls.push({ bin: "git", args });
      const r = git[gi] ?? OK();
      gi += 1;
      return r;
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      const r = gh[hi] ?? OK();
      hi += 1;
      return r;
    },
  };
  return { runner, calls };
};

describe("finish() review summary integration", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join("/tmp", `lifecycle-finish-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("refuses to merge when journal shows a blocked task and returns executor_blocked note", async () => {
    const journal = createJournalStore({ baseDir });
    await journal.append(21, {
      kind: JOURNAL_EVENT_KINDS.REVIEW_COMPLETED,
      batchId: "b1",
      taskId: "1.1",
      attempt: 1,
      summary: "blocked review",
      reviewOutcome: "blocked",
    });

    const { runner } = runnerWith([
      // pre-flight + repo classification
      OK(JSON.stringify({ nameWithOwner: "Wuxie233/micode", isFork: true, owner: { login: "Wuxie233" }, viewerPermission: "ADMIN", hasIssuesEnabled: true })),
      // resolve default branch view
      OK("origin/main"),
    ]);

    const handle = createLifecycleStore({
      runner,
      worktreesRoot: baseDir,
      cwd: baseDir,
      baseDir,
      journal,
    });

    // Seed a record manually to skip start path
    const record = {
      issueNumber: 21,
      issueUrl: "https://github.com/Wuxie233/micode/issues/21",
      branch: "issue/21-x",
      worktree: join(baseDir, "wt"),
      state: LIFECYCLE_STATES.IN_PROGRESS,
      artifacts: {
        [ARTIFACT_KINDS.DESIGN]: [],
        [ARTIFACT_KINDS.PLAN]: [],
        [ARTIFACT_KINDS.LEDGER]: [],
        [ARTIFACT_KINDS.COMMIT]: [],
        [ARTIFACT_KINDS.PR]: [],
        [ARTIFACT_KINDS.WORKTREE]: [],
      },
      notes: [],
      updatedAt: Date.now(),
    };
    await handle.setState(record.issueNumber, LIFECYCLE_STATES.IN_PROGRESS); // will throw if not seeded
    // Note: implementer should follow existing test pattern (see existing index.test.ts) which seeds via store.save.
    // The exact seeding helper is the existing createRecord/saveAndSync test fixture in index.test.ts.

    const outcome = await handle.finish(21, { mergeStrategy: "pr", waitForChecks: false });
    expect(outcome.merged).toBe(false);
    expect(outcome.note ?? "").toContain("executor_blocked");
    expect(outcome.note ?? "").toContain("1.1");
  });
});
```

> Implementer note: the test above is illustrative for the EXACT contract finish() must honour. The actual seeded-record + repo-view harness already lives in `tests/lifecycle/index.test.ts` (see existing helpers `createRunner` and `createRepoView`). Reuse those helpers verbatim and add NEW `it(...)` cases that:
>
> 1. Seed a `LifecycleRecord` via the existing fixture path,
> 2. Append a `REVIEW_COMPLETED` event with `reviewOutcome: "blocked"` to the journal store,
> 3. Call `handle.finish(...)` and assert `merged=false` and `note` contains `executor_blocked: 1.1`.
>
> Add at least three NEW cases:
>
> - Blocked task short-circuits finish (no PR/merge calls fire).
> - Approved tasks pass the guard and reach `finishLifecycle`.
> - When `config.lifecycle.postPrSummaryComment` is true, finish forwards `postSummaryComment: true` to `finishLifecycle`.

Edit `src/lifecycle/index.ts`:

1. Add imports near the top (after the existing `./merge` import):

```typescript
import { detectBlockedTasks } from "./finish-guards";
import { collectReviewSummary, renderReviewSummarySection } from "./review-summary";
```

2. Add a constant near the other `const NAME = "..."` declarations:

```typescript
const EXECUTOR_BLOCKED = "executor_blocked";
```

3. Replace the body of `createFinisher` to thread the summary section + blocked guard:

```typescript
const buildExecutorBlockedNote = (blocked: readonly string[]): string => `${EXECUTOR_BLOCKED}: ${blocked.join(",")}`;

const createFinisher = (context: LifecycleContext): LifecycleHandle["finish"] => {
  return async (issueNumber, finishInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const events = await context.journal.list(issueNumber);

    const blocked = detectBlockedTasks(events);
    if (blocked.length > 0) {
      const note = buildExecutorBlockedNote(blocked);
      const next = await saveAndSync(context, applyFinishOutcome(record, { merged: false, prUrl: null, closedAt: null, worktreeRemoved: false, note }));
      await safeNotify(context, NOTIFICATION_STATUSES.BLOCKED, next, note);
      return { merged: false, prUrl: null, closedAt: null, worktreeRemoved: false, note };
    }

    const merging = await saveAndSync(context, advanceTo(record, LIFECYCLE_STATES.MERGING));
    const summary = collectReviewSummary({ record: merging, events, now: Date.now() });
    const reviewSummarySection = renderReviewSummarySection(summary);
    const resolvedBranch = await resolveDefaultBranch(context.runner, { cwd: context.cwd });
    const finished = await finishLifecycle(context.runner, {
      cwd: context.cwd,
      branch: merging.branch,
      worktree: merging.worktree,
      mergeStrategy: finishInput.mergeStrategy,
      waitForChecks: finishInput.waitForChecks,
      baseBranch: resolvedBranch.branch,
      reviewSummarySection,
      postSummaryComment: config.lifecycle.postPrSummaryComment,
    });
    const annotated = annotateWithResolvedBranch(finished, resolvedBranch);
    const outcome = await closeMergedIssue(context.runner, issueNumber, annotated, context.cwd);
    const promoted = await promoteFinishedRecord(merging, outcome, context);
    const final = await saveAndSync(context, applyFinishOutcome(promoted, outcome));
    await safeEmit(context, issueNumber, `Finished: merged=${outcome.merged}, prUrl=${outcome.prUrl ?? "(none)"}`);
    if (outcome.merged) {
      await safeNotify(context, NOTIFICATION_STATUSES.COMPLETED, final, `merged: ${outcome.prUrl ?? "(local merge)"}`);
    }
    return outcome;
  };
};
```

Do NOT modify any other handler in this file. Keep the existing `createStart`, `createCommitter`, etc. exactly as they are.

**Verify:** `bun test tests/lifecycle/index.test.ts tests/lifecycle/merge.test.ts && bun run typecheck`
**Commit:** `feat(lifecycle): inject AI review summary in finish and guard on blocked tasks`

### Task 4.2: Surface PR + summary outcome in lifecycle_finish tool output
**File:** `src/tools/lifecycle/finish.ts`
**Test:** `tests/tools/lifecycle/finish.test.ts` (extend; create if absent under that path)
**Depends:** 4.1 (handle wiring)
**Domain:** backend

```typescript
// tests/tools/lifecycle/finish.test.ts
import { describe, expect, it } from "bun:test";

import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";

describe("createLifecycleFinishTool output", () => {
  it("renders executor_blocked note as a Blocked header", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: false,
        prUrl: null,
        closedAt: null,
        worktreeRemoved: false,
        note: "executor_blocked: 1.1,1.2",
      }),
    });
    const out = await tool.execute({ issue_number: 21 }, { sessionID: "s", messageID: "m", abort: new AbortController().signal });
    expect(out).toContain("## Lifecycle blocked");
    expect(out).toContain("executor_blocked");
    expect(out).toContain("1.1,1.2");
  });

  it("renders a successful merge with PR url", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: true,
        prUrl: "https://github.com/o/r/pull/12",
        closedAt: 1_700_000_000_000,
        worktreeRemoved: true,
        note: null,
      }),
    });
    const out = await tool.execute({ issue_number: 21 }, { sessionID: "s", messageID: "m", abort: new AbortController().signal });
    expect(out).toContain("## Lifecycle finished");
    expect(out).toContain("https://github.com/o/r/pull/12");
  });

  it("preserves the existing PR-checks-failed header when note starts with pr_checks_failed", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: false,
        prUrl: "https://github.com/o/r/pull/12",
        closedAt: null,
        worktreeRemoved: false,
        note: "pr_checks_failed: ci=FAILURE",
      }),
    });
    const out = await tool.execute({ issue_number: 21 }, { sessionID: "s", messageID: "m", abort: new AbortController().signal });
    expect(out).toContain("## PR checks failed");
  });

  it("renders pr_body_update_failed under the lifecycle finish failed header", async () => {
    const tool = createLifecycleFinishTool({
      finish: async () => ({
        merged: false,
        prUrl: "https://github.com/o/r/pull/12",
        closedAt: null,
        worktreeRemoved: false,
        note: "pr_body_update_failed: permission",
      }),
    });
    const out = await tool.execute({ issue_number: 21 }, { sessionID: "s", messageID: "m", abort: new AbortController().signal });
    expect(out).toContain("## Lifecycle finish failed");
    expect(out).toContain("pr_body_update_failed");
  });
});
```

Edit `src/tools/lifecycle/finish.ts`:

1. Add a new constant alongside the existing header constants:

```typescript
const BLOCKED_HEADER = "## Lifecycle blocked";
const EXECUTOR_BLOCKED_NOTE = "executor_blocked";
```

2. Add a helper next to `hasFailedChecks`:

```typescript
const hasExecutorBlocked = (outcome: FinishOutcome): boolean => {
  return !outcome.merged && outcome.note?.startsWith(EXECUTOR_BLOCKED_NOTE) === true;
};
```

3. Update `formatOutcome` to branch on the new case BEFORE the existing checks-failed branch:

```typescript
const formatOutcome = (issueNumber: number, outcome: FinishOutcome): string => {
  const table = formatTable(issueNumber, outcome);
  if (hasExecutorBlocked(outcome)) return formatReport(BLOCKED_HEADER, table, outcome.note);
  if (hasFailedChecks(outcome)) return formatReport(CHECKS_FAILED_HEADER, table, outcome.note);
  if (!outcome.merged) return formatReport(FAILURE_HEADER, table, outcome.note);
  return formatReport(SUCCESS_HEADER, table, outcome.note);
};
```

Do NOT change the tool's args schema or description. Do NOT change `createFinishInput`.

**Verify:** `bun test tests/tools/lifecycle/finish.test.ts && bun run check`
**Commit:** `feat(tools): surface executor_blocked outcome in lifecycle_finish output`
