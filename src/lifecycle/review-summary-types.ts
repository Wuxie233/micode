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
