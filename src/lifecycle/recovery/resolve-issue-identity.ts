import { existsSync } from "node:fs";

import type { LifecycleRunner } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, type LifecycleRecord } from "@/lifecycle/types";

const OK_EXIT = 0;
const BRANCH_ARGS = ["rev-parse", "--abbrev-ref", "HEAD"] as const;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;
const WORKTREE_LIST_ARGS = ["worktree", "list", "--porcelain"] as const;
const WORKTREE_PREFIX = "worktree ";
const ISSUE_BRANCH_PATTERN = /^issue\/(\d+)-/;
const ISSUE_PATH_PATTERN = /issue-(\d+)-/;
const MAIN_BRANCH = "main";

export type IdentitySource = "explicit" | "local-record" | "issue-body-artifact" | "git-worktree" | "cwd-fallback";

export interface ResolvedIssueIdentity {
  readonly issueNumber: number;
  readonly branch: string;
  readonly worktree: string;
  readonly source: IdentitySource;
  readonly ambiguous: boolean;
  readonly ambiguityReason: string | null;
}

export interface ResolveIssueIdentityInput {
  readonly runner: LifecycleRunner;
  readonly cwd: string;
  readonly issueNumberHint: number;
  readonly localRecord: LifecycleRecord | null;
  readonly issueBodyArtifacts?: { readonly worktree?: readonly string[] };
  readonly explicit?: { readonly branch: string; readonly worktree: string } | null;
  readonly fsExists?: (path: string) => boolean;
}

interface WorktreeCandidate {
  readonly worktree: string;
  readonly branch: string;
}

const trimOrNull = (s: string): string | null => {
  const t = s.trim();
  return t.length > 0 ? t : null;
};

const branchMatchesIssue = (branch: string, issueNumber: number): boolean =>
  ISSUE_BRANCH_PATTERN.exec(branch)?.[1] === String(issueNumber);

const isHighConfidenceRecord = (record: LifecycleRecord, cwd: string, issueNumberHint: number): boolean => {
  if (record.branch === MAIN_BRANCH) return false;
  if (record.worktree === cwd) return false;
  return branchMatchesIssue(record.branch, record.issueNumber) && branchMatchesIssue(record.branch, issueNumberHint);
};

const readRegisteredWorktrees = async (runner: LifecycleRunner, cwd: string): Promise<readonly string[]> => {
  const run = await runner.git(WORKTREE_LIST_ARGS, { cwd });
  if (run.exitCode !== OK_EXIT) return [];
  return run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(WORKTREE_PREFIX))
    .map((line) => line.slice(WORKTREE_PREFIX.length).trim())
    .filter((p) => p.length > 0);
};

const deriveBranchFromWorktree = async (
  runner: LifecycleRunner,
  worktree: string,
  issueNumber: number,
): Promise<string> => {
  const run = await runner.git(BRANCH_ARGS, { cwd: worktree });
  const branch = run.exitCode === OK_EXIT ? trimOrNull(run.stdout) : null;
  if (branch && branch !== MAIN_BRANCH) return branch;

  const match = ISSUE_PATH_PATTERN.exec(worktree);
  const slug = match ? worktree.slice(worktree.indexOf(`issue-${match[1]}-`)).replace(/^issue-/, "issue/") : null;
  return slug ?? `issue/${issueNumber}-x`;
};

const readGitWorktree = async (
  runner: LifecycleRunner,
  cwd: string,
): Promise<{ readonly branch: string | null; readonly worktree: string }> => {
  const [branchRun, topRun] = await Promise.all([runner.git(BRANCH_ARGS, { cwd }), runner.git(TOPLEVEL_ARGS, { cwd })]);
  const branch = branchRun.exitCode === OK_EXIT ? trimOrNull(branchRun.stdout) : null;
  const top = topRun.exitCode === OK_EXIT ? trimOrNull(topRun.stdout) : null;
  return { branch, worktree: top ?? cwd };
};

const resolvedIdentity = (input: {
  readonly issueNumber: number;
  readonly branch: string;
  readonly worktree: string;
  readonly source: IdentitySource;
  readonly ambiguous?: boolean;
  readonly ambiguityReason?: string | null;
}): ResolvedIssueIdentity => ({
  issueNumber: input.issueNumber,
  branch: input.branch,
  worktree: input.worktree,
  source: input.source,
  ambiguous: input.ambiguous ?? false,
  ambiguityReason: input.ambiguityReason ?? null,
});

const explicitIdentity = (input: ResolveIssueIdentityInput): ResolvedIssueIdentity | null => {
  if (!input.explicit) return null;
  return resolvedIdentity({
    issueNumber: input.issueNumberHint,
    branch: input.explicit.branch,
    worktree: input.explicit.worktree,
    source: "explicit",
  });
};

const localRecordIdentity = (input: ResolveIssueIdentityInput): ResolvedIssueIdentity | null => {
  const { localRecord, cwd, issueNumberHint } = input;
  if (!localRecord || !isHighConfidenceRecord(localRecord, cwd, issueNumberHint)) return null;
  return resolvedIdentity({
    issueNumber: localRecord.issueNumber,
    branch: localRecord.branch,
    worktree: localRecord.worktree,
    source: "local-record",
  });
};

const artifactWorktrees = (input: ResolveIssueIdentityInput): readonly string[] =>
  input.issueBodyArtifacts?.worktree ?? input.localRecord?.artifacts[ARTIFACT_KINDS.WORKTREE] ?? [];

const collectArtifactCandidates = async (
  input: ResolveIssueIdentityInput,
  exists: (path: string) => boolean,
): Promise<readonly WorktreeCandidate[]> => {
  const artifacts = artifactWorktrees(input);
  const registered = artifacts.length > 0 ? await readRegisteredWorktrees(input.runner, input.cwd) : [];
  const validArtifactCandidates = [] as WorktreeCandidate[];
  for (const candidate of artifacts) {
    const isRegistered = registered.includes(candidate);
    if (!isRegistered && !exists(candidate)) continue;
    if (!isRegistered) continue;
    const branch = await deriveBranchFromWorktree(input.runner, candidate, input.issueNumberHint);
    if (!branchMatchesIssue(branch, input.issueNumberHint)) continue;
    validArtifactCandidates.push({ worktree: candidate, branch });
  }
  return validArtifactCandidates;
};

const resolveArtifactIdentity = async (
  input: ResolveIssueIdentityInput,
  candidates: readonly WorktreeCandidate[],
): Promise<ResolvedIssueIdentity | null> => {
  if (candidates.length > 1) {
    const id = await readGitWorktree(input.runner, input.cwd);
    return resolvedIdentity({
      issueNumber: input.issueNumberHint,
      branch: id.branch ?? MAIN_BRANCH,
      worktree: id.worktree,
      source: id.branch && ISSUE_BRANCH_PATTERN.test(id.branch) ? "git-worktree" : "cwd-fallback",
      ambiguous: true,
      ambiguityReason: `multiple_worktree_artifacts: ${candidates.length}`,
    });
  }

  const candidate = candidates[0];
  if (!candidate) return null;
  return resolvedIdentity({
    issueNumber: input.issueNumberHint,
    branch: candidate.branch,
    worktree: candidate.worktree,
    source: "issue-body-artifact",
  });
};

const resolveGitIdentity = async (input: ResolveIssueIdentityInput): Promise<ResolvedIssueIdentity> => {
  const fromGit = await readGitWorktree(input.runner, input.cwd);
  if (fromGit.branch && branchMatchesIssue(fromGit.branch, input.issueNumberHint)) {
    return resolvedIdentity({
      issueNumber: input.issueNumberHint,
      branch: fromGit.branch,
      worktree: fromGit.worktree,
      source: "git-worktree",
    });
  }

  return resolvedIdentity({
    issueNumber: input.issueNumberHint,
    branch: fromGit.branch ?? MAIN_BRANCH,
    worktree: fromGit.worktree,
    source: "cwd-fallback",
  });
};

export async function resolveIssueIdentity(input: ResolveIssueIdentityInput): Promise<ResolvedIssueIdentity> {
  const explicit = explicitIdentity(input);
  if (explicit) return explicit;

  const local = localRecordIdentity(input);
  if (local) return local;

  const candidates = await collectArtifactCandidates(input, input.fsExists ?? existsSync);
  const artifact = await resolveArtifactIdentity(input, candidates);
  if (artifact) return artifact;

  return resolveGitIdentity(input);
}
