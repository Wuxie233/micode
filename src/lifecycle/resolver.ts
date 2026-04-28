import * as v from "valibot";

import { LifecycleRecordSchema } from "@/lifecycle/schemas";
import { parseIssueBody } from "./issue-body";
import type { LifecycleRunner } from "./runner";
import type { LifecycleStore } from "./store";
import { ARTIFACT_KINDS, type ArtifactKind, LIFECYCLE_STATES, type LifecycleRecord } from "./types";

export type ResolverResult =
  | { readonly kind: "resolved"; readonly record: LifecycleRecord }
  | { readonly kind: "none" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly number[] };

export interface ResolverDeps {
  readonly runner: LifecycleRunner;
  readonly store: LifecycleStore;
  readonly cwd: string;
}

export interface Resolver {
  readonly current: () => Promise<ResolverResult>;
  readonly resume: (issueNumber: number) => Promise<LifecycleRecord>;
}

const BRANCH_PATTERN = /^issue\/(\d+)-/;
const OK_EXIT_CODE = 0;
const DECIMAL_RADIX = 10;
const NOT_LIFECYCLE_ISSUE = "not_a_lifecycle_issue";
const ISSUE_NOT_FOUND = "issue_not_found";
const BRANCH_ARGS = ["rev-parse", "--abbrev-ref", "HEAD"] as const;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;
const ISSUE_VIEW_FIELDS = "body";

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
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  return null;
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

const resolveFromBranch = async (deps: ResolverDeps): Promise<ResolverResult | null> => {
  const branch = await readBranch(deps);
  if (branch === null) return null;
  const issueNumber = matchBranchIssue(branch);
  if (issueNumber === null) return null;
  const record = await deps.store.load(issueNumber);
  if (record === null) return null;
  return { kind: "resolved", record };
};

export function createResolver(deps: ResolverDeps): Resolver {
  return {
    async current(): Promise<ResolverResult> {
      const fromBranch = await resolveFromBranch(deps);
      if (fromBranch !== null) return fromBranch;

      const open = await deps.store.listOpen();
      if (open.length === 0) return { kind: "none" };
      if (open.length === 1) {
        const [first] = open;
        if (first === undefined) return { kind: "none" };
        const record = await deps.store.load(first);
        if (record === null) return { kind: "none" };
        return { kind: "resolved", record };
      }
      return { kind: "ambiguous", candidates: open };
    },

    async resume(issueNumber: number): Promise<LifecycleRecord> {
      const local = await deps.store.load(issueNumber);
      if (local) return local;

      const view = await deps.runner.gh(["issue", "view", String(issueNumber), "--json", ISSUE_VIEW_FIELDS], {
        cwd: deps.cwd,
      });
      if (view.exitCode !== OK_EXIT_CODE) throw new Error(`${ISSUE_NOT_FOUND}: #${issueNumber}`);

      const body = extractIssueBody(view.stdout);
      const record = await reconstructFromBody(deps, issueNumber, body);
      await deps.store.save(record);
      return record;
    },
  };
}
