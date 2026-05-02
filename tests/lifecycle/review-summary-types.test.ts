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
