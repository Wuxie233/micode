import { join } from "node:path";
import * as v from "valibot";

import { type CompletionNotifier, NOTIFICATION_STATUSES, type NotificationStatus } from "@/notifications";
import {
  type ScheduleMaintenanceInput,
  type ScheduleMaintenanceOutcome,
  scheduleProjectMemoryMaintenance,
} from "@/project-memory/maintenance/scheduler";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type CommitAndPushInput, commitAndPush } from "./commits";
import { resolveDefaultBranch } from "./default-branch";
import { detectBlockedTasks } from "./finish-guards";
import { renderIssueBody } from "./issue-body";
import { createJournalStore, type JournalStore } from "./journal/store";
import { JOURNAL_EVENT_KINDS, type JournalEvent, type JournalEventInput } from "./journal/types";
import { createLeaseStore, type LeaseStore } from "./lease/store";
import { buildExecutionMarker, parseExecutionMarker } from "./markers";
import { finishLifecycle } from "./merge";
import { classifyRepo, type PreFlightResult, REPO_KIND } from "./pre-flight";
import { buildHint } from "./recovery/hint";
import { probeRuntimeIdentity } from "./recovery/identity";
import { inspectRecovery } from "./recovery/inspect";
import { resolveIssueIdentity } from "./recovery/resolve-issue-identity";
import type { RecoveryDecision } from "./recovery/types";
import { evaluateRemoteWriteGuard } from "./remote-write-guard";
import { collectReviewSummary, renderReviewSummarySection } from "./review-summary";
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
  readonly recordExecutorEvent: (input: ExecutorEventInput) => Promise<void>;
  readonly decideRecovery: (issueNumber: number, currentOwner: string) => Promise<RecoveryDecision>;
  readonly notifyBlocked: (issueNumber: number, summary: string) => Promise<void>;
}

export interface ProgressEmitter {
  readonly log: (input: {
    readonly issueNumber: number;
    readonly kind: "status";
    readonly summary: string;
    readonly marker?: string;
  }) => Promise<unknown>;
}

export interface ExecutorEventInput {
  readonly issueNumber: number;
  readonly kind: JournalEventInput["kind"];
  readonly batchId?: string | null;
  readonly taskId?: string | null;
  readonly attempt?: number;
  readonly summary: string;
  readonly reviewOutcome?: JournalEventInput["reviewOutcome"];
}

export interface LifecycleStoreInput {
  readonly runner: LifecycleRunner;
  readonly worktreesRoot: string;
  readonly cwd: string;
  readonly baseDir?: string;
  readonly progress?: ProgressEmitter;
  readonly journal?: JournalStore;
  readonly lease?: LeaseStore;
  readonly notifier?: CompletionNotifier;
  readonly maintenanceScheduler?: ProjectMemoryMaintenanceScheduler;
  readonly preStageHook?: CommitAndPushInput["preStageHook"];
  readonly prePushHook?: CommitAndPushInput["prePushHook"];
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
  readonly progress?: ProgressEmitter;
  readonly journal: JournalStore;
  readonly lease: LeaseStore;
  readonly notifier?: CompletionNotifier;
  readonly maintenanceScheduler: ProjectMemoryMaintenanceScheduler;
  readonly preStageHook?: CommitAndPushInput["preStageHook"];
  readonly prePushHook?: CommitAndPushInput["prePushHook"];
}

export type ProjectMemoryMaintenanceScheduler = (
  input: ScheduleMaintenanceInput,
) => Promise<ScheduleMaintenanceOutcome>;

const OK_EXIT_CODE = 0;
const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER;
const ABORTED_SENTINEL_NOTE = "aborted-sentinel:max";
const DECIMAL_RADIX = 10;
const MAX_SLUG_LENGTH = 48;
const EMPTY_TEXT = "";
const DEFAULT_SLUG = "issue-work";
const DEFAULT_COMMIT_TYPE = "chore";
const LINE_BREAK = "\n";
const LIST_PREFIX = "- ";
const NO_ITEMS = "- None";
const ISSUE_URL_PATTERN = /https:\/\/github\.com\/\S+\/issues\/(\d+)/;
const ISSUE_URL_TRAILING_PATTERN = /\/issues\/\d+$/;
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
const EXECUTOR_BLOCKED = "executor_blocked";
const ISSUES_DISABLED_UPSTREAM = "issues_disabled_upstream";
const GITHUB_REPO_BASE_URL = "https://github.com";
const ISSUE_POINTER_PREFIX = "issue/";
const RESOLVED_BASE_PREFIX = "resolved-base";
const PROJECT_MEMORY_TERMINAL_TRIGGER = "lifecycle.finish";
const OUTCOME_POINTER_PREFIX = "outcome/";
const MAIN_BRANCH = "main";
const AMBIGUOUS_LIFECYCLE = "ambiguous_lifecycle";

const GH_ISSUE = "issue";
const GH_REPO = "repo";
const GH_CREATE = "create";
const GH_CLOSE = "close";
const GH_VIEW = "view";
const GH_EDIT = "edit";
const GH_TITLE_FLAG = "--title";
const GH_BODY_FLAG = "--body";
const GH_REPO_FLAG = "--repo";
const GH_JSON_FLAG = "--json";
const GH_BODY_FIELD = "body";
const GH_ENABLE_ISSUES_FLAG = "--enable-issues";

const GIT_WORKTREE = "worktree";
const GIT_ADD = "add";
const GIT_BRANCH_FLAG = "-b";
const GIT_LOG = "log";
const GIT_LOG_LIMIT_ARG = "-1";
const GIT_LOG_FORMAT_BODY_ARG = "--format=%B";
const RECOVERY_COMMIT_MARKER_SUMMARY = "commit marker observed during recovery";

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

const issueUrlFor = (preflight: PreFlightResult, issueNumber: number): string => {
  if (preflight.nameWithOwner.length === 0) return EMPTY_TEXT;
  return `${GITHUB_REPO_BASE_URL}/${preflight.nameWithOwner}/issues/${issueNumber}`;
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

const ensureIssuesEnabled = async (
  runner: LifecycleRunner,
  preflight: PreFlightResult,
  cwd: string,
): Promise<string | null> => {
  if (preflight.issuesEnabled || !isUserOwned(preflight)) return null;

  const enabled = await runner.gh([GH_REPO, GH_EDIT, preflight.nameWithOwner, GH_ENABLE_ISSUES_FLAG], { cwd });
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

const readIssueBody = async (runner: LifecycleRunner, issueNumber: number, cwd: string): Promise<string | null> => {
  const viewed = await runner.gh([GH_ISSUE, GH_VIEW, String(issueNumber), GH_JSON_FLAG, GH_BODY_FIELD], { cwd });
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

const syncIssueBody = async (runner: LifecycleRunner, record: LifecycleRecord, cwd: string): Promise<void> => {
  const existing = await readIssueBody(runner, record.issueNumber, cwd);
  const body = renderIssueBody(record, existing);
  await runner.gh([GH_ISSUE, GH_EDIT, String(record.issueNumber), GH_BODY_FLAG, body], { cwd });
};

const closeIssue = async (runner: LifecycleRunner, issueNumber: number, cwd: string): Promise<number | null> => {
  const closed = await runner.gh([GH_ISSUE, GH_CLOSE, String(issueNumber)], { cwd });
  if (completed(closed)) return Date.now();
  return null;
};

const closeMergedIssue = async (
  runner: LifecycleRunner,
  issueNumber: number,
  outcome: FinishOutcome,
  cwd: string,
): Promise<FinishOutcome> => {
  if (!outcome.merged) return outcome;

  const closedAt = await closeIssue(runner, issueNumber, cwd);
  if (!closedAt) return outcome;
  return { ...outcome, closedAt };
};

const normalizeLifecycleRecordIssueIdentity = (
  record: LifecycleRecord,
  explicitIssueNumber: number,
): LifecycleRecord => {
  const issueUrl = record.issueUrl.replace(ISSUE_URL_TRAILING_PATTERN, `/issues/${explicitIssueNumber}`);
  if (record.issueNumber === explicitIssueNumber && issueUrl === record.issueUrl) return record;
  return { ...record, issueNumber: explicitIssueNumber, issueUrl };
};

const annotateWithResolvedBranch = (
  outcome: FinishOutcome,
  resolved: { readonly branch: string; readonly source: string },
): FinishOutcome => {
  if (outcome.merged || outcome.note === null) return outcome;
  return { ...outcome, note: `${RESOLVED_BASE_PREFIX}=${resolved.branch}(${resolved.source}); ${outcome.note}` };
};

const buildExecutorBlockedNote = (blocked: readonly string[]): string => `${EXECUTOR_BLOCKED}: ${blocked.join(",")}`;

const buildExecutorBlockedOutcome = (note: string): FinishOutcome => ({
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  cleanupOutcome: { kind: "failed", reason: "cleanup not attempted (executor blocked)", retried: false },
  note,
});

const buildAmbiguousLifecycleFinishOutcome = (
  issueNumber: number,
  branch: string,
  worktree: string,
  reason: string,
): FinishOutcome => ({
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  cleanupOutcome: { kind: "failed", reason: "finish blocked before merge identity resolution", retried: false },
  note: `${AMBIGUOUS_LIFECYCLE}: ${reason}`,
  recoveryHint: buildHint({
    failureKind: "ambiguous_lifecycle",
    recommendedNextAction: "ask_user",
    summary: reason,
    issueNumber,
    branch,
    worktree,
    safeToRetry: false,
  }),
});

const buildRemoteWriteBlockedCommitOutcome = (
  note: string,
  recoveryHint: CommitOutcome["recoveryHint"],
): CommitOutcome => ({
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note,
  recoveryHint,
});

const buildRemoteWriteBlockedFinishOutcome = (
  note: string,
  recoveryHint: FinishOutcome["recoveryHint"],
): FinishOutcome => ({
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  cleanupOutcome: { kind: "failed", reason: "remote write blocked before mutation", retried: false },
  note,
  recoveryHint,
});

const safeEmit = async (
  context: LifecycleContext,
  issueNumber: number,
  summary: string,
  marker?: string,
): Promise<void> => {
  if (!context.progress) return;
  try {
    await context.progress.log({ issueNumber, kind: "status", summary, marker });
  } catch (error) {
    log.warn("lifecycle.progress", `auto-emit failed: ${extractErrorMessage(error)}`);
  }
};

const safeNotify = async (
  context: LifecycleContext,
  status: NotificationStatus,
  record: LifecycleRecord,
  summary: string,
  issueNumber = record.issueNumber,
): Promise<void> => {
  if (!context.notifier) return;
  try {
    await context.notifier.notify({
      status,
      issueNumber,
      title: record.branch,
      summary,
      reference: record.issueUrl.length > 0 ? record.issueUrl : null,
    });
  } catch (error) {
    log.warn("lifecycle.notify", `notify failed: ${extractErrorMessage(error)}`);
  }
};

const saveAndSync = async (context: LifecycleContext, record: LifecycleRecord): Promise<LifecycleRecord> => {
  await context.store.save(record);
  await syncIssueBody(context.runner, record, context.cwd);
  return record;
};

const createIssue = async (
  runner: LifecycleRunner,
  input: StartRequestInput,
  cwd: string,
  repoTarget: string,
): Promise<IssueIdentity> => {
  const created = await runner.gh(
    [GH_ISSUE, GH_CREATE, GH_REPO_FLAG, repoTarget, GH_TITLE_FLAG, input.summary, GH_BODY_FLAG, renderStartBody(input)],
    { cwd },
  );
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
  preflight: PreFlightResult,
  note: string,
): Promise<LifecycleRecord> => {
  const identity = {
    issueNumber: ABORTED_ISSUE_NUMBER,
    issueUrl: issueUrlFor(preflight, ABORTED_ISSUE_NUMBER),
  };
  const record = createRecord(input, context.worktreesRoot, identity, LIFECYCLE_STATES.ABORTED, [
    note,
    ABORTED_SENTINEL_NOTE,
  ]);
  await context.store.save(record);
  await safeNotify(context, NOTIFICATION_STATUSES.FAILED_STOP, record, note);
  return record;
};

const abortRecord = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  note: string,
): Promise<LifecycleRecord> => {
  const aborted = touch({ ...record, state: LIFECYCLE_STATES.ABORTED, notes: [...record.notes, note] });
  const saved = await saveAndSync(context, aborted);
  await safeNotify(context, NOTIFICATION_STATUSES.FAILED_STOP, saved, note);
  return saved;
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

const isExecutorBlockedOutcome = (outcome: FinishOutcome): boolean =>
  outcome.note?.startsWith(EXECUTOR_BLOCKED) ?? false;

const shouldScheduleTerminalMaintenance = (outcome: FinishOutcome): boolean => {
  if (!config.projectMemory.maintenanceEnabled || !config.projectMemory.maintenanceTerminalTriggerEnabled) return false;
  return outcome.merged || isExecutorBlockedOutcome(outcome);
};

const artifactPointersForMaintenance = (record: LifecycleRecord): readonly string[] => {
  const pointers = [`${ISSUE_POINTER_PREFIX}${record.issueNumber}`];
  pointers.push(record.branch);
  for (const pointer of Object.values(record.artifacts).flat()) pointers.push(pointer);
  return pointers;
};

const outcomePointerForMaintenance = (outcome: FinishOutcome): string => {
  if (outcome.merged) return `${OUTCOME_POINTER_PREFIX}merged`;
  if (isExecutorBlockedOutcome(outcome)) return `${OUTCOME_POINTER_PREFIX}${EXECUTOR_BLOCKED}`;
  return `${OUTCOME_POINTER_PREFIX}not-merged`;
};

const scheduleTerminalMaintenance = (
  context: LifecycleContext,
  record: LifecycleRecord,
  outcome: FinishOutcome,
): void => {
  if (!shouldScheduleTerminalMaintenance(outcome)) return;

  try {
    void context
      .maintenanceScheduler({
        reason: "terminal",
        triggeredBy: PROJECT_MEMORY_TERMINAL_TRIGGER,
        directory: context.cwd,
        sourcePointers: [...artifactPointersForMaintenance(record), outcomePointerForMaintenance(outcome)],
      })
      .catch((error: unknown) => {
        log.warn("lifecycle.project-memory-maintenance", `schedule failed: ${extractErrorMessage(error)}`);
      });
  } catch (error) {
    log.warn("lifecycle.project-memory-maintenance", `schedule failed: ${extractErrorMessage(error)}`);
  }
};

const createStart = (context: LifecycleContext): LifecycleHandle["start"] => {
  return async (request) => {
    const preflight = await classifyRepo(context.runner, context.cwd);
    const note = getPreFlightNote(preflight);
    if (note) return abortStart(context, request, preflight, note);

    const enableNote = await ensureIssuesEnabled(context.runner, preflight, context.cwd);
    if (enableNote) return abortStart(context, request, preflight, enableNote);

    const identity = await createIssue(context.runner, request, context.cwd, preflight.nameWithOwner);
    const opened = createRecord(request, context.worktreesRoot, identity, LIFECYCLE_STATES.ISSUE_OPEN);
    const worktreeNote = await createWorktree(context.runner, opened, context.cwd);
    if (worktreeNote) return abortRecord(context, opened, worktreeNote);

    const ready = touch(
      addArtifact(transitionTo(opened, LIFECYCLE_STATES.BRANCH_READY), ARTIFACT_KINDS.WORKTREE, opened.worktree),
    );
    const saved = await saveAndSync(context, ready);
    await safeEmit(context, saved.issueNumber, `Lifecycle started: branch=${saved.branch}, worktree=${saved.worktree}`);
    return saved;
  };
};

const createArtifactRecorder = (context: LifecycleContext): LifecycleHandle["recordArtifact"] => {
  return async (issueNumber, kind, pointer) => {
    const record = await requireRecord(context.store, issueNumber);
    const updated = await saveAndSync(context, touch(addArtifact(record, kind, pointer)));
    await safeEmit(context, issueNumber, `Recorded ${kind}: ${pointer}`);
    return updated;
  };
};

const createCommitMarker = async (
  context: LifecycleContext,
  issueNumber: number,
  commitInput: CommitInput,
): Promise<string | undefined> => {
  if (!commitInput.batchId) return undefined;
  const seq = (await context.journal.lastSeq(issueNumber)) + 1;
  return buildExecutionMarker({
    issueNumber,
    batchId: commitInput.batchId,
    taskId: commitInput.taskId ?? null,
    attempt: commitInput.attempt ?? 1,
    seq,
  });
};

const recordCommitObserved = async (
  context: LifecycleContext,
  issueNumber: number,
  commitInput: CommitInput,
  outcome: CommitOutcome,
  marker: string | undefined,
): Promise<void> => {
  if (!outcome.committed || !marker) return;
  await context.journal.append(issueNumber, {
    kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
    batchId: commitInput.batchId ?? null,
    taskId: commitInput.taskId ?? null,
    attempt: commitInput.attempt ?? 1,
    summary: outcome.sha ? `commit ${outcome.sha}` : "commit (no sha)",
    commitMarker: marker,
  });
};

const createCommitter = (context: LifecycleContext): LifecycleHandle["commit"] => {
  return async (issueNumber, commitInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const remoteWriteGuard = await evaluateRemoteWriteGuard({
      runner: context.runner,
      cwd: context.cwd,
      operation: "lifecycle_commit",
      issueNumber,
      branch: record.branch,
      worktree: record.worktree,
    });
    if (!remoteWriteGuard.allowed) {
      const outcome = buildRemoteWriteBlockedCommitOutcome(remoteWriteGuard.note, remoteWriteGuard.recoveryHint);
      await safeEmit(context, issueNumber, remoteWriteGuard.note);
      return outcome;
    }

    const marker = await createCommitMarker(context, issueNumber, commitInput);
    const outcome = await commitAndPush(context.runner, {
      cwd: record.worktree,
      issueNumber,
      branch: record.branch,
      type: DEFAULT_COMMIT_TYPE,
      scope: commitInput.scope,
      summary: commitInput.summary,
      push: commitInput.push,
      marker,
      preStageHook: context.preStageHook,
      prePushHook: context.prePushHook,
    });
    await saveAndSync(context, applyCommitOutcome(record, outcome));
    await recordCommitObserved(context, issueNumber, commitInput, outcome, marker);
    const pushed = outcome.pushed ? "true" : "false";
    await safeEmit(context, issueNumber, `Committed ${outcome.sha ?? "(no-op)"}, pushed=${pushed}`, marker);
    return outcome;
  };
};

const checkFinishRemoteWriteGuard = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  issueNumber: number,
): Promise<FinishOutcome | null> => {
  const remoteWriteGuard = await evaluateRemoteWriteGuard({
    runner: context.runner,
    cwd: context.cwd,
    operation: "lifecycle_finish",
    issueNumber,
    branch: record.branch,
    worktree: record.worktree,
  });
  if (remoteWriteGuard.allowed) return null;

  const outcome = buildRemoteWriteBlockedFinishOutcome(remoteWriteGuard.note, remoteWriteGuard.recoveryHint);
  await safeEmit(context, issueNumber, remoteWriteGuard.note);
  return outcome;
};

const finishBlockedTasks = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  blocked: readonly string[],
): Promise<FinishOutcome | null> => {
  if (blocked.length === 0) return null;

  const note = buildExecutorBlockedNote(blocked);
  const outcome = buildExecutorBlockedOutcome(note);
  const blockedRecord = await saveAndSync(context, applyFinishOutcome(record, outcome));
  scheduleTerminalMaintenance(context, blockedRecord, outcome);
  await safeNotify(context, NOTIFICATION_STATUSES.BLOCKED, blockedRecord, note);
  return outcome;
};

const resolveFinishRecordIdentity = async (
  context: LifecycleContext,
  merging: LifecycleRecord,
  explicitIssueNumber: number,
): Promise<LifecycleRecord | FinishOutcome> => {
  if (merging.branch !== MAIN_BRANCH) return merging;

  const identity = await resolveIssueIdentity({
    runner: context.runner,
    cwd: context.cwd,
    issueNumberHint: explicitIssueNumber,
    localRecord: merging,
    issueBodyArtifacts: { worktree: merging.artifacts[ARTIFACT_KINDS.WORKTREE] },
    explicit: null,
  });

  if (identity.source === "issue-body-artifact" && !identity.ambiguous && identity.branch !== MAIN_BRANCH) {
    return { ...merging, branch: identity.branch, worktree: identity.worktree };
  }

  const reason = identity.ambiguous
    ? (identity.ambiguityReason ?? "ambiguous lifecycle identity")
    : "branch=main and no validated issue worktree artifact";
  return buildAmbiguousLifecycleFinishOutcome(explicitIssueNumber, identity.branch, identity.worktree, reason);
};

const runFinishLifecycle = async (
  context: LifecycleContext,
  explicitIssueNumber: number,
  mergeRecord: LifecycleRecord,
  events: readonly JournalEvent[],
  finishInput: FinishInput,
): Promise<FinishOutcome> => {
  const summary = collectReviewSummary({ record: mergeRecord, events, now: Date.now() });
  const reviewSummarySection = renderReviewSummarySection(summary);
  const resolvedBranch = await resolveDefaultBranch(context.runner, { cwd: context.cwd });
  const finished = await finishLifecycle(context.runner, {
    cwd: context.cwd,
    branch: mergeRecord.branch,
    worktree: mergeRecord.worktree,
    mergeStrategy: finishInput.mergeStrategy,
    waitForChecks: finishInput.waitForChecks,
    baseBranch: resolvedBranch.branch,
    reviewSummarySection,
    postSummaryComment: config.lifecycle.postPrSummaryComment,
    issueNumber: explicitIssueNumber,
    artifactPointers: Object.values(mergeRecord.artifacts).flat(),
  });
  return closeMergedIssue(
    context.runner,
    explicitIssueNumber,
    annotateWithResolvedBranch(finished, resolvedBranch),
    context.cwd,
  );
};

const persistFinishMergeOutcome = async (
  context: LifecycleContext,
  explicitIssueNumber: number,
  mergeRecord: LifecycleRecord,
  outcome: FinishOutcome,
): Promise<LifecycleRecord> => {
  const final = await saveAndSync(context, applyFinishOutcome(mergeRecord, outcome));
  scheduleTerminalMaintenance(context, final, outcome);
  await safeEmit(
    context,
    explicitIssueNumber,
    `Finished: merged=${outcome.merged}, prUrl=${outcome.prUrl ?? "(none)"}`,
  );
  return final;
};

const notifyFinishedIfMerged = async (
  context: LifecycleContext,
  explicitIssueNumber: number,
  final: LifecycleRecord,
  outcome: FinishOutcome,
): Promise<void> => {
  if (!outcome.merged) return;
  await safeNotify(
    context,
    NOTIFICATION_STATUSES.COMPLETED,
    final,
    `merged: ${outcome.prUrl ?? "(local merge)"}`,
    explicitIssueNumber,
  );
};

const executeFinishMerge = async (
  context: LifecycleContext,
  explicitIssueNumber: number,
  record: LifecycleRecord,
  events: readonly JournalEvent[],
  finishInput: FinishInput,
): Promise<FinishOutcome> => {
  const merging = await saveAndSync(context, advanceTo(record, LIFECYCLE_STATES.MERGING));
  const resolvedIdentity = await resolveFinishRecordIdentity(context, merging, explicitIssueNumber);
  if ("merged" in resolvedIdentity) return resolvedIdentity;

  const mergeRecord = resolvedIdentity;
  const outcome = await runFinishLifecycle(context, explicitIssueNumber, mergeRecord, events, finishInput);
  const final = await persistFinishMergeOutcome(context, explicitIssueNumber, mergeRecord, outcome);
  await notifyFinishedIfMerged(context, explicitIssueNumber, final, outcome);
  return outcome;
};

const createFinisher = (context: LifecycleContext): LifecycleHandle["finish"] => {
  return async (issueNumber, finishInput) => {
    const record = normalizeLifecycleRecordIssueIdentity(await requireRecord(context.store, issueNumber), issueNumber);
    const guardOutcome = await checkFinishRemoteWriteGuard(context, record, issueNumber);
    if (guardOutcome) return guardOutcome;

    const events = await context.journal.list(issueNumber);
    const blocked = detectBlockedTasks(events);
    const blockedOutcome = await finishBlockedTasks(context, record, blocked);
    if (blockedOutcome) return blockedOutcome;

    return executeFinishMerge(context, issueNumber, record, events, finishInput);
  };
};

const createBlockedNotifier = (context: LifecycleContext): LifecycleHandle["notifyBlocked"] => {
  return async (issueNumber, summary) => {
    const record = await context.store.load(issueNumber);
    if (record) {
      await safeNotify(context, NOTIFICATION_STATUSES.BLOCKED, record, summary);
      return;
    }

    if (!context.notifier) return;
    try {
      await context.notifier.notify({
        status: NOTIFICATION_STATUSES.BLOCKED,
        issueNumber,
        title: `issue-${issueNumber}`,
        summary,
        reference: null,
      });
    } catch (error) {
      log.warn("lifecycle.notify", `notify failed: ${extractErrorMessage(error)}`);
    }
  };
};

const createStateSetter = (context: LifecycleContext): LifecycleHandle["setState"] => {
  return async (issueNumber, state) => {
    const record = await requireRecord(context.store, issueNumber);
    return saveAndSync(context, transitionTo(record, state));
  };
};

const createExecutorEventRecorder = (context: LifecycleContext): LifecycleHandle["recordExecutorEvent"] => {
  return async (input) => {
    await context.journal.append(input.issueNumber, {
      kind: input.kind,
      batchId: input.batchId ?? null,
      taskId: input.taskId ?? null,
      attempt: input.attempt ?? 0,
      summary: input.summary,
      reviewOutcome: input.reviewOutcome ?? null,
    });
  };
};

const readExpectedOrigin = async (_context: LifecycleContext, _record: LifecycleRecord): Promise<string | null> => null;

const readRecentCommitText = async (context: LifecycleContext, record: LifecycleRecord): Promise<string | null> => {
  const run = await context.runner.git([GIT_LOG, GIT_LOG_LIMIT_ARG, GIT_LOG_FORMAT_BODY_ARG], { cwd: record.worktree });
  if (!completed(run)) return null;

  const text = run.stdout.trim();
  if (text.length === 0) return null;
  return text;
};

const hasBatchEvent = (events: readonly JournalEvent[], batchId: string, kind: JournalEvent["kind"]): boolean => {
  return events.some((event) => event.batchId === batchId && event.kind === kind);
};

const batchNeedsCommitMarker = (events: readonly JournalEvent[], batchId: string): boolean => {
  if (!hasBatchEvent(events, batchId, JOURNAL_EVENT_KINDS.BATCH_DISPATCHED)) return false;
  if (hasBatchEvent(events, batchId, JOURNAL_EVENT_KINDS.BATCH_COMPLETED)) return false;
  return !hasBatchEvent(events, batchId, JOURNAL_EVENT_KINDS.COMMIT_OBSERVED);
};

const lastJournalSeq = (events: readonly JournalEvent[]): number => events.at(-1)?.seq ?? 0;

const recoverCommitEvents = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  events: readonly JournalEvent[],
  now: number,
): Promise<readonly JournalEvent[]> => {
  const text = await readRecentCommitText(context, record);
  const marker = text ? parseExecutionMarker(text) : null;
  if (marker === null) return [];
  if (marker.issueNumber !== record.issueNumber || marker.batchId === null) return [];
  if (marker.seq <= lastJournalSeq(events)) return [];
  if (!batchNeedsCommitMarker(events, marker.batchId)) return [];

  return [
    {
      kind: JOURNAL_EVENT_KINDS.COMMIT_OBSERVED,
      issueNumber: record.issueNumber,
      seq: marker.seq,
      at: now,
      batchId: marker.batchId,
      taskId: marker.taskId,
      attempt: marker.attempt,
      summary: RECOVERY_COMMIT_MARKER_SUMMARY,
      commitMarker: buildExecutionMarker(marker),
      reviewOutcome: null,
    },
  ];
};

const createRecoveryDecider = (context: LifecycleContext): LifecycleHandle["decideRecovery"] => {
  return async (issueNumber, currentOwner) => {
    const record = await requireRecord(context.store, issueNumber);
    const events = await context.journal.list(issueNumber);
    const lease = await context.lease.load(issueNumber);
    const identity = await probeRuntimeIdentity(context.runner, context.cwd);
    const expectedOrigin = await readExpectedOrigin(context, record);
    const now = Date.now();
    const recovered = await recoverCommitEvents(context, record, events, now);
    return inspectRecovery({
      record,
      events: [...events, ...recovered],
      currentLease: lease,
      identity,
      expectedOrigin,
      now,
      currentOwner,
    });
  };
};

export function createLifecycleStore(input: LifecycleStoreInput): LifecycleHandle {
  const baseDir = input.baseDir ?? join(input.cwd, config.lifecycle.lifecycleDir);
  const store = createJsonLifecycleStore({ baseDir });
  const journal = input.journal ?? createJournalStore({ baseDir });
  const lease = input.lease ?? createLeaseStore({ baseDir });
  const context: LifecycleContext = {
    runner: input.runner,
    store,
    worktreesRoot: input.worktreesRoot,
    cwd: input.cwd,
    progress: input.progress,
    journal,
    lease,
    notifier: input.notifier,
    maintenanceScheduler: input.maintenanceScheduler ?? scheduleProjectMemoryMaintenance,
    preStageHook: input.preStageHook,
    prePushHook: input.prePushHook,
  };

  return {
    start: createStart(context),
    recordArtifact: createArtifactRecorder(context),
    commit: createCommitter(context),
    finish: createFinisher(context),
    load: store.load,
    setState: createStateSetter(context),
    recordExecutorEvent: createExecutorEventRecorder(context),
    decideRecovery: createRecoveryDecider(context),
    notifyBlocked: createBlockedNotifier(context),
  };
}
