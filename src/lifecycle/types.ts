export const LIFECYCLE_STATES = {
  PROPOSED: "proposed",
  ISSUE_OPEN: "issue_open",
  BRANCH_READY: "branch_ready",
  IN_DESIGN: "in_design",
  IN_PLAN: "in_plan",
  IN_PROGRESS: "in_progress",
  TESTED: "tested",
  MERGING: "merging",
  CLOSED: "closed",
  CLEANED: "cleaned",
  ABORTED: "aborted",
} as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[keyof typeof LIFECYCLE_STATES];

export const TERMINAL_STATES = [LIFECYCLE_STATES.CLOSED, LIFECYCLE_STATES.CLEANED, LIFECYCLE_STATES.ABORTED] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export const ARTIFACT_KINDS = {
  DESIGN: "design",
  PLAN: "plan",
  LEDGER: "ledger",
  COMMIT: "commit",
  PR: "pr",
  WORKTREE: "worktree",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[keyof typeof ARTIFACT_KINDS];

export interface StartRequestInput {
  readonly summary: string;
  readonly goals: readonly string[];
  readonly constraints: readonly string[];
}

export interface LifecycleRecord {
  readonly issueNumber: number;
  readonly issueUrl: string;
  readonly branch: string;
  readonly worktree: string;
  readonly state: LifecycleState;
  readonly artifacts: Readonly<Record<ArtifactKind, readonly string[]>>;
  readonly notes: readonly string[];
  readonly updatedAt: number;
}

export interface CommitInput {
  readonly summary: string;
  readonly scope: string;
  readonly push: boolean;
  readonly batchId?: string;
  readonly taskId?: string;
  readonly attempt?: number;
}

export interface CommitOutcome {
  readonly committed: boolean;
  readonly sha: string | null;
  readonly pushed: boolean;
  readonly retried: boolean;
  readonly note: string | null;
}

export interface FinishInput {
  readonly mergeStrategy: "pr" | "local-merge";
  readonly waitForChecks: boolean;
}

export interface FinishOutcome {
  readonly merged: boolean;
  readonly prUrl: string | null;
  readonly closedAt: number | null;
  readonly worktreeRemoved: boolean;
  readonly note: string | null;
}
