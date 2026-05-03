// src/project-memory/types.ts
import * as v from "valibot";

export const EntityKindValues = ["workflow", "module", "tool", "feature", "risk_area", "decision_area"] as const;

export const EntryTypeValues = [
  "fact",
  "decision",
  "rationale",
  "lesson",
  "risk",
  "todo",
  "open_question",
  "hypothesis",
  "note",
  "procedure",
] as const;

export const SensitivityValues = ["public", "internal", "secret"] as const;
export const StatusValues = ["active", "superseded", "tentative", "hypothesis", "deprecated"] as const;
export const RelationKindValues = ["parent", "related", "supersedes"] as const;
export const SourceKindValues = ["design", "plan", "ledger", "lifecycle", "mindmodel", "manual", "skill"] as const;

export type EntityKind = (typeof EntityKindValues)[number];
export type EntryType = (typeof EntryTypeValues)[number];
export type Sensitivity = (typeof SensitivityValues)[number];
export type Status = (typeof StatusValues)[number];
export type RelationKind = (typeof RelationKindValues)[number];
export type SourceKind = (typeof SourceKindValues)[number];

export const EntitySchema = v.object({
  id: v.string(),
  projectId: v.string(),
  kind: v.picklist(EntityKindValues),
  name: v.string(),
  summary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const EntrySchema = v.object({
  id: v.string(),
  projectId: v.string(),
  entityId: v.string(),
  type: v.picklist(EntryTypeValues),
  title: v.string(),
  summary: v.string(),
  status: v.picklist(StatusValues),
  sensitivity: v.picklist(SensitivityValues),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const RelationSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  fromId: v.string(),
  toId: v.string(),
  kind: v.picklist(RelationKindValues),
  createdAt: v.number(),
});

export const SourceSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  entryId: v.string(),
  kind: v.picklist(SourceKindValues),
  pointer: v.string(),
  excerpt: v.optional(v.string()),
  createdAt: v.number(),
});

export type Entity = v.InferOutput<typeof EntitySchema>;
export type Entry = v.InferOutput<typeof EntrySchema>;
export type Relation = v.InferOutput<typeof RelationSchema>;
export type Source = v.InferOutput<typeof SourceSchema>;

export interface LookupHit {
  readonly entry: Entry;
  readonly entity: Entity;
  readonly sources: readonly Source[];
  readonly snippet: string;
  readonly score: number;
  readonly degraded: boolean;
}

export interface HealthReport {
  readonly projectId: string;
  readonly identityKind: "origin" | "path";
  readonly entityCount: number;
  readonly entryCount: number;
  readonly entriesByStatus: Record<Status, number>;
  readonly staleEntryCount: number;
  readonly missingSourceCount: number;
  readonly recentUpdates: number;
  readonly warnings: readonly string[];
}
