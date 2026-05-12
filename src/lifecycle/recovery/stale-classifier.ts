export interface StaleProbe {
  readonly issueNumber: number;
  readonly state: string;
  readonly worktreeExists: boolean;
  readonly worktreeIsRegistered: boolean;
  readonly branchExists: boolean;
  readonly branchMergedIntoBase: boolean;
  readonly issueClosedOnGithub: boolean;
}

export interface StaleClassification {
  readonly stale: boolean;
  readonly reason: string | null;
}

const TERMINAL_LOCAL_STATES: readonly string[] = ["closed", "cleaned", "aborted"];

const fresh = (): StaleClassification => ({ stale: false, reason: null });
const stale = (reason: string): StaleClassification => ({ stale: true, reason });

export function classifyStale(probe: StaleProbe): StaleClassification {
  if (TERMINAL_LOCAL_STATES.includes(probe.state)) return stale(`local_state_terminal: ${probe.state}`);
  if (probe.issueClosedOnGithub) return stale("issue_closed_on_github");
  if (!probe.worktreeExists && !probe.worktreeIsRegistered) return stale("worktree_missing");
  if (!probe.branchExists) return stale("branch_missing");
  if (probe.branchMergedIntoBase) return stale("branch_merged_into_base");
  return fresh();
}
