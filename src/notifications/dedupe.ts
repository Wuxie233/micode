import type { NotificationStatus } from "./types";
import { NOTIFICATION_STATUSES } from "./types";

export interface DedupeStore {
  readonly shouldSuppress: (key: string, status: NotificationStatus) => boolean;
  readonly record: (key: string, status: NotificationStatus) => void;
}

export interface DedupeStoreInput {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly clock?: () => number;
}

interface DedupeEntry {
  readonly status: NotificationStatus;
  readonly recordedAt: number;
}

const SAME_STATUS_REPEAT_SUPPRESSED = true;

const isExpired = (entry: DedupeEntry, now: number, ttlMs: number): boolean => {
  return now - entry.recordedAt >= ttlMs;
};

const evictExpired = (entries: Map<string, DedupeEntry>, now: number, ttlMs: number): void => {
  for (const [key, entry] of entries) {
    if (isExpired(entry, now, ttlMs)) entries.delete(key);
  }
};

const evictOldest = (entries: Map<string, DedupeEntry>, maxEntries: number): void => {
  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) return;
    entries.delete(oldestKey);
  }
};

export function createDedupeStore(input: DedupeStoreInput): DedupeStore {
  const entries = new Map<string, DedupeEntry>();
  const clock = input.clock ?? Date.now;

  const shouldSuppress = (key: string, status: NotificationStatus): boolean => {
    const now = clock();
    evictExpired(entries, now, input.ttlMs);
    const existing = entries.get(key);
    if (!existing) return false;
    if (existing.status === status) return SAME_STATUS_REPEAT_SUPPRESSED;
    if (existing.status === NOTIFICATION_STATUSES.BLOCKED && status === NOTIFICATION_STATUSES.COMPLETED) return false;
    return SAME_STATUS_REPEAT_SUPPRESSED;
  };

  const record = (key: string, status: NotificationStatus): void => {
    const now = clock();
    entries.set(key, { status, recordedAt: now });
    evictOldest(entries, input.maxEntries);
  };

  return { shouldSuppress, record };
}
