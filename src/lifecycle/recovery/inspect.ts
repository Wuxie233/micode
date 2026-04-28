import type { JournalEvent } from "@/lifecycle/journal/types";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import type { LeaseRecord } from "@/lifecycle/lease/types";
import type { RuntimeIdentity } from "@/lifecycle/recovery/identity";
import { RECOVERY_DECISION_KINDS, type RecoveryBlockReason, type RecoveryDecision } from "@/lifecycle/recovery/types";
import type { LifecycleRecord } from "@/lifecycle/types";

export interface RecoveryInspectorDeps {
  readonly record: LifecycleRecord;
  readonly events: readonly JournalEvent[];
  readonly currentLease: LeaseRecord | null;
  readonly identity: RuntimeIdentity;
  readonly expectedOrigin: string | null;
  readonly now: number;
  readonly currentOwner?: string;
}

interface BatchSummary {
  readonly batchId: string;
  readonly dispatched: boolean;
  readonly completed: boolean;
  readonly observedCommit: boolean;
}

interface BatchFlags {
  dispatched: boolean;
  completed: boolean;
  observedCommit: boolean;
}

const JOURNAL_CORRUPT_DETAIL = "journal sequence is not strictly increasing";
const BATCH_PENDING_NOTE = "was dispatched but never completed and has no commit_observed event";

const lastSeqOf = (events: readonly JournalEvent[]): number => {
  if (events.length === 0) return 0;
  return events[events.length - 1]?.seq ?? 0;
};

const isMonotonic = (events: readonly JournalEvent[]): boolean => {
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (!previous || !current) continue;
    if (current.seq <= previous.seq) return false;
  }
  return true;
};

const block = (reason: RecoveryBlockReason, detail: string, lastSeq: number): RecoveryDecision => ({
  kind: RECOVERY_DECISION_KINDS.BLOCKED,
  reason,
  detail,
  lastSeq,
});

const createFlags = (): BatchFlags => ({
  dispatched: false,
  completed: false,
  observedCommit: false,
});

const updateFlags = (flags: BatchFlags, event: JournalEvent): void => {
  if (event.kind === JOURNAL_EVENT_KINDS.BATCH_DISPATCHED) flags.dispatched = true;
  if (event.kind === JOURNAL_EVENT_KINDS.BATCH_COMPLETED) flags.completed = true;
  if (event.kind === JOURNAL_EVENT_KINDS.COMMIT_OBSERVED) flags.observedCommit = true;
};

const getFlags = (batches: Map<string, BatchFlags>, order: string[], batchId: string): BatchFlags => {
  const existing = batches.get(batchId);
  if (existing) return existing;

  const created = createFlags();
  batches.set(batchId, created);
  order.push(batchId);
  return created;
};

const summarize = (events: readonly JournalEvent[]): readonly BatchSummary[] => {
  const batches = new Map<string, BatchFlags>();
  const order: string[] = [];

  for (const event of events) {
    if (event.batchId === null) continue;
    updateFlags(getFlags(batches, order, event.batchId), event);
  }

  return order.map((batchId) => ({
    batchId,
    dispatched: batches.get(batchId)?.dispatched ?? false,
    completed: batches.get(batchId)?.completed ?? false,
    observedCommit: batches.get(batchId)?.observedCommit ?? false,
  }));
};

const leaseActiveForOtherOwner = (deps: RecoveryInspectorDeps): boolean => {
  if (deps.currentLease === null) return false;
  if (deps.currentOwner !== undefined && deps.currentLease.owner === deps.currentOwner) return false;
  return deps.now - deps.currentLease.heartbeatAt <= deps.currentLease.ttlMs;
};

const completedBatchIds = (summaries: readonly BatchSummary[]): readonly string[] =>
  summaries.filter((summary) => summary.completed).map((summary) => summary.batchId);

const inspectBatches = (
  summaries: readonly BatchSummary[],
): { readonly reconciled: readonly string[]; readonly pending: string | null } => {
  const reconciled: string[] = [];

  for (const summary of summaries) {
    if (summary.completed) continue;
    if (summary.observedCommit) {
      reconciled.push(summary.batchId);
      continue;
    }
    if (summary.dispatched) return { reconciled, pending: summary.batchId };
  }

  return { reconciled, pending: null };
};

export function inspectRecovery(deps: RecoveryInspectorDeps): RecoveryDecision {
  const lastSeq = lastSeqOf(deps.events);

  if (!isMonotonic(deps.events)) return block("journal_corrupt", JOURNAL_CORRUPT_DETAIL, lastSeq);
  if (deps.identity.branch !== null && deps.identity.branch !== deps.record.branch) {
    return block("branch_mismatch", `expected ${deps.record.branch}, found ${deps.identity.branch}`, lastSeq);
  }
  if (deps.identity.worktree !== deps.record.worktree) {
    return block("worktree_mismatch", `expected ${deps.record.worktree}, found ${deps.identity.worktree}`, lastSeq);
  }
  if (deps.expectedOrigin !== null && deps.identity.origin !== null && deps.identity.origin !== deps.expectedOrigin) {
    return block("origin_mismatch", `expected ${deps.expectedOrigin}, found ${deps.identity.origin}`, lastSeq);
  }
  if (leaseActiveForOtherOwner(deps))
    return block("lease_active", `lease held by ${deps.currentLease?.owner}`, lastSeq);

  const summaries = summarize(deps.events);
  const { reconciled, pending } = inspectBatches(summaries);
  const completed = completedBatchIds(summaries);

  if (pending !== null) {
    return {
      kind: RECOVERY_DECISION_KINDS.PARTIAL_RESUME,
      completedBatches: completed,
      pendingBatchId: pending,
      note: `batch ${pending} ${BATCH_PENDING_NOTE}`,
      lastSeq,
    };
  }

  if (reconciled.length > 0) {
    return {
      kind: RECOVERY_DECISION_KINDS.RECONCILED_RESUME,
      backfilledBatches: reconciled,
      nextBatchId: completed[completed.length - 1] ?? null,
      lastSeq,
    };
  }

  return {
    kind: RECOVERY_DECISION_KINDS.CLEAN_RESUME,
    nextBatchId: completed[completed.length - 1] ?? null,
    lastSeq,
  };
}
