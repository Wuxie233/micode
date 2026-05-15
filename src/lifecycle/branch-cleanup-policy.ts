import {
  type BranchCleanupCandidate,
  BranchCleanupDecisionKind,
  type BranchCleanupScope,
  classifyBranchCleanupCandidate,
} from "./branch-cleanup";
import { assertRemoteMutationAllowed, type PreFlightResult } from "./pre-flight";
import type { LifecycleRunner, RunResult } from "./runner";
import type { LifecycleRecord } from "./types";

export interface BranchCleanupAuditInput {
  readonly cwd: string;
  readonly baseBranch: string;
  readonly records: readonly LifecycleRecord[];
  readonly preflight?: PreFlightResult;
  /** Defaults to true: audit first, mutate only when explicitly disabled. */
  readonly dryRun?: boolean;
}

export interface BranchCleanupAuditEntry {
  readonly candidate: BranchCleanupCandidate;
  readonly decision: ReturnType<typeof classifyBranchCleanupCandidate>;
  readonly pruned: boolean;
  readonly mutationSkippedReason: string | null;
  readonly mutationError: string | null;
}

const OK_EXIT_CODE = 0;
const EMPTY_OUTPUT = "";
const ORIGIN_REMOTE = "origin";
const LOCAL_PATTERNS = ["issue/*", "rescue/all-local/*"] as const;
const REMOTE_PATTERNS = ["origin/issue/*", "origin/rescue/all-local/*"] as const;
const ISSUE_BRANCH_PATTERN = /^issue\/([1-9]\d*)-.+$/;
const RESCUE_ALL_LOCAL_PREFIX = "rescue/all-local/";
const RECOVERY_MARKER_PATTERN = /(?:micode:lc[^\n]*recovery|recovery|rescue\/all-local)/i;

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const splitLines = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const parseBranches = (stdout: string): readonly string[] =>
  splitLines(stdout)
    .map((line) => line.replace(/^\*\s*/, "").trim())
    .filter((line) => !line.includes(" -> "));

const normalizeBranchName = (branchName: string, remoteName: string | null): string => {
  if (remoteName === null) return branchName;

  const prefix = `${remoteName}/`;
  if (branchName.startsWith(prefix)) return branchName.slice(prefix.length);
  return branchName;
};

const parseIssueNumber = (branchName: string): number | null => {
  const match = ISSUE_BRANCH_PATTERN.exec(branchName);
  const raw = match?.[1];
  if (!raw) return null;

  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const formatRunFailure = (run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length === 0) return `exit ${run.exitCode}`;
  return pieces.join(" ");
};

const findRecord = (records: readonly LifecycleRecord[], branchName: string): LifecycleRecord | null =>
  records.find((record) => record.branch === branchName) ?? null;

const hasIssueRecord = (records: readonly LifecycleRecord[], branchName: string): boolean => {
  const issueNumber = parseIssueNumber(branchName);
  if (issueNumber === null) return false;
  return records.some((record) => record.issueNumber === issueNumber);
};

interface WorktreeBranchUsage {
  readonly branchName: string;
  readonly path: string;
}

const parseWorktreeUsage = (stdout: string): readonly WorktreeBranchUsage[] => {
  const usages: WorktreeBranchUsage[] = [];
  let path: string | null = null;

  for (const line of splitLines(stdout)) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
      continue;
    }

    if (!line.startsWith("branch ") || path === null) continue;
    const ref = line.slice("branch ".length);
    const prefix = "refs/heads/";
    if (!ref.startsWith(prefix)) continue;
    usages.push({ branchName: ref.slice(prefix.length), path });
  }

  return usages;
};

const getActiveWorktreePath = (usages: readonly WorktreeBranchUsage[], branchName: string): string | null =>
  usages.find((usage) => usage.branchName === branchName)?.path ?? null;

const gatherBooleanEvidence = async (
  runner: LifecycleRunner,
  cwd: string,
  args: readonly string[],
): Promise<boolean> => {
  const result = await runner.git(args, { cwd });
  return completed(result);
};

const gatherCommitMarkerEvidence = async (
  runner: LifecycleRunner,
  cwd: string,
  ref: string,
  branchName: string,
): Promise<{ readonly commitMarkerMatch: boolean; readonly recoveryMarkerMatch: boolean }> => {
  const result = await runner.git(["log", "-1", "--format=%B", ref], { cwd });
  if (!completed(result)) return { commitMarkerMatch: false, recoveryMarkerMatch: false };

  const issueNumber = parseIssueNumber(branchName);
  const commitMarkerMatch = issueNumber !== null && result.stdout.includes(`issue=${issueNumber}`);
  const recoveryMarkerMatch =
    branchName.startsWith(RESCUE_ALL_LOCAL_PREFIX) && RECOVERY_MARKER_PATTERN.test(result.stdout);
  return { commitMarkerMatch, recoveryMarkerMatch };
};

const buildCandidate = async (
  runner: LifecycleRunner,
  input: BranchCleanupAuditInput,
  branchName: string,
  scope: BranchCleanupScope,
  remoteName: string | null,
  worktreeUsages: readonly WorktreeBranchUsage[],
): Promise<BranchCleanupCandidate> => {
  const normalizedBranch = normalizeBranchName(branchName, remoteName);
  const record = findRecord(input.records, normalizedBranch);
  const ref = scope === "remote" ? branchName : normalizedBranch;
  const [branchMerged, noDiffWithBase, markerEvidence] = await Promise.all([
    gatherBooleanEvidence(runner, input.cwd, ["merge-base", "--is-ancestor", ref, input.baseBranch]),
    gatherBooleanEvidence(runner, input.cwd, ["diff", "--quiet", `${input.baseBranch}...${ref}`]),
    gatherCommitMarkerEvidence(runner, input.cwd, ref, normalizedBranch),
  ]);

  return {
    branchName,
    scope,
    remoteName,
    preflightKind: input.preflight?.kind ?? null,
    lifecycleRecordMatch: record !== null,
    issueMarkerMatch: hasIssueRecord(input.records, normalizedBranch),
    commitMarkerMatch: markerEvidence.commitMarkerMatch,
    recoveryMarkerMatch: markerEvidence.recoveryMarkerMatch,
    branchMerged,
    noDiffWithBase,
    registeredWorktreeMatch: record !== null,
    activeWorktreePath: getActiveWorktreePath(worktreeUsages, normalizedBranch),
  };
};

const pruneLocal = async (
  runner: LifecycleRunner,
  cwd: string,
  candidate: BranchCleanupCandidate,
): Promise<Pick<BranchCleanupAuditEntry, "pruned" | "mutationError">> => {
  const result = await runner.git(["branch", "-d", candidate.branchName], { cwd });
  if (completed(result)) return { pruned: true, mutationError: null };
  return { pruned: false, mutationError: `git_branch_delete: ${formatRunFailure(result)}` };
};

const pruneRemote = async (
  runner: LifecycleRunner,
  cwd: string,
  preflight: PreFlightResult | undefined,
  candidate: BranchCleanupCandidate,
): Promise<
  Pick<BranchCleanupAuditEntry, "pruned" | "mutationError"> & { readonly gateBlockedReason: string | null }
> => {
  if (!preflight) return { pruned: false, mutationError: null, gateBlockedReason: "missing-preflight" };

  const gate = assertRemoteMutationAllowed(preflight, "remote-branch-delete");
  if (!gate.ok) return { pruned: false, mutationError: null, gateBlockedReason: gate.note };

  const remoteName = candidate.remoteName ?? EMPTY_OUTPUT;
  if (remoteName !== ORIGIN_REMOTE) {
    return { pruned: false, mutationError: null, gateBlockedReason: `remote ${remoteName} is not ${ORIGIN_REMOTE}` };
  }

  const remoteBranch = normalizeBranchName(candidate.branchName, remoteName);
  const result = await runner.git(["push", ORIGIN_REMOTE, "--delete", remoteBranch], { cwd });
  if (completed(result)) return { pruned: true, mutationError: null, gateBlockedReason: null };
  return { pruned: false, mutationError: `git_push_delete: ${formatRunFailure(result)}`, gateBlockedReason: null };
};

const executeDecision = async (
  runner: LifecycleRunner,
  input: BranchCleanupAuditInput,
  candidate: BranchCleanupCandidate,
): Promise<BranchCleanupAuditEntry> => {
  const decision = classifyBranchCleanupCandidate(candidate);
  const dryRun = input.dryRun ?? true;

  if (
    decision.kind !== BranchCleanupDecisionKind.PRUNE_LOCAL &&
    decision.kind !== BranchCleanupDecisionKind.PRUNE_REMOTE
  ) {
    return { candidate, decision, pruned: false, mutationSkippedReason: decision.reason, mutationError: null };
  }

  if (dryRun) return { candidate, decision, pruned: false, mutationSkippedReason: "dry-run", mutationError: null };

  if (decision.kind === BranchCleanupDecisionKind.PRUNE_LOCAL) {
    const mutation = await pruneLocal(runner, input.cwd, candidate);
    return { candidate, decision, ...mutation, mutationSkippedReason: mutation.pruned ? null : "mutation-failed" };
  }

  const mutation = await pruneRemote(runner, input.cwd, input.preflight, candidate);
  return {
    candidate,
    decision,
    pruned: mutation.pruned,
    mutationSkippedReason: mutation.gateBlockedReason ?? (mutation.pruned ? null : "mutation-failed"),
    mutationError: mutation.mutationError,
  };
};

export async function auditLifecycleBranches(
  runner: LifecycleRunner,
  input: BranchCleanupAuditInput,
): Promise<readonly BranchCleanupAuditEntry[]> {
  const worktreeInspection = await runner.git(["worktree", "list", "--porcelain"], { cwd: input.cwd });
  const worktreeUsages = completed(worktreeInspection) ? parseWorktreeUsage(worktreeInspection.stdout) : [];

  const localBranches = parseBranches(
    (await runner.git(["branch", "--list", ...LOCAL_PATTERNS], { cwd: input.cwd })).stdout,
  );
  const remoteBranches = input.preflight
    ? parseBranches((await runner.git(["branch", "-r", "--list", ...REMOTE_PATTERNS], { cwd: input.cwd })).stdout)
    : [];

  const candidates = await Promise.all([
    ...localBranches.map((branchName) => buildCandidate(runner, input, branchName, "local", null, worktreeUsages)),
    ...remoteBranches.map((branchName) =>
      buildCandidate(runner, input, branchName, "remote", ORIGIN_REMOTE, worktreeUsages),
    ),
  ]);

  const report: BranchCleanupAuditEntry[] = [];
  for (const candidate of candidates) {
    // Keep one mutation at a time even though evidence collection above is parallel.
    report.push(await executeDecision(runner, input, candidate));
  }

  return report;
}
