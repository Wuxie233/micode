import { ATLAS_SPAWN_OUTCOMES, type AtlasHandoff, type AtlasSpawnReceipt } from "./types";

export interface SpawnGate {
  readonly quickMode: boolean;
  readonly terminal: boolean;
}

export function shouldSpawnAgent2(gate: SpawnGate): boolean {
  return gate.terminal && !gate.quickMode;
}

export interface HandoffInput {
  readonly issueNumber: number;
  readonly affectedModules: readonly string[];
  readonly affectedFeatures: readonly string[];
  readonly designPointer: string | null;
  readonly planPointer: string | null;
  readonly ledgerPointer: string | null;
  readonly decisions: readonly string[];
  readonly crossLayerEffects: readonly string[];
  readonly doNotTouch: readonly string[];
}

export function buildHandoffFromLifecycle(input: HandoffInput): AtlasHandoff {
  return {
    lifecycleIssue: input.issueNumber,
    affectedModules: input.affectedModules,
    affectedFeatures: input.affectedFeatures,
    designPointer: input.designPointer,
    planPointer: input.planPointer,
    ledgerPointer: input.ledgerPointer,
    decisions: input.decisions,
    crossLayerEffects: input.crossLayerEffects,
    doNotTouch: input.doNotTouch,
  };
}

export interface ReceiptInput {
  readonly runId: string;
  readonly sessionId: string;
  readonly spawnAt: string;
  readonly expectedCompletionWindowSec: number;
}

export function buildSpawnReceipt(input: ReceiptInput): AtlasSpawnReceipt {
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    spawnAt: input.spawnAt,
    expectedCompletionWindowSec: input.expectedCompletionWindowSec,
    doneAt: null,
    summary: null,
    outcome: ATLAS_SPAWN_OUTCOMES.PENDING,
  };
}
