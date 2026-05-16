import { classifyRepo, type PreFlightResult, REPO_KIND } from "./pre-flight";
import { buildHint, type LifecycleRecoveryHint } from "./recovery/hint";
import type { LifecycleRunner } from "./runner";

export const REMOTE_WRITE_BLOCKED_NOTE = "remote_write_blocked";

export type RemoteWriteOperation =
  | "lifecycle_commit"
  | "lifecycle_finish"
  | "lifecycle_finish_pr"
  | "lifecycle_finish_local_merge"
  | "lifecycle_issue_sync"
  | "lifecycle_issue_close";

export interface EvaluateRemoteWriteGuardInput {
  readonly runner: LifecycleRunner;
  readonly cwd: string;
  readonly operation: RemoteWriteOperation;
  readonly issueNumber?: number | null;
  readonly branch?: string | null;
  readonly worktree?: string | null;
  readonly preflight?: PreFlightResult;
}

export type RemoteWriteGuardOutcome =
  | {
      readonly allowed: true;
      readonly preflight: PreFlightResult;
      readonly note?: undefined;
      readonly recoveryHint?: undefined;
    }
  | {
      readonly allowed: false;
      readonly preflight: PreFlightResult;
      readonly note: typeof REMOTE_WRITE_BLOCKED_NOTE;
      readonly recoveryHint: LifecycleRecoveryHint;
    };

const isAllowedRepoKind = (preflight: PreFlightResult): boolean =>
  preflight.kind === REPO_KIND.FORK || preflight.kind === REPO_KIND.OWN;

const describeBlockedTarget = (preflight: PreFlightResult): string => {
  if (preflight.kind === REPO_KIND.UPSTREAM) return `upstream/read-only repository ${preflight.nameWithOwner}`;
  if (preflight.origin.length > 0) return `unknown repository origin ${preflight.origin}`;
  return "unknown repository origin";
};

const createRecoveryHint = (input: EvaluateRemoteWriteGuardInput, preflight: PreFlightResult): LifecycleRecoveryHint =>
  buildHint({
    failureKind: "unknown",
    recommendedNextAction: "ask_user",
    summary: `blocked ${input.operation} remote write for ${describeBlockedTarget(preflight)}`,
    safeToRetry: false,
    issueNumber: input.issueNumber,
    branch: input.branch,
    worktree: input.worktree,
  });

export async function evaluateRemoteWriteGuard(input: EvaluateRemoteWriteGuardInput): Promise<RemoteWriteGuardOutcome> {
  const preflight = input.preflight ?? (await classifyRepo(input.runner, input.cwd));
  if (isAllowedRepoKind(preflight)) return { allowed: true, preflight };

  return {
    allowed: false,
    preflight,
    note: REMOTE_WRITE_BLOCKED_NOTE,
    recoveryHint: createRecoveryHint(input, preflight),
  };
}
