export type LostUpdateAuditKind =
  | "visible_branch_topology"
  | "remote_tracking_reflog"
  | "pr_history"
  | "lifecycle_issue_comments"
  | "force-push"
  | "squash"
  | "semantic-overwrite"
  | "manual-remote-mutation"
  | "push-rejection-race"
  | "inconclusive";

export interface LostUpdateAuditStep {
  readonly kind: LostUpdateAuditKind;
  readonly title: string;
  readonly command: string;
  readonly readOnly: true;
}

export interface LostUpdateAuditPlanInput {
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly suspectedBranch: string;
}

export interface LostUpdateAuditPlan {
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly suspectedBranch: string;
  readonly steps: readonly LostUpdateAuditStep[];
  readonly limitation: string;
}

export interface LostUpdateEvidenceInput {
  readonly forcePush?: boolean;
  readonly squashMerge?: boolean;
  readonly semanticOverwrite?: boolean;
  readonly manualRemoteMutation?: boolean;
  readonly pushRejectionRace?: boolean;
}

export interface LostUpdateClassification {
  readonly kind: LostUpdateAuditKind;
  readonly severity: "high" | "medium" | "low";
}

const LIMITATION =
  "This audit is read-only/evidence-based and cannot prove absence of force-push without provider audit logs.";

export function createLostUpdateAuditPlan(input: LostUpdateAuditPlanInput): LostUpdateAuditPlan {
  return {
    issueNumber: input.issueNumber,
    baseBranch: input.baseBranch,
    suspectedBranch: input.suspectedBranch,
    steps: [
      {
        kind: "visible_branch_topology",
        title: "Visible branch topology",
        command: "git log --graph --decorate --oneline --all --boundary",
        readOnly: true,
      },
      {
        kind: "remote_tracking_reflog",
        title: "Remote-tracking reflog",
        command: `git reflog show --date=iso origin/${input.baseBranch}`,
        readOnly: true,
      },
      {
        kind: "pr_history",
        title: "PR history",
        command: `gh pr list --state all --search issue/${input.issueNumber}`,
        readOnly: true,
      },
      {
        kind: "lifecycle_issue_comments",
        title: "Lifecycle issue comments",
        command: `gh issue view ${input.issueNumber} --comments`,
        readOnly: true,
      },
    ],
    limitation: LIMITATION,
  };
}

export function classifyLostUpdateEvidence(input: LostUpdateEvidenceInput): LostUpdateClassification {
  if (input.forcePush) return { kind: "force-push", severity: "high" };
  if (input.squashMerge) return { kind: "squash", severity: "medium" };
  if (input.semanticOverwrite) return { kind: "semantic-overwrite", severity: "medium" };
  if (input.manualRemoteMutation) return { kind: "manual-remote-mutation", severity: "medium" };
  if (input.pushRejectionRace) return { kind: "push-rejection-race", severity: "medium" };
  return { kind: "inconclusive", severity: "low" };
}
