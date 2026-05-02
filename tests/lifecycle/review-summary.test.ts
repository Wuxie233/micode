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

const reviewEvent = (taskId: string, outcome: JournalEvent["reviewOutcome"], seq: number): JournalEvent => ({
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
    const events: JournalEvent[] = [reviewEvent("1.1", "changes_requested", 1), reviewEvent("1.1", "approved", 2)];
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
    const events: JournalEvent[] = [reviewEvent("1.1", "approved", 1), reviewEvent("1.2", "changes_requested", 2)];
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
