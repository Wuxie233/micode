import type { SPAWN_OUTCOMES } from "./types";

export const SPAWN_RECORD_STATES = {
  RUNNING: "running",
  PRESERVED: "preserved",
  ABORTED: "aborted",
} as const;

export type SpawnRecordState = (typeof SPAWN_RECORD_STATES)[keyof typeof SPAWN_RECORD_STATES];

export interface SpawnRunningRecord {
  readonly sessionId: string;
  readonly agent: string;
  readonly description: string;
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly taskIdentity: string;
  readonly state: typeof SPAWN_RECORD_STATES.RUNNING;
  readonly createdAt: number;
}

export interface SpawnPreservedRecord {
  readonly sessionId: string;
  readonly agent: string;
  readonly description: string;
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly taskIdentity: string;
  readonly state: typeof SPAWN_RECORD_STATES.PRESERVED;
  readonly outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED;
  readonly preservedAt: number;
  readonly resumeCount: number;
  readonly createdAt: number;
}

export interface SpawnAbortedRecord {
  readonly sessionId: string;
  readonly agent: string;
  readonly description: string;
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly taskIdentity: string;
  readonly state: typeof SPAWN_RECORD_STATES.ABORTED;
  readonly abortedAt: number;
  readonly reason: string;
  readonly createdAt: number;
}

export type SpawnRecord = SpawnRunningRecord | SpawnPreservedRecord | SpawnAbortedRecord;

export interface RegisterRunningInput {
  readonly sessionId: string;
  readonly agent: string;
  readonly description: string;
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly taskIdentity: string;
}

export interface FindActiveQuery {
  readonly ownerSessionId: string;
  readonly taskIdentity: string;
}

export interface AbortGenerationInput {
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly reason: string;
}

export interface SpawnSessionRegistryOptions {
  readonly maxResumes: number;
  readonly ttlHours: number;
  readonly runningTtlMs: number;
}

export interface SpawnSessionRegistry {
  readonly registerRunning: (input: RegisterRunningInput) => SpawnRunningRecord;
  readonly markPreserved: (
    sessionId: string,
    outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED,
  ) => SpawnPreservedRecord | null;
  readonly markAborted: (sessionId: string, reason: string) => SpawnAbortedRecord | null;
  readonly complete: (sessionId: string) => void;
  readonly get: (sessionId: string) => SpawnRecord | null;
  readonly incrementResume: (sessionId: string) => number;
  readonly findActiveByTaskIdentity: (query: FindActiveQuery) => readonly SpawnRunningRecord[];
  readonly listByGeneration: (input: Omit<AbortGenerationInput, "reason">) => readonly SpawnRecord[];
  readonly abortGeneration: (input: AbortGenerationInput) => readonly SpawnAbortedRecord[];
  readonly listPreserved: () => readonly SpawnPreservedRecord[];
  readonly sweep: (now: number) => number;
  readonly size: () => number;
}

const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const RESUME_INCREMENT = 1;
const INITIAL_RESUME_COUNT = 0;

type SpawnRecordStore = Map<string, SpawnRecord>;
type GenerationQuery = Omit<AbortGenerationInput, "reason">;

const cloneRecord = <T extends SpawnRecord>(record: T): T => ({ ...record });

function isPreserved(record: SpawnRecord): record is SpawnPreservedRecord {
  return record.state === SPAWN_RECORD_STATES.PRESERVED;
}

function isRunning(record: SpawnRecord): record is SpawnRunningRecord {
  return record.state === SPAWN_RECORD_STATES.RUNNING;
}

function isAborted(record: SpawnRecord): record is SpawnAbortedRecord {
  return record.state === SPAWN_RECORD_STATES.ABORTED;
}

function buildRunningRecord(input: RegisterRunningInput): SpawnRunningRecord {
  return {
    ...input,
    state: SPAWN_RECORD_STATES.RUNNING,
    createdAt: Date.now(),
  };
}

function buildPreservedRecord(
  existing: SpawnRunningRecord,
  outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED,
): SpawnPreservedRecord {
  return {
    sessionId: existing.sessionId,
    agent: existing.agent,
    description: existing.description,
    ownerSessionId: existing.ownerSessionId,
    runId: existing.runId,
    generation: existing.generation,
    taskIdentity: existing.taskIdentity,
    state: SPAWN_RECORD_STATES.PRESERVED,
    outcome,
    preservedAt: Date.now(),
    resumeCount: INITIAL_RESUME_COUNT,
    createdAt: existing.createdAt,
  };
}

function buildAbortedRecord(existing: SpawnRecord, reason: string): SpawnAbortedRecord {
  return {
    sessionId: existing.sessionId,
    agent: existing.agent,
    description: existing.description,
    ownerSessionId: existing.ownerSessionId,
    runId: existing.runId,
    generation: existing.generation,
    taskIdentity: existing.taskIdentity,
    state: SPAWN_RECORD_STATES.ABORTED,
    abortedAt: Date.now(),
    reason,
    createdAt: existing.createdAt,
  };
}

function registerRunning(records: SpawnRecordStore, input: RegisterRunningInput): SpawnRunningRecord {
  const record = buildRunningRecord(input);
  records.set(input.sessionId, record);
  return cloneRecord(record);
}

function markPreserved(
  records: SpawnRecordStore,
  sessionId: string,
  outcome: typeof SPAWN_OUTCOMES.TASK_ERROR | typeof SPAWN_OUTCOMES.BLOCKED,
): SpawnPreservedRecord | null {
  const existing = records.get(sessionId);
  if (!existing || !isRunning(existing)) return null;
  const preserved = buildPreservedRecord(existing, outcome);
  records.set(sessionId, preserved);
  return cloneRecord(preserved);
}

function markAborted(records: SpawnRecordStore, sessionId: string, reason: string): SpawnAbortedRecord | null {
  const existing = records.get(sessionId);
  if (!existing || isAborted(existing)) return null;
  const aborted = buildAbortedRecord(existing, reason);
  records.set(sessionId, aborted);
  return cloneRecord(aborted);
}

function getRecord(records: SpawnRecordStore, sessionId: string): SpawnRecord | null {
  const record = records.get(sessionId);
  return record ? cloneRecord(record) : null;
}

function incrementResume(records: SpawnRecordStore, sessionId: string, maxResumes: number): number {
  const record = records.get(sessionId);
  if (!record || !isPreserved(record)) return INITIAL_RESUME_COUNT;
  const resumeCount = Math.min(maxResumes, record.resumeCount + RESUME_INCREMENT);
  records.set(sessionId, { ...record, resumeCount });
  return resumeCount;
}

function matchesGeneration(record: SpawnRecord, input: GenerationQuery): boolean {
  return (
    record.ownerSessionId === input.ownerSessionId &&
    record.runId === input.runId &&
    record.generation === input.generation
  );
}

function collectGenerationRecords(records: SpawnRecordStore, input: GenerationQuery): readonly SpawnRecord[] {
  const generation: SpawnRecord[] = [];
  for (const record of records.values()) {
    if (!matchesGeneration(record, input)) continue;
    generation.push(cloneRecord(record));
  }
  return generation;
}

function abortGeneration(records: SpawnRecordStore, input: AbortGenerationInput): readonly SpawnAbortedRecord[] {
  const aborted: SpawnAbortedRecord[] = [];
  for (const record of collectGenerationRecords(records, input)) {
    if (!isRunning(record)) continue;
    const next = markAborted(records, record.sessionId, input.reason);
    if (!next) continue;
    aborted.push(next);
  }
  return aborted;
}

function findActiveByTaskIdentity(records: SpawnRecordStore, query: FindActiveQuery): readonly SpawnRunningRecord[] {
  const active: SpawnRunningRecord[] = [];
  for (const record of records.values()) {
    if (!isRunning(record)) continue;
    if (record.ownerSessionId !== query.ownerSessionId) continue;
    if (record.taskIdentity !== query.taskIdentity) continue;
    active.push(cloneRecord(record));
  }
  return active;
}

function listPreserved(records: SpawnRecordStore): readonly SpawnPreservedRecord[] {
  const preserved: SpawnPreservedRecord[] = [];
  for (const record of records.values()) {
    if (!isPreserved(record)) continue;
    preserved.push(cloneRecord(record));
  }
  return preserved;
}

function isExpiredRecord(record: SpawnRecord, now: number, ttlMs: number, runningTtlMs: number): boolean {
  if (isPreserved(record)) return now - record.preservedAt > ttlMs;
  if (isAborted(record)) return now - record.abortedAt > ttlMs;
  return now - record.createdAt > runningTtlMs;
}

function sweepExpiredRecord(
  records: SpawnRecordStore,
  sessionId: string,
  record: SpawnRecord,
  now: number,
  ttlMs: number,
  runningTtlMs: number,
): boolean {
  if (!isExpiredRecord(record, now, ttlMs, runningTtlMs)) return false;
  records.delete(sessionId);
  return true;
}

function sweep(records: SpawnRecordStore, now: number, ttlMs: number, runningTtlMs: number): number {
  let removed = 0;
  for (const [sessionId, record] of records) {
    if (!sweepExpiredRecord(records, sessionId, record, now, ttlMs, runningTtlMs)) continue;
    removed += 1;
  }
  return removed;
}

export function createSpawnSessionRegistry(options: SpawnSessionRegistryOptions): SpawnSessionRegistry {
  const records = new Map<string, SpawnRecord>();
  const ttlMs = options.ttlHours * MS_PER_HOUR;
  return {
    registerRunning: (input) => registerRunning(records, input),
    markPreserved: (sessionId, outcome) => markPreserved(records, sessionId, outcome),
    markAborted: (sessionId, reason) => markAborted(records, sessionId, reason),
    complete: (sessionId) => records.delete(sessionId),
    get: (sessionId) => getRecord(records, sessionId),
    incrementResume: (sessionId) => incrementResume(records, sessionId, options.maxResumes),
    findActiveByTaskIdentity: (query) => findActiveByTaskIdentity(records, query),
    listByGeneration: (input) => collectGenerationRecords(records, input),
    abortGeneration: (input) => abortGeneration(records, input),
    listPreserved: () => listPreserved(records),
    sweep: (now) => sweep(records, now, ttlMs, options.runningTtlMs),
    size: () => records.size,
  };
}
