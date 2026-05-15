import { existsSync } from "node:fs";

import * as v from "valibot";

import { LifecycleRecordSchema } from "@/lifecycle/schemas";
import { parseIssueBody } from "./issue-body";
import type { LifecycleCandidateSummary } from "./recovery/hint";
import { classifyStale } from "./recovery/stale-classifier";
import type { LifecycleRunner } from "./runner";
import type { LifecycleStore } from "./store";
import {
  ARTIFACT_KINDS,
  type ArtifactKind,
  isLocalIssueNumber,
  isLocalOnlyLifecycleRecord,
  LIFECYCLE_STATES,
  type LifecycleRecord,
} from "./types";

export type { LifecycleCandidateSummary } from "./recovery/hint";

export type ResolverResult =
  | { readonly kind: "resolved"; readonly record: LifecycleRecord }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly LifecycleCandidateSummary[] };

export interface ResolverDeps {
  readonly runner: LifecycleRunner;
  readonly store: LifecycleStore;
  readonly cwd: string;
}

export interface Resolver {
  readonly current: () => Promise<ResolverResult>;
  readonly resume: (issueNumber: number) => Promise<LifecycleRecord>;
  readonly forceRefresh: (issueNumber: number) => Promise<LifecycleRecord>;
  readonly resolveExplicit: (issueNumber: number) => Promise<LifecycleRecord>;
  readonly listRecords: () => Promise<readonly LifecycleRecord[]>;
}

export class StaleRecordError extends Error {
  constructor(readonly summary: LifecycleCandidateSummary) {
    super(`stale_record: #${summary.issueNumber} ${summary.staleReason ?? "stale"}`);
    this.name = "StaleRecordError";
  }
}

const BRANCH_PATTERN = /^issue\/(-?\d+)-/;
const OK_EXIT_CODE = 0;
const DECIMAL_RADIX = 10;
const NOT_LIFECYCLE_ISSUE = "not_a_lifecycle_issue";
const ISSUE_NOT_FOUND = "issue_not_found";
const BRANCH_ARGS = ["rev-parse", "--abbrev-ref", "HEAD"] as const;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;
const ISSUE_VIEW_FIELDS = "body";
const LOCAL_ONLY_RECONSTRUCT_UNAVAILABLE = "local-only records cannot be reconstructed from GitHub";
const GIT_SHOW_REF = "show-ref";
const GIT_VERIFY = "--verify";
const GIT_QUIET = "--quiet";
const GIT_MERGE_BASE = "merge-base";
const GIT_IS_ANCESTOR = "--is-ancestor";
const GIT_WORKTREE = "worktree";
const GIT_LIST = "list";
const GIT_PORCELAIN = "--porcelain";
const LOCAL_REF_PREFIX = "refs/heads/";
const REMOTE_REF_PREFIX = "refs/remotes/origin/";
const WORKTREE_PREFIX = "worktree ";
const CURRENT_HEAD = "HEAD";

const readBranch = async (deps: ResolverDeps): Promise<string | null> => {
  const run = await deps.runner.git(BRANCH_ARGS, { cwd: deps.cwd });
  if (run.exitCode !== OK_EXIT_CODE) return null;
  const branch = run.stdout.trim();
  return branch.length > 0 ? branch : null;
};

const readWorktree = async (deps: ResolverDeps): Promise<string> => {
  const run = await deps.runner.git(TOPLEVEL_ARGS, { cwd: deps.cwd });
  if (run.exitCode !== OK_EXIT_CODE) return deps.cwd;
  const top = run.stdout.trim();
  return top.length > 0 ? top : deps.cwd;
};

const matchBranchIssue = (branch: string): number | null => {
  const match = BRANCH_PATTERN.exec(branch);
  const raw = match?.[1];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (Number.isSafeInteger(parsed) && parsed !== 0) return parsed;
  return null;
};

const issueNumberMatchesRecord = (issueNumber: number, record: LifecycleRecord): boolean => {
  if (record.issueNumber === issueNumber) return true;
  return isLocalIssueNumber(issueNumber) && isLocalOnlyLifecycleRecord(record);
};

const emptyArtifacts = (): Readonly<Record<ArtifactKind, readonly string[]>> => ({
  [ARTIFACT_KINDS.DESIGN]: [],
  [ARTIFACT_KINDS.PLAN]: [],
  [ARTIFACT_KINDS.LEDGER]: [],
  [ARTIFACT_KINDS.COMMIT]: [],
  [ARTIFACT_KINDS.PR]: [],
  [ARTIFACT_KINDS.WORKTREE]: [],
});

const reconstructFromBody = async (deps: ResolverDeps, issueNumber: number, body: string): Promise<LifecycleRecord> => {
  const parsed = parseIssueBody(body);
  const hasMarkers = parsed.state !== undefined || parsed.artifacts !== undefined;
  if (!hasMarkers) throw new Error(`${NOT_LIFECYCLE_ISSUE}: #${issueNumber}`);

  const branch = (await readBranch(deps)) ?? `issue/${issueNumber}`;
  const worktree = await readWorktree(deps);
  const candidate: LifecycleRecord = {
    issueNumber,
    issueUrl: "",
    branch,
    worktree,
    state: parsed.state ?? LIFECYCLE_STATES.IN_PROGRESS,
    artifacts: parsed.artifacts ?? emptyArtifacts(),
    notes: [],
    updatedAt: Date.now(),
  };

  const validated = v.safeParse(LifecycleRecordSchema, candidate);
  if (!validated.success) throw new Error(`${NOT_LIFECYCLE_ISSUE}: schema_invalid #${issueNumber}`);
  return validated.output;
};

const extractIssueBody = (stdout: string): string => {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (parsed && typeof parsed === "object" && "body" in parsed) {
      const candidate = (parsed as { body?: unknown }).body;
      return typeof candidate === "string" ? candidate : "";
    }
    return "";
  } catch {
    // Older gh emits plain text rather than JSON.
    return stdout;
  }
};

const viewIssueBody = async (deps: ResolverDeps, issueNumber: number): Promise<string> => {
  const view = await deps.runner.gh(["issue", "view", String(issueNumber), "--json", ISSUE_VIEW_FIELDS], {
    cwd: deps.cwd,
  });
  if (view.exitCode !== OK_EXIT_CODE) throw new Error(`${ISSUE_NOT_FOUND}: #${issueNumber}`);
  return extractIssueBody(view.stdout);
};

const refreshFromIssueBody = async (deps: ResolverDeps, issueNumber: number): Promise<LifecycleRecord> => {
  if (isLocalIssueNumber(issueNumber)) throw new Error(LOCAL_ONLY_RECONSTRUCT_UNAVAILABLE);
  const body = await viewIssueBody(deps, issueNumber);
  const record = await reconstructFromBody(deps, issueNumber, body);
  await deps.store.save(record);
  return record;
};

const branchRefExists = async (deps: ResolverDeps, ref: string): Promise<boolean> => {
  const run = await deps.runner.git([GIT_SHOW_REF, GIT_VERIFY, GIT_QUIET, ref], { cwd: deps.cwd });
  return run.exitCode === OK_EXIT_CODE;
};

const branchExists = async (deps: ResolverDeps, branch: string): Promise<boolean> => {
  if (await branchRefExists(deps, `${LOCAL_REF_PREFIX}${branch}`)) return true;
  return branchRefExists(deps, `${REMOTE_REF_PREFIX}${branch}`);
};

const resolveBranchRef = async (deps: ResolverDeps, branch: string): Promise<string | null> => {
  const localRef = `${LOCAL_REF_PREFIX}${branch}`;
  if (await branchRefExists(deps, localRef)) return localRef;
  const remoteRef = `${REMOTE_REF_PREFIX}${branch}`;
  if (await branchRefExists(deps, remoteRef)) return remoteRef;
  return null;
};

const branchMergedIntoHead = async (deps: ResolverDeps, branch: string): Promise<boolean> => {
  const ref = await resolveBranchRef(deps, branch);
  if (ref === null) return false;
  const run = await deps.runner.git([GIT_MERGE_BASE, GIT_IS_ANCESTOR, ref, CURRENT_HEAD], { cwd: deps.cwd });
  return run.exitCode === OK_EXIT_CODE;
};

const readRegisteredWorktrees = async (deps: ResolverDeps): Promise<readonly string[] | null> => {
  const run = await deps.runner.git([GIT_WORKTREE, GIT_LIST, GIT_PORCELAIN], { cwd: deps.cwd });
  if (run.exitCode !== OK_EXIT_CODE) return null;
  const trimmed = run.stdout.trim();
  if (trimmed.length === 0) return null;
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(WORKTREE_PREFIX))
    .map((line) => line.slice(WORKTREE_PREFIX.length).trim())
    .filter((path) => path.length > 0);
};

const worktreeIsRegistered = async (deps: ResolverDeps, worktree: string): Promise<boolean> => {
  const registered = await readRegisteredWorktrees(deps);
  if (registered === null) return true;
  return registered.includes(worktree);
};

const summarizeRecord = async (deps: ResolverDeps, record: LifecycleRecord): Promise<LifecycleCandidateSummary> => {
  const exists = await branchExists(deps, record.branch);
  const classification = classifyStale({
    issueNumber: record.issueNumber,
    state: record.state,
    worktreeExists: existsSync(record.worktree),
    worktreeIsRegistered: await worktreeIsRegistered(deps, record.worktree),
    branchExists: exists,
    branchMergedIntoBase: exists ? await branchMergedIntoHead(deps, record.branch) : false,
    issueClosedOnGithub: false,
  });

  return {
    issueNumber: record.issueNumber,
    branch: record.branch,
    worktree: record.worktree,
    state: record.state,
    stale: classification.stale,
    staleReason: classification.reason,
  };
};

const loadOpenRecords = async (deps: ResolverDeps): Promise<readonly LifecycleRecord[]> => {
  const open = await deps.store.listOpen();
  const records: LifecycleRecord[] = [];
  for (const issueNumber of open) {
    const record = await deps.store.load(issueNumber);
    if (record !== null) records.push(record);
  }
  return records;
};

const loadAllRecords = async (deps: ResolverDeps): Promise<readonly LifecycleRecord[]> => {
  const issues = await deps.store.list();
  const records: LifecycleRecord[] = [];
  for (const issueNumber of issues) {
    const record = await deps.store.load(issueNumber);
    if (record !== null) records.push(record);
  }
  return records;
};

const resolveFromBranch = async (deps: ResolverDeps): Promise<ResolverResult | null> => {
  const branch = await readBranch(deps);
  if (branch === null) return null;
  const issueNumber = matchBranchIssue(branch);
  if (issueNumber === null) return null;
  const record = await deps.store.load(issueNumber);
  if (record !== null) return { kind: "resolved", record };
  if (!isLocalIssueNumber(issueNumber)) return null;

  const records = await loadOpenRecords(deps);
  const worktree = await readWorktree(deps);
  const localOnlyRecord = records.find(
    (candidate) =>
      issueNumberMatchesRecord(issueNumber, candidate) &&
      candidate.branch === branch &&
      candidate.worktree === worktree &&
      isLocalOnlyLifecycleRecord(candidate),
  );
  if (localOnlyRecord === undefined) return null;
  if (!(await branchExists(deps, localOnlyRecord.branch))) return null;
  return { kind: "resolved", record: localOnlyRecord };
};

export function createResolver(deps: ResolverDeps): Resolver {
  return {
    async current(): Promise<ResolverResult> {
      const fromBranch = await resolveFromBranch(deps);
      if (fromBranch !== null) return fromBranch;

      const records = await loadOpenRecords(deps);
      if (records.length === 0) return { kind: "none" };

      const summaries = await Promise.all(records.map((record) => summarizeRecord(deps, record)));
      const fresh = records.filter(
        (record) => !summaries.some((summary) => summary.issueNumber === record.issueNumber && summary.stale),
      );

      if (fresh.length === 1) {
        const [record] = fresh;
        if (record !== undefined) return { kind: "resolved", record };
      }
      if (fresh.length === 0 && summaries.length === 0) return { kind: "none" };
      return { kind: "ambiguous", candidates: summaries };
    },

    async resume(issueNumber: number): Promise<LifecycleRecord> {
      const local = await deps.store.load(issueNumber);
      if (local) return local;

      return refreshFromIssueBody(deps, issueNumber);
    },

    async forceRefresh(issueNumber: number): Promise<LifecycleRecord> {
      return refreshFromIssueBody(deps, issueNumber);
    },

    async resolveExplicit(issueNumber: number): Promise<LifecycleRecord> {
      const record = (await deps.store.load(issueNumber)) ?? (await refreshFromIssueBody(deps, issueNumber));
      const summary = await summarizeRecord(deps, record);
      if (summary.stale) throw new StaleRecordError(summary);
      return record;
    },

    async listRecords(): Promise<readonly LifecycleRecord[]> {
      return loadAllRecords(deps);
    },
  };
}
