import type { AtlasLayer } from "@/atlas/types";

export interface ColdInitDiscovery {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly modules: readonly DiscoveredModule[];
  readonly designs: readonly DiscoveredArtifact[];
  readonly plans: readonly DiscoveredArtifact[];
  readonly ledgers: readonly DiscoveredArtifact[];
  readonly lifecycleRecords: readonly DiscoveredLifecycle[];
  readonly mindmodelEntries: readonly DiscoveredArtifact[];
  readonly projectMemoryDecisions: readonly DiscoveredMemoryEntry[];
  readonly projectMemoryRisks: readonly DiscoveredMemoryEntry[];
  readonly projectMemoryOpenQuestions: readonly DiscoveredMemoryEntry[];
  readonly readmeSummary: string | null;
  readonly architectureSummary: string | null;
}

export interface DiscoveredModule {
  readonly name: string;
  readonly pointer: string;
  readonly responsibility: string;
  readonly relativePath: string;
}

export interface DiscoveredArtifact {
  readonly pointer: string;
  readonly relativePath: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface DiscoveredLifecycle {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
}

export interface DiscoveredMemoryEntry {
  readonly pointer: string;
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface PlannedNode {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly relativePath: string;
  readonly title: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly connections: readonly string[];
  readonly inferred: boolean;
}

export interface VaultPlan {
  readonly indexNode: PlannedNode;
  readonly buildNodes: readonly PlannedNode[];
  readonly behaviorNodes: readonly PlannedNode[];
  readonly decisionNodes: readonly PlannedNode[];
  readonly riskNodes: readonly PlannedNode[];
  readonly timelineNodes: readonly PlannedNode[];
}

export interface ColdInitOptions {
  readonly askQuestions: boolean;
  readonly questionTimeoutMs: number;
}

export interface ColdInitOutcome {
  readonly status: "ok" | "rejected" | "dry-run";
  readonly reason?: string;
  readonly nodesWritten: number;
  readonly questionsAsked: number;
  readonly stagingDir: string | null;
  readonly logPath: string | null;
}
