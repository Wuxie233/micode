export const RECOVERY_DECISION_KINDS = {
  CLEAN_RESUME: "clean_resume",
  RECONCILED_RESUME: "reconciled_resume",
  PARTIAL_RESUME: "partial_resume",
  BLOCKED: "blocked",
} as const;

export type RecoveryDecisionKind = (typeof RECOVERY_DECISION_KINDS)[keyof typeof RECOVERY_DECISION_KINDS];

export type RecoveryBlockReason =
  | "branch_mismatch"
  | "worktree_mismatch"
  | "origin_mismatch"
  | "lease_active"
  | "needs_reconcile"
  | "issue_closed"
  | "journal_corrupt"
  | "no_lifecycle";

export interface CleanResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.CLEAN_RESUME;
  readonly nextBatchId: string | null;
  readonly lastSeq: number;
}

export interface ReconciledResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.RECONCILED_RESUME;
  readonly backfilledBatches: readonly string[];
  readonly nextBatchId: string | null;
  readonly lastSeq: number;
}

export interface PartialResumeDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.PARTIAL_RESUME;
  readonly completedBatches: readonly string[];
  readonly pendingBatchId: string;
  readonly note: string;
  readonly lastSeq: number;
}

export interface BlockedDecision {
  readonly kind: typeof RECOVERY_DECISION_KINDS.BLOCKED;
  readonly reason: RecoveryBlockReason;
  readonly detail: string;
  readonly lastSeq: number;
}

export type RecoveryDecision = CleanResumeDecision | ReconciledResumeDecision | PartialResumeDecision | BlockedDecision;
