export const JOURNAL_EVENT_KINDS = {
  BATCH_DISPATCHED: "batch_dispatched",
  BATCH_COMPLETED: "batch_completed",
  REVIEW_COMPLETED: "review_completed",
  COMMIT_OBSERVED: "commit_observed",
  LEASE_ACQUIRED: "lease_acquired",
  LEASE_RELEASED: "lease_released",
  RECOVERY_INSPECTED: "recovery_inspected",
  RECOVERY_BLOCKED: "recovery_blocked",
} as const;

export type JournalEventKind = (typeof JOURNAL_EVENT_KINDS)[keyof typeof JOURNAL_EVENT_KINDS];

export interface JournalEvent {
  readonly kind: JournalEventKind;
  readonly issueNumber: number;
  readonly seq: number;
  readonly at: number;
  readonly batchId: string | null;
  readonly taskId: string | null;
  readonly attempt: number;
  readonly summary: string;
  readonly commitMarker: string | null;
  readonly reviewOutcome: "approved" | "changes_requested" | "blocked" | null;
}

export interface JournalEventInput {
  readonly kind: JournalEventKind;
  readonly batchId?: string | null;
  readonly taskId?: string | null;
  readonly attempt?: number;
  readonly summary: string;
  readonly commitMarker?: string | null;
  readonly reviewOutcome?: JournalEvent["reviewOutcome"];
}
