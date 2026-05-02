import type { JournalEvent } from "./journal/types";
import { JOURNAL_EVENT_KINDS } from "./journal/types";
import { REVIEW_SUMMARY_VERDICTS, type ReviewSummary, type ReviewSummaryVerdict } from "./review-summary-types";
import { ARTIFACT_KINDS, type LifecycleRecord } from "./types";

export interface CollectInput {
  readonly record: LifecycleRecord;
  readonly events: readonly JournalEvent[];
  readonly now: number;
}

const HEADING = "## AI Review Summary";
const DISCLAIMER =
  "This summary is produced by an automated AI review pipeline. " +
  "It is not a formal GitHub Review and does not imply human approval.";
const LINE_BREAK = "\n";
const BULLET = "- ";
const NONE = "(none)";

const lastReviewByTask = (events: readonly JournalEvent[]): Map<string, JournalEvent["reviewOutcome"]> => {
  const latest = new Map<string, { seq: number; outcome: JournalEvent["reviewOutcome"] }>();
  for (const event of events) {
    if (event.kind !== JOURNAL_EVENT_KINDS.REVIEW_COMPLETED) continue;
    if (event.taskId === null) continue;
    const prior = latest.get(event.taskId);
    if (!prior || prior.seq < event.seq) latest.set(event.taskId, { seq: event.seq, outcome: event.reviewOutcome });
  }
  const reviews = new Map<string, JournalEvent["reviewOutcome"]>();
  for (const [taskId, value] of latest) reviews.set(taskId, value.outcome);
  return reviews;
};

const decideVerdict = (blocked: number, changesRequested: number): ReviewSummaryVerdict => {
  if (blocked > 0) return REVIEW_SUMMARY_VERDICTS.BLOCKED;
  if (changesRequested > 0) return REVIEW_SUMMARY_VERDICTS.CHANGES_REQUESTED;
  return REVIEW_SUMMARY_VERDICTS.APPROVED;
};

export function collectReviewSummary(input: CollectInput): ReviewSummary {
  const last = lastReviewByTask(input.events);
  let approved = 0;
  let changes = 0;
  let blocked = 0;
  const blockedIds: string[] = [];
  for (const [taskId, outcome] of last) {
    if (outcome === "approved") approved += 1;
    else if (outcome === "changes_requested") changes += 1;
    else if (outcome === "blocked") {
      blocked += 1;
      blockedIds.push(taskId);
    }
  }
  blockedIds.sort();
  const commits = input.record.artifacts[ARTIFACT_KINDS.COMMIT];
  const lastCommitSha = commits.at(-1) ?? null;
  return {
    verdict: decideVerdict(blocked, changes),
    issueNumber: input.record.issueNumber,
    branch: input.record.branch,
    taskCount: last.size,
    approvedCount: approved,
    changesRequestedCount: changes,
    blockedCount: blocked,
    blockedTaskIds: blockedIds,
    lastCommitSha,
    generatedAt: input.now,
    notes: input.record.notes,
  };
}

const formatNotes = (notes: readonly string[]): string => {
  if (notes.length === 0) return `${BULLET}${NONE}`;
  return notes.map((note) => `${BULLET}${note}`).join(LINE_BREAK);
};

const formatBlockedIds = (ids: readonly string[]): string => {
  if (ids.length === 0) return NONE;
  return ids.join(", ");
};

export function renderReviewSummarySection(summary: ReviewSummary): string {
  const lines = [
    HEADING,
    "",
    `${BULLET}Verdict: ${summary.verdict}`,
    `${BULLET}Branch: ${summary.branch}`,
    `${BULLET}Issue: #${summary.issueNumber}`,
    `${BULLET}Tasks reviewed: ${summary.taskCount} (approved=${summary.approvedCount}, changes_requested=${summary.changesRequestedCount}, blocked=${summary.blockedCount})`,
    `${BULLET}Blocked tasks: ${formatBlockedIds(summary.blockedTaskIds)}`,
    `${BULLET}Last commit: ${summary.lastCommitSha ?? NONE}`,
    `${BULLET}Generated at: ${new Date(summary.generatedAt).toISOString()}`,
    "",
    "**Notes**:",
    formatNotes(summary.notes),
    "",
    `_${DISCLAIMER}_`,
  ];
  return lines.join(LINE_BREAK);
}
