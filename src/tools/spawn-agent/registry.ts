import type { SPAWN_OUTCOMES } from "./types";

export interface PreservedRecord {
  readonly sessionId: string;
  readonly agent: string;
  readonly description: string;
  readonly outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED;
  readonly preservedAt: number;
  readonly resumeCount: number;
}

export type PreserveInput = Omit<PreservedRecord, "preservedAt" | "resumeCount">;

export interface PreservedRegistryOptions {
  readonly maxResumes: number;
  readonly ttlHours: number;
}

export interface PreservedRegistry {
  readonly preserve: (record: PreserveInput) => PreservedRecord;
  readonly get: (sessionId: string) => PreservedRecord | null;
  readonly remove: (sessionId: string) => void;
  readonly incrementResume: (sessionId: string) => number;
  readonly sweep: (now: number) => number;
  readonly size: () => number;
}

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const RESUME_INCREMENT = 1;
const REMOVED_NONE = 0;
const INITIAL_RESUME_COUNT = 0;

const cloneRecord = (record: PreservedRecord): PreservedRecord => ({ ...record });

const buildRecord = (record: PreserveInput): PreservedRecord => ({
  ...record,
  preservedAt: Date.now(),
  resumeCount: INITIAL_RESUME_COUNT,
});

export function createPreservedRegistry(options: PreservedRegistryOptions): PreservedRegistry {
  const records = new Map<string, PreservedRecord>();
  const ttlMs = options.ttlHours * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

  return {
    preserve(record: PreserveInput): PreservedRecord {
      const preserved = buildRecord(record);
      records.set(record.sessionId, preserved);
      return cloneRecord(preserved);
    },
    get(sessionId: string): PreservedRecord | null {
      const record = records.get(sessionId);
      if (!record) return null;
      return cloneRecord(record);
    },
    remove(sessionId: string): void {
      records.delete(sessionId);
    },
    incrementResume(sessionId: string): number {
      const record = records.get(sessionId);
      if (!record) return INITIAL_RESUME_COUNT;
      const resumeCount = Math.min(options.maxResumes, record.resumeCount + RESUME_INCREMENT);
      records.set(sessionId, { ...record, resumeCount });
      return resumeCount;
    },
    sweep(now: number): number {
      let removed = REMOVED_NONE;
      for (const [sessionId, record] of records) {
        if (now - record.preservedAt <= ttlMs) continue;
        records.delete(sessionId);
        removed += RESUME_INCREMENT;
      }
      return removed;
    },
    size(): number {
      return records.size;
    },
  };
}
