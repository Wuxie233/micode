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
