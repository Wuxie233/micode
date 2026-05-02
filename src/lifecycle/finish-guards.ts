import { JOURNAL_EVENT_KINDS, type JournalEvent } from "./journal/types";

const BLOCKED = "blocked";

interface LatestReview {
  readonly seq: number;
  readonly outcome: JournalEvent["reviewOutcome"];
}

type TaskReview = JournalEvent & { readonly taskId: string };

const isReviewForTask = (event: JournalEvent): event is TaskReview => {
  return event.kind === JOURNAL_EVENT_KINDS.REVIEW_COMPLETED && event.taskId !== null;
};

const shouldReplace = (prior: LatestReview | undefined, seq: number): boolean => {
  return prior === undefined || prior.seq < seq;
};

const collectBlockedTasks = (latest: ReadonlyMap<string, LatestReview>): readonly string[] => {
  const blocked: string[] = [];
  for (const [taskId, value] of latest) {
    if (value.outcome === BLOCKED) blocked.push(taskId);
  }
  return blocked.sort();
};

export function detectBlockedTasks(events: readonly JournalEvent[]): readonly string[] {
  const latest = new Map<string, LatestReview>();
  for (const event of events) {
    if (!isReviewForTask(event)) continue;
    const prior = latest.get(event.taskId);
    if (!shouldReplace(prior, event.seq)) continue;
    latest.set(event.taskId, { seq: event.seq, outcome: event.reviewOutcome });
  }
  return collectBlockedTasks(latest);
}
