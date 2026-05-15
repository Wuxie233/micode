import type { RepoKind } from "./pre-flight";

export const BranchCleanupDecisionKind = {
  PRUNE_LOCAL: "prune-local",
  PRUNE_REMOTE: "prune-remote",
  KEEP_ACTIVE: "keep-active",
  KEEP_USER: "keep-user",
  BLOCKED_AMBIGUOUS: "blocked-ambiguous",
  BLOCKED_UPSTREAM: "blocked-upstream",
} as const;

export type BranchCleanupDecisionKind = (typeof BranchCleanupDecisionKind)[keyof typeof BranchCleanupDecisionKind];

export type BranchCleanupScope = "local" | "remote";

export type BranchCleanupRemoteName = string | null;

export type BranchCleanupPreflightKind = RepoKind | null;

export interface BranchLifecycleRecordEvidence {
  readonly lifecycleRecordMatch: boolean;
}

export interface BranchIssueMarkerEvidence {
  readonly issueMarkerMatch: boolean;
}

export interface BranchCommitMarkerEvidence {
  readonly commitMarkerMatch: boolean;
}

export interface BranchRecoveryMarkerEvidence {
  readonly recoveryMarkerMatch: boolean;
}

export interface BranchMergeEvidence {
  readonly branchMerged: boolean;
  readonly noDiffWithBase: boolean;
}

export interface BranchWorktreeUsageEvidence {
  /** True when this branch is registered in a lifecycle/worktree record. */
  readonly registeredWorktreeMatch: boolean;
  /** Non-null when any current git worktree has this branch checked out. */
  readonly activeWorktreePath: string | null;
}

export interface BranchCleanupCandidate
  extends BranchLifecycleRecordEvidence,
    BranchIssueMarkerEvidence,
    BranchCommitMarkerEvidence,
    BranchRecoveryMarkerEvidence,
    BranchMergeEvidence,
    BranchWorktreeUsageEvidence {
  readonly branchName: string;
  readonly scope: BranchCleanupScope;
  readonly remoteName: BranchCleanupRemoteName;
  readonly preflightKind: BranchCleanupPreflightKind;
}

export interface BranchCleanupDecision {
  readonly kind: BranchCleanupDecisionKind;
  readonly reason: string;
}

interface ParsedIssueBranch {
  readonly issueNumber: number;
  readonly slug: string;
}

const ISSUE_BRANCH_PATTERN = /^issue\/([1-9]\d*)-(.+)$/;
const RESCUE_ALL_LOCAL_PREFIX = "rescue/all-local/";
const REMOTE_ALLOWED_KINDS: readonly RepoKind[] = ["fork", "own"];

const normalizeBranchName = (candidate: BranchCleanupCandidate): string => {
  if (candidate.scope !== "remote" || !candidate.remoteName) return candidate.branchName;

  const prefix = `${candidate.remoteName}/`;
  if (candidate.branchName.startsWith(prefix)) return candidate.branchName.slice(prefix.length);
  return candidate.branchName;
};

const parseIssueBranch = (branchName: string): ParsedIssueBranch | null => {
  const match = ISSUE_BRANCH_PATTERN.exec(branchName);
  if (!match) return null;

  return { issueNumber: Number(match[1]), slug: match[2] };
};

const hasLifecycleOwnershipEvidence = (candidate: BranchCleanupCandidate): boolean =>
  candidate.lifecycleRecordMatch ||
  candidate.issueMarkerMatch ||
  candidate.commitMarkerMatch ||
  candidate.registeredWorktreeMatch;

const hasSafeMergeProof = (candidate: BranchCleanupCandidate): boolean =>
  candidate.branchMerged || candidate.noDiffWithBase;

const isRemoteAllowed = (kind: BranchCleanupPreflightKind): boolean =>
  kind !== null && REMOTE_ALLOWED_KINDS.includes(kind);

const pruneDecision = (candidate: BranchCleanupCandidate, reason: string): BranchCleanupDecision => {
  if (candidate.scope === "local") return { kind: BranchCleanupDecisionKind.PRUNE_LOCAL, reason };
  if (isRemoteAllowed(candidate.preflightKind)) return { kind: BranchCleanupDecisionKind.PRUNE_REMOTE, reason };

  return {
    kind: BranchCleanupDecisionKind.BLOCKED_UPSTREAM,
    reason: `remote branch cleanup requires fork/own preflight; got ${candidate.preflightKind ?? "none"}`,
  };
};

export function classifyBranchCleanupCandidate(candidate: BranchCleanupCandidate): BranchCleanupDecision {
  if (candidate.activeWorktreePath !== null) {
    return {
      kind: BranchCleanupDecisionKind.KEEP_ACTIVE,
      reason: `branch is checked out by worktree ${candidate.activeWorktreePath}`,
    };
  }

  const branchName = normalizeBranchName(candidate);

  if (branchName.startsWith(RESCUE_ALL_LOCAL_PREFIX)) {
    if (!candidate.recoveryMarkerMatch) {
      return {
        kind: BranchCleanupDecisionKind.BLOCKED_AMBIGUOUS,
        reason: "rescue branch lacks recovery marker evidence",
      };
    }

    if (!hasSafeMergeProof(candidate)) {
      return {
        kind: BranchCleanupDecisionKind.BLOCKED_AMBIGUOUS,
        reason: "rescue branch is not proven merged or no-diff",
      };
    }

    return pruneDecision(candidate, "rescue branch has recovery marker and merged/no-diff proof");
  }

  if (parseIssueBranch(branchName) === null) {
    return { kind: BranchCleanupDecisionKind.KEEP_USER, reason: "branch is not lifecycle-owned" };
  }

  if (!hasLifecycleOwnershipEvidence(candidate)) {
    return {
      kind: BranchCleanupDecisionKind.BLOCKED_AMBIGUOUS,
      reason: "issue-like branch lacks lifecycle ownership evidence",
    };
  }

  if (!hasSafeMergeProof(candidate)) {
    return {
      kind: BranchCleanupDecisionKind.BLOCKED_AMBIGUOUS,
      reason: "lifecycle-owned branch is not proven merged or no-diff",
    };
  }

  return pruneDecision(candidate, "lifecycle-owned branch has merged/no-diff proof");
}
