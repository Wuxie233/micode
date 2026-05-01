import type { SpawnRecord, SpawnSessionRegistry } from "./spawn-session-registry";
import { SPAWN_RECORD_STATES } from "./spawn-session-registry";

export const FENCE_DECISIONS = {
  LAUNCH: "launch",
  DUPLICATE_RUNNING: "duplicate_running",
  DUPLICATE_PRESERVED: "duplicate_preserved",
} as const;

export type FenceDecision = (typeof FENCE_DECISIONS)[keyof typeof FENCE_DECISIONS];

export interface FenceQuery {
  readonly ownerSessionId: string;
  readonly runId: string;
  readonly generation: number;
  readonly taskIdentity: string;
}

export interface FenceResult {
  readonly decision: FenceDecision;
  readonly conflictSessionId: string | null;
}

function isOlderGeneration(record: SpawnRecord, query: FenceQuery): boolean {
  if (record.ownerSessionId !== query.ownerSessionId) return false;
  if (record.taskIdentity !== query.taskIdentity) return false;
  if (record.runId === query.runId && record.generation === query.generation) return false;
  return true;
}

export function evaluateFence(registry: SpawnSessionRegistry, query: FenceQuery): FenceResult {
  const allWithIdentity = collectMatching(registry, query);
  if (allWithIdentity.length === 0) return { decision: FENCE_DECISIONS.LAUNCH, conflictSessionId: null };

  const running = allWithIdentity.find((record) => record.state === SPAWN_RECORD_STATES.RUNNING);
  if (running) return { decision: FENCE_DECISIONS.DUPLICATE_RUNNING, conflictSessionId: running.sessionId };

  const preserved = allWithIdentity.find((record) => record.state === SPAWN_RECORD_STATES.PRESERVED);
  if (preserved) {
    return { decision: FENCE_DECISIONS.DUPLICATE_PRESERVED, conflictSessionId: preserved.sessionId };
  }

  return { decision: FENCE_DECISIONS.LAUNCH, conflictSessionId: null };
}

function collectMatching(registry: SpawnSessionRegistry, query: FenceQuery): readonly SpawnRecord[] {
  const out: SpawnRecord[] = [];
  for (const preserved of registry.listPreserved()) {
    if (isOlderGeneration(preserved, query)) out.push(preserved);
  }
  for (const running of registry.findActiveByTaskIdentity({
    ownerSessionId: query.ownerSessionId,
    taskIdentity: query.taskIdentity,
  })) {
    if (isOlderGeneration(running, query)) out.push(running);
  }
  return out;
}
