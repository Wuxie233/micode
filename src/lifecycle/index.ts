import { join } from "node:path";
import * as v from "valibot";

import { commitAndPush } from "./commits";
import { renderIssueBody } from "./issue-body";
import { finishLifecycle } from "./merge";
import { classifyRepo, type PreFlightResult, REPO_KIND } from "./pre-flight";
import type { LifecycleRunner, RunResult } from "./runner";
import { createLifecycleStore as createJsonLifecycleStore, type LifecycleStore } from "./store";
import { recordArtifact as addArtifact, appendNote, transitionTo } from "./transitions";
import type {
  ArtifactKind,
  CommitInput,
  CommitOutcome,
  FinishInput,
  FinishOutcome,
  LifecycleRecord,
  LifecycleState,
  StartRequestInput,
} from "./types";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "./types";

export type { LifecycleRunner } from "./runner";
export type {
  ArtifactKind,
  CommitInput,
  CommitOutcome,
  FinishInput,
  FinishOutcome,
  LifecycleRecord,
  LifecycleState,
  StartRequestInput,
} from "./types";
export { ARTIFACT_KINDS, LIFECYCLE_STATES } from "./types";

export interface LifecycleHandle {
  readonly start: (input: StartRequestInput) => Promise<LifecycleRecord>;
  readonly recordArtifact: (issueNumber: number, kind: ArtifactKind, pointer: string) => Promise<LifecycleRecord>;
  readonly commit: (issueNumber: number, input: CommitInput) => Promise<CommitOutcome>;
  readonly finish: (issueNumber: number, input: FinishInput) => Promise<FinishOutcome>;
  readonly load: (issueNumber: number) => Promise<LifecycleRecord | null>;
  readonly setState: (issueNumber: number, state: LifecycleState) => Promise<LifecycleRecord>;
}

export interface LifecycleStoreInput {
  readonly runner: LifecycleRunner;
  readonly worktreesRoot: string;
  readonly baseDir?: string;
}

interface IssueIdentity {
  readonly issueNumber: number;
  readonly issueUrl: string;
}

interface LifecycleContext {
  readonly runner: LifecycleRunner;
  readonly store: LifecycleStore;
  readonly worktreesRoot: string;
  readonly cwd: string;
}

const OK_EXIT_CODE = 0;
const ABORTED_ISSUE_NUMBER = 1;
const DECIMAL_RADIX = 10;
const MAX_SLUG_LENGTH = 48;
const EMPTY_TEXT = "";
const DEFAULT_SLUG = "issue-work";
const DEFAULT_COMMIT_TYPE = "chore";
const LINE_BREAK = "\n";
const LIST_PREFIX = "- ";
const NO_ITEMS = "- None";
const ISSUE_URL_PATTERN = /https:\/\/github\.com\/\S+\/issues\/(\d+)/;
const SLUG_SEPARATOR = "-";
const SLUG_PATTERN = /[^a-z0-9]+/g;
const SLUG_EDGE_PATTERN = /^-+|-+$/g;
const OUTPUT_SEPARATOR = " ";
const DETAIL_SEPARATOR = ": ";
const INITIAL_TITLE = "## Request";
const GOALS_TITLE = "## Goals";
const CONSTRAINTS_TITLE = "## Constraints";
const ISSUE_CREATE_FAILED = "issue_create_failed";
const WORKTREE_CONFLICT = "worktree_conflict";
const PRE_FLIGHT_FAILED = "pre_flight_failed";
const ISSUES_DISABLED_UPSTREAM = "issues_disabled_upstream";
const GITHUB_REPO_BASE_URL = "https://github.com";

const GH_ISSUE = "issue";
const GH_REPO = "repo";
const GH_CREATE = "create";
const GH_CLOSE = "close";
const GH_VIEW = "view";
const GH_EDIT = "edit";
const GH_TITLE_FLAG = "--title";
const GH_BODY_FLAG = "--body";
const GH_JSON_FLAG = "--json";
const GH_BODY_FIELD = "body";
const GH_ENABLE_ISSUES_FLAG = "--enable-issues";

const GIT_WORKTREE = "worktree";
const GIT_ADD = "add";
const GIT_BRANCH_FLAG = "-b";

const STATE_PATH: readonly LifecycleState[] = [
  LIFECYCLE_STATES.PROPOSED,
  LIFECYCLE_STATES.ISSUE_OPEN,
  LIFECYCLE_STATES.BRANCH_READY,
  LIFECYCLE_STATES.IN_DESIGN,
  LIFECYCLE_STATES.IN_PLAN,
  LIFECYCLE_STATES.IN_PROGRESS,
  LIFECYCLE_STATES.TESTED,
  LIFECYCLE_STATES.MERGING,
  LIFECYCLE_STATES.CLOSED,
  LIFECYCLE_STATES.CLEANED,
];

const IssueCreateSchema = v.object({
  number: v.optional(v.number()),
  url: v.optional(v.string()),
});

const IssueViewSchema = v.object({
  body: v.nullable(v.string()),
});

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const createArtifacts = (): Record<ArtifactKind, readonly string[]> => ({
  [ARTIFACT_KINDS.DESIGN]: [],
  [ARTIFACT_KINDS.PLAN]: [],
  [ARTIFACT_KINDS.LEDGER]: [],
  [ARTIFACT_KINDS.COMMIT]: [],
  [ARTIFACT_KINDS.PR]: [],
  [ARTIFACT_KINDS.WORKTREE]: [],
});

const touch = (record: LifecycleRecord): LifecycleRecord => ({
  ...record,
  updatedAt: Date.now(),
});

const issueUrlFor = (input: StartRequestInput, issueNumber: number): string => {
  return `${GITHUB_REPO_BASE_URL}/${input.ownerLogin}/${input.repo}/issues/${issueNumber}`;
};

const slugify = (summary: string): string => {
  const slug = summary
    .toLowerCase()
    .replace(SLUG_PATTERN, SLUG_SEPARATOR)
    .replace(SLUG_EDGE_PATTERN, EMPTY_TEXT)
    .slice(0, MAX_SLUG_LENGTH);
  if (slug.length > 0) return slug;
  return DEFAULT_SLUG;
};

const branchFor = (issueNumber: number, summary: string): string => `issue/${issueNumber}-${slugify(summary)}`;

const worktreeFor = (worktreesRoot: string, issueNumber: number, summary: string): string => {
  return join(worktreesRoot, `issue-${issueNumber}-${slugify(summary)}`);
};

const formatItems = (items: readonly string[]): string => {
  if (items.length === 0) return NO_ITEMS;
  return items.map((item) => `${LIST_PREFIX}${item}`).join(LINE_BREAK);
};

const renderStartBody = (input: StartRequestInput): string => {
  return [
    INITIAL_TITLE,
    input.summary,
    GOALS_TITLE,
    formatItems(input.goals),
    CONSTRAINTS_TITLE,
    formatItems(input.constraints),
  ].join(`${LINE_BREAK}${LINE_BREAK}`);
};

const formatFailure = (category: string, run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length > 0) return `${category}${DETAIL_SEPARATOR}${pieces.join(OUTPUT_SEPARATOR)}`;
  return `${category}${DETAIL_SEPARATOR}exit code ${run.exitCode}`;
};

const parseIssueNumber = (issueUrl: string): number | null => {
  const match = ISSUE_URL_PATTERN.exec(issueUrl);
  const raw = match?.[1];
  if (!raw) return null;
  const issueNumber = Number.parseInt(raw, DECIMAL_RADIX);
  if (Number.isSafeInteger(issueNumber) && issueNumber > 0) return issueNumber;
  return null;
};

const parseIssueJson = (stdout: string): IssueIdentity | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(IssueCreateSchema, raw);
    if (!parsed.success) return null;
    const issueUrl = parsed.output.url ?? null;
    const issueNumber = parsed.output.number ?? (issueUrl ? parseIssueNumber(issueUrl) : null);
    if (!issueUrl || !issueNumber) return null;
    return { issueNumber, issueUrl };
  } catch {
    // gh issue create commonly emits a plain URL instead of JSON.
    return null;
  }
};

const parseIssueIdentity = (stdout: string): IssueIdentity | null => {
  const issueUrl = ISSUE_URL_PATTERN.exec(stdout)?.[0] ?? null;
  const issueNumber = issueUrl ? parseIssueNumber(issueUrl) : null;
  if (issueUrl && issueNumber) return { issueNumber, issueUrl };
  return parseIssueJson(stdout);
};

const getPreFlightNote = (preflight: PreFlightResult): string | null => {
  if (preflight.kind === REPO_KIND.UNKNOWN) return `${PRE_FLIGHT_FAILED}: unable to verify repository ownership`;
  if (preflight.kind === REPO_KIND.UPSTREAM && !preflight.issuesEnabled) {
    return `${ISSUES_DISABLED_UPSTREAM}: ${preflight.nameWithOwner}`;
  }
  if (preflight.kind === REPO_KIND.UPSTREAM) return `${PRE_FLIGHT_FAILED}: ${preflight.nameWithOwner}`;
  return null;
};

const isUserOwned = (preflight: PreFlightResult): boolean => {
  return preflight.kind === REPO_KIND.FORK || preflight.kind === REPO_KIND.OWN;
};

const ensureIssuesEnabled = async (runner: LifecycleRunner, preflight: PreFlightResult): Promise<string | null> => {
  if (preflight.issuesEnabled || !isUserOwned(preflight)) return null;

  const enabled = await runner.gh([GH_REPO, GH_EDIT, preflight.nameWithOwner, GH_ENABLE_ISSUES_FLAG]);
  if (completed(enabled)) return null;
  return formatFailure(PRE_FLIGHT_FAILED, enabled);
};

const createRecord = (
  input: StartRequestInput,
  worktreesRoot: string,
  identity: IssueIdentity,
  state: LifecycleState,
  notes: readonly string[] = [],
): LifecycleRecord => ({
  issueNumber: identity.issueNumber,
  issueUrl: identity.issueUrl,
  branch: branchFor(identity.issueNumber, input.summary),
  worktree: worktreeFor(worktreesRoot, identity.issueNumber, input.summary),
  state,
  artifacts: createArtifacts(),
  notes,
  updatedAt: Date.now(),
});

const advanceTo = (record: LifecycleRecord, state: LifecycleState): LifecycleRecord => {
  const current = STATE_PATH.indexOf(record.state);
  const target = STATE_PATH.indexOf(state);
  if (current === target) return record;
  if (current < 0 || target < 0 || current > target) return transitionTo(record, state);

  let next = record;
  for (let index = current + 1; index <= target; index += 1) {
    next = transitionTo(next, STATE_PATH[index]);
  }
  return next;
};

const requireRecord = async (store: LifecycleStore, issueNumber: number): Promise<LifecycleRecord> => {
  const record = await store.load(issueNumber);
  if (record) return record;
  throw new Error(`Lifecycle record not found: ${issueNumber}`);
};

const readIssueBody = async (runner: LifecycleRunner, issueNumber: number): Promise<string | null> => {
  const viewed = await runner.gh([GH_ISSUE, GH_VIEW, String(issueNumber), GH_JSON_FLAG, GH_BODY_FIELD]);
  if (!completed(viewed)) return null;

  try {
    const raw: unknown = JSON.parse(viewed.stdout);
    const parsed = v.safeParse(IssueViewSchema, raw);
    if (parsed.success) return parsed.output.body;
    return viewed.stdout;
  } catch {
    // Older gh output may be plain text when --json is unavailable in tests or user environments.
    return viewed.stdout;
  }
};

const syncIssueBody = async (runner: LifecycleRunner, record: LifecycleRecord): Promise<void> => {
  const existing = await readIssueBody(runner, record.issueNumber);
  const body = renderIssueBody(record, existing);
  await runner.gh([GH_ISSUE, GH_EDIT, String(record.issueNumber), GH_BODY_FLAG, body]);
};

const closeIssue = async (runner: LifecycleRunner, issueNumber: number): Promise<number | null> => {
  const closed = await runner.gh([GH_ISSUE, GH_CLOSE, String(issueNumber)]);
  if (completed(closed)) return Date.now();
  return null;
};

const closeMergedIssue = async (
  runner: LifecycleRunner,
  issueNumber: number,
  outcome: FinishOutcome,
): Promise<FinishOutcome> => {
  if (!outcome.merged) return outcome;

  const closedAt = await closeIssue(runner, issueNumber);
  if (!closedAt) return outcome;
  return { ...outcome, closedAt };
};

const saveAndSync = async (context: LifecycleContext, record: LifecycleRecord): Promise<LifecycleRecord> => {
  await context.store.save(record);
  await syncIssueBody(context.runner, record);
  return record;
};

const createIssue = async (runner: LifecycleRunner, input: StartRequestInput): Promise<IssueIdentity> => {
  const created = await runner.gh([
    GH_ISSUE,
    GH_CREATE,
    GH_TITLE_FLAG,
    input.summary,
    GH_BODY_FLAG,
    renderStartBody(input),
  ]);
  if (!completed(created)) throw new Error(formatFailure(ISSUE_CREATE_FAILED, created));

  const identity = parseIssueIdentity(created.stdout);
  if (identity) return identity;
  throw new Error(`${ISSUE_CREATE_FAILED}: unable to parse issue output`);
};

const createWorktree = async (
  runner: LifecycleRunner,
  record: LifecycleRecord,
  cwd: string,
): Promise<string | null> => {
  const created = await runner.git([GIT_WORKTREE, GIT_ADD, GIT_BRANCH_FLAG, record.branch, record.worktree], { cwd });
  if (completed(created)) return null;
  return formatFailure(WORKTREE_CONFLICT, created);
};

const abortStart = async (
  context: LifecycleContext,
  input: StartRequestInput,
  note: string,
): Promise<LifecycleRecord> => {
  const identity = { issueNumber: ABORTED_ISSUE_NUMBER, issueUrl: issueUrlFor(input, ABORTED_ISSUE_NUMBER) };
  const record = createRecord(input, context.worktreesRoot, identity, LIFECYCLE_STATES.ABORTED, [note]);
  await context.store.save(record);
  return record;
};

const abortRecord = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  note: string,
): Promise<LifecycleRecord> => {
  const aborted = touch({ ...record, state: LIFECYCLE_STATES.ABORTED, notes: [...record.notes, note] });
  return saveAndSync(context, aborted);
};

const applyCommitOutcome = (record: LifecycleRecord, outcome: CommitOutcome): LifecycleRecord => {
  let next = record;
  if (outcome.sha) next = addArtifact(next, ARTIFACT_KINDS.COMMIT, outcome.sha);
  if (outcome.note) next = appendNote(next, outcome.note);
  return touch(next);
};

const applyFinishOutcome = (record: LifecycleRecord, outcome: FinishOutcome): LifecycleRecord => {
  let next = record;
  if (outcome.prUrl) next = addArtifact(next, ARTIFACT_KINDS.PR, outcome.prUrl);
  if (outcome.note) next = appendNote(next, outcome.note);
  if (!outcome.merged) return touch(next);
  return touch(advanceTo(advanceTo(next, LIFECYCLE_STATES.CLOSED), LIFECYCLE_STATES.CLEANED));
};

const createStart = (context: LifecycleContext): LifecycleHandle["start"] => {
  return async (request) => {
    const preflight = await classifyRepo(context.runner, context.cwd);
    const note = getPreFlightNote(preflight);
    if (note) return abortStart(context, request, note);

    const enableNote = await ensureIssuesEnabled(context.runner, preflight);
    if (enableNote) return abortStart(context, request, enableNote);

    const identity = await createIssue(context.runner, request);
    const opened = createRecord(request, context.worktreesRoot, identity, LIFECYCLE_STATES.ISSUE_OPEN);
    const worktreeNote = await createWorktree(context.runner, opened, context.cwd);
    if (worktreeNote) return abortRecord(context, opened, worktreeNote);

    const ready = touch(
      addArtifact(transitionTo(opened, LIFECYCLE_STATES.BRANCH_READY), ARTIFACT_KINDS.WORKTREE, opened.worktree),
    );
    return saveAndSync(context, ready);
  };
};

const createArtifactRecorder = (context: LifecycleContext): LifecycleHandle["recordArtifact"] => {
  return async (issueNumber, kind, pointer) => {
    const record = await requireRecord(context.store, issueNumber);
    return saveAndSync(context, touch(addArtifact(record, kind, pointer)));
  };
};

const createCommitter = (context: LifecycleContext): LifecycleHandle["commit"] => {
  return async (issueNumber, commitInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const outcome = await commitAndPush(context.runner, {
      cwd: record.worktree,
      issueNumber,
      type: DEFAULT_COMMIT_TYPE,
      scope: commitInput.scope,
      summary: commitInput.summary,
      push: commitInput.push,
    });
    await saveAndSync(context, applyCommitOutcome(record, outcome));
    return outcome;
  };
};

const createFinisher = (context: LifecycleContext): LifecycleHandle["finish"] => {
  return async (issueNumber, finishInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const merging = await saveAndSync(context, advanceTo(record, LIFECYCLE_STATES.MERGING));
    const finished = await finishLifecycle(context.runner, {
      cwd: context.cwd,
      branch: merging.branch,
      worktree: merging.worktree,
      mergeStrategy: finishInput.mergeStrategy,
      waitForChecks: finishInput.waitForChecks,
    });
    const outcome = await closeMergedIssue(context.runner, issueNumber, finished);
    await saveAndSync(context, applyFinishOutcome(merging, outcome));
    return outcome;
  };
};

const createStateSetter = (context: LifecycleContext): LifecycleHandle["setState"] => {
  return async (issueNumber, state) => {
    const record = await requireRecord(context.store, issueNumber);
    return saveAndSync(context, transitionTo(record, state));
  };
};

export function createLifecycleStore(input: LifecycleStoreInput): LifecycleHandle {
  const store = createJsonLifecycleStore({ baseDir: input.baseDir });
  const context = { runner: input.runner, store, worktreesRoot: input.worktreesRoot, cwd: process.cwd() };

  return {
    start: createStart(context),
    recordArtifact: createArtifactRecorder(context),
    commit: createCommitter(context),
    finish: createFinisher(context),
    load: store.load,
    setState: createStateSetter(context),
  };
}
