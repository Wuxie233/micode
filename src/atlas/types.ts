export const ATLAS_LAYERS = {
  IMPL: "impl",
  BEHAVIOR: "behavior",
  DECISION: "decision",
  RISK: "risk",
  TIMELINE: "timeline",
} as const;

export type AtlasLayer = (typeof ATLAS_LAYERS)[keyof typeof ATLAS_LAYERS];

export const ATLAS_NODE_STATUSES = {
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  DEPRECATED: "deprecated",
} as const;

export type AtlasNodeStatus = (typeof ATLAS_NODE_STATUSES)[keyof typeof ATLAS_NODE_STATUSES];

export const ATLAS_CHALLENGE_STATUSES = {
  OPEN: "open",
  APPROVED: "approved",
  DISMISSED: "dismissed",
} as const;

export type AtlasChallengeStatus = (typeof ATLAS_CHALLENGE_STATUSES)[keyof typeof ATLAS_CHALLENGE_STATUSES];

export const ATLAS_SPAWN_OUTCOMES = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type AtlasSpawnOutcome = (typeof ATLAS_SPAWN_OUTCOMES)[keyof typeof ATLAS_SPAWN_OUTCOMES];

export interface AtlasFrontmatter {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly last_verified_commit: string;
  readonly last_written_mtime: number;
  readonly sources: readonly string[];
  readonly extras: Readonly<Record<string, string>>;
}

export interface AtlasNode {
  readonly path: string;
  readonly frontmatter: AtlasFrontmatter;
  readonly summary: string;
  readonly connections: readonly string[];
  readonly sourcesBody: readonly string[];
  readonly notes: string;
}

export interface AtlasHandoff {
  readonly lifecycleIssue: number;
  readonly affectedModules: readonly string[];
  readonly affectedFeatures: readonly string[];
  readonly designPointer: string | null;
  readonly planPointer: string | null;
  readonly ledgerPointer: string | null;
  readonly decisions: readonly string[];
  readonly crossLayerEffects: readonly string[];
  readonly doNotTouch: readonly string[];
}

export interface AtlasSpawnReceipt {
  readonly runId: string;
  readonly sessionId: string;
  readonly spawnAt: string;
  readonly expectedCompletionWindowSec: number;
  readonly doneAt: string | null;
  readonly summary: string | null;
  readonly outcome: AtlasSpawnOutcome;
}

export interface AtlasChallengeRecord {
  readonly target: string;
  readonly claimHash: string;
  readonly status: AtlasChallengeStatus;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
  readonly createdAt: string;
}
