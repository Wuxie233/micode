// src/tools/knowledge-bootstrap/types.ts
// Shared types for the knowledge bootstrap orchestrator tooling.
// Layer state tri-value lets the orchestrator distinguish a clean miss
// from a permissions / IO failure (which must not be silently treated as missing).

export type LayerState = "missing" | "present" | "unknown";

export interface FilePresence {
  readonly exists: boolean;
  readonly mtime?: Date;
}

export interface ProjectMemorySummary {
  readonly entries: number;
  readonly healthy: boolean;
}

export interface KnowledgeState {
  readonly init: LayerState;
  readonly mindmodel: LayerState;
  readonly atlas: LayerState;
  readonly projectMemory: ProjectMemorySummary;
  readonly files: {
    readonly architectureMd: FilePresence;
    readonly codeStyleMd: FilePresence;
    readonly mindmodelManifest: FilePresence;
    readonly atlasIndex: FilePresence;
  };
}
