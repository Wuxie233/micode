import {
  createSpawnSessionRegistry,
  SPAWN_RECORD_STATES,
  type SpawnPreservedRecord,
  type SpawnSessionRegistry,
} from "./spawn-session-registry";
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

const DEFAULT_RUNNING_TTL_MS = 3_600_000;
const FACADE_OWNER = "facade";
const FACADE_RUN = "facade";
const FACADE_GENERATION = 0;
const registrySpawns = new WeakMap<PreservedRegistry, SpawnSessionRegistry>();

function toPreserved(record: SpawnPreservedRecord): PreservedRecord {
  return {
    sessionId: record.sessionId,
    agent: record.agent,
    description: record.description,
    outcome: record.outcome,
    preservedAt: record.preservedAt,
    resumeCount: record.resumeCount,
  };
}

function registerFacadeRunning(spawn: SpawnSessionRegistry, record: PreserveInput): void {
  spawn.registerRunning({
    sessionId: record.sessionId,
    agent: record.agent,
    description: record.description,
    ownerSessionId: FACADE_OWNER,
    runId: FACADE_RUN,
    generation: FACADE_GENERATION,
    taskIdentity: record.sessionId,
  });
}

export function createPreservedRegistryOver(
  spawn: SpawnSessionRegistry,
  _options: PreservedRegistryOptions,
): PreservedRegistry {
  const registry: PreservedRegistry = {
    preserve(record: PreserveInput): PreservedRecord {
      const existing = spawn.get(record.sessionId);
      // markPreserved only accepts running records, so stale terminal records must be renewed.
      if (existing?.state !== SPAWN_RECORD_STATES.RUNNING) {
        spawn.complete(record.sessionId);
        registerFacadeRunning(spawn, record);
      }
      const preserved = spawn.markPreserved(record.sessionId, record.outcome);
      if (!preserved) throw new Error(`failed to preserve session ${record.sessionId}`);
      return toPreserved(preserved);
    },
    get(sessionId) {
      const found = spawn.get(sessionId);
      if (!found || found.state !== "preserved") return null;
      return toPreserved(found);
    },
    remove(sessionId) {
      spawn.complete(sessionId);
    },
    incrementResume(sessionId) {
      return spawn.incrementResume(sessionId);
    },
    sweep(now) {
      return spawn.sweep(now);
    },
    size() {
      return spawn.listPreserved().length;
    },
  };
  registrySpawns.set(registry, spawn);
  return registry;
}

export function getSpawnRegistryForPreservedRegistry(registry: PreservedRegistry): SpawnSessionRegistry | null {
  return registrySpawns.get(registry) ?? null;
}

export function createPreservedRegistry(options: PreservedRegistryOptions): PreservedRegistry {
  const spawn = createSpawnSessionRegistry({
    maxResumes: options.maxResumes,
    ttlHours: options.ttlHours,
    runningTtlMs: DEFAULT_RUNNING_TTL_MS,
  });
  return createPreservedRegistryOver(spawn, options);
}
