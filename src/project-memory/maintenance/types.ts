import * as v from "valibot";

export const MaintenanceReasonValues = ["manual", "terminal", "scheduled", "dry-run"] as const;

export const MaintenanceCandidateKindValues = [
  "duplicate",
  "missing_source",
  "stale",
  "superseded",
  "deprecated",
  "low_signal",
  "potential_secret",
  "orphan",
] as const;

export const MaintenanceActionKindValues = [
  "archive",
  "tombstone",
  "supersede",
  "mark_stale",
  "deduplicate",
  "refine_summary",
  "hard_delete_secret",
  "needs_review",
  "skip",
] as const;

export const MaintenanceConfidenceValues = ["low", "medium", "high"] as const;

export type MaintenanceReason = (typeof MaintenanceReasonValues)[number];
export type MaintenanceCandidateKind = (typeof MaintenanceCandidateKindValues)[number];
export type MaintenanceActionKind = (typeof MaintenanceActionKindValues)[number];
export type MaintenanceConfidence = (typeof MaintenanceConfidenceValues)[number];

export const MaintenanceReasonSchema = v.picklist(MaintenanceReasonValues);
export const MaintenanceCandidateKindSchema = v.picklist(MaintenanceCandidateKindValues);
export const MaintenanceActionKindSchema = v.picklist(MaintenanceActionKindValues);
export const MaintenanceConfidenceSchema = v.picklist(MaintenanceConfidenceValues);

export const MaintenancePlanItemSchema = v.object({
  entryId: v.string(),
  kind: MaintenanceCandidateKindSchema,
  action: MaintenanceActionKindSchema,
  confidence: MaintenanceConfidenceSchema,
  reason: v.string(),
  safeByDefault: v.boolean(),
});

export const MaintenancePlanSchema = v.object({
  projectId: v.string(),
  reason: MaintenanceReasonSchema,
  items: v.array(MaintenancePlanItemSchema),
  warnings: v.optional(v.array(v.string())),
});

export const MaintenanceRunInputSchema = v.object({
  projectId: v.string(),
  reason: MaintenanceReasonSchema,
  dryRun: v.boolean(),
  triggeredBy: v.string(),
  sourcePointers: v.optional(v.array(v.string())),
});

export const MaintenanceRunOutcomeSchema = v.object({
  applied: v.number(),
  skipped: v.number(),
  blocked: v.number(),
  warnings: v.array(v.string()),
  journalPath: v.string(),
});

export const MaintenanceJournalEventSchema = v.object({
  projectId: v.string(),
  action: MaintenanceActionKindSchema,
  at: v.optional(v.number()),
  entityIds: v.optional(v.array(v.string())),
  entryIds: v.optional(v.array(v.string())),
  sourceIds: v.optional(v.array(v.string())),
  reasons: v.optional(v.array(MaintenanceCandidateKindSchema)),
  counts: v.optional(v.record(v.string(), v.number())),
  details: v.optional(v.string()),
  entrySummaries: v.optional(v.array(v.string())),
});

export type MaintenancePlanItem = v.InferOutput<typeof MaintenancePlanItemSchema>;
export type MaintenancePlan = v.InferOutput<typeof MaintenancePlanSchema>;
export type MaintenanceRunInput = v.InferOutput<typeof MaintenanceRunInputSchema>;
export type MaintenanceRunOutcome = v.InferOutput<typeof MaintenanceRunOutcomeSchema>;
export type MaintenanceJournalEvent = v.InferOutput<typeof MaintenanceJournalEventSchema>;
