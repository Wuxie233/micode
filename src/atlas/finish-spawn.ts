/**
 * Atlas-compiler spawn helpers.
 *
 * These helpers are USER-TRIGGERED ONLY. They are NOT invoked by
 * lifecycle_finish or any other lifecycle-owned event. The earlier design
 * sketched a "lifecycle finish auto-spawns atlas-compiler" path; that path
 * was never wired and is now explicitly forbidden. See the
 * "Atlas Shared Mental Model Maintenance" design (2026-05-10) and AGENTS.md.
 *
 * Valid callers:
 *   - /atlas-refresh slash command (user-typed)
 *   - explicit user request to run atlas-compiler against an existing
 *     thoughts/shared/atlas-deltas/*.md file
 *
 * Forbidden callers:
 *   - src/lifecycle/runner.ts
 *   - src/lifecycle/transitions.ts
 *   - src/tools/lifecycle/*
 *   - any hook invoked from chat.params / event.tool / event.message
 *
 * The grep-based lifecycle boundary test (Batch 4) enforces this rule.
 */
import { ATLAS_SPAWN_OUTCOMES, type AtlasHandoff, type AtlasSpawnReceipt } from "./types";

export interface SpawnGate {
  readonly quickMode: boolean;
  readonly terminal: boolean;
}

/**
 * @deprecated for use as a lifecycle-finish gate. Retained for user-triggered
 * /atlas-refresh and manual atlas-compiler runs only. See module doc above.
 */
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
