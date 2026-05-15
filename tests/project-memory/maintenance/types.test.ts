import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import {
  MaintenanceActionKindSchema,
  MaintenanceActionKindValues,
  MaintenanceCandidateKindSchema,
  MaintenanceCandidateKindValues,
  MaintenanceJournalEventSchema,
  MaintenancePlanItemSchema,
  MaintenancePlanSchema,
  MaintenanceReasonSchema,
  MaintenanceReasonValues,
  MaintenanceRunInputSchema,
  MaintenanceRunOutcomeSchema,
} from "@/project-memory/maintenance/types";

describe("project-memory maintenance types", () => {
  it("declares maintenance reason vocabulary and schema", () => {
    expect(MaintenanceReasonValues).toEqual(["manual", "terminal", "scheduled", "dry-run"]);

    for (const reason of MaintenanceReasonValues) {
      expect(v.safeParse(MaintenanceReasonSchema, reason).success).toBe(true);
    }
  });

  it("declares candidate kind vocabulary and schema", () => {
    expect(MaintenanceCandidateKindValues).toEqual([
      "duplicate",
      "missing_source",
      "stale",
      "superseded",
      "deprecated",
      "low_signal",
      "potential_secret",
      "orphan",
    ]);

    for (const kind of MaintenanceCandidateKindValues) {
      expect(v.safeParse(MaintenanceCandidateKindSchema, kind).success).toBe(true);
    }
  });

  it("declares action kind vocabulary and keeps hard_delete_secret distinct", () => {
    expect(MaintenanceActionKindValues).toEqual([
      "archive",
      "tombstone",
      "supersede",
      "mark_stale",
      "deduplicate",
      "refine_summary",
      "hard_delete_secret",
      "needs_review",
      "skip",
    ]);

    for (const action of MaintenanceActionKindValues) {
      expect(v.safeParse(MaintenanceActionKindSchema, action).success).toBe(true);
    }

    expect(MaintenanceActionKindValues).toContain("hard_delete_secret");
    expect(MaintenanceActionKindValues).not.toContain("hard_delete");
  });

  it("accepts maintenance plan items and plans", () => {
    const item = {
      entryId: "entry_1",
      kind: "potential_secret" as const,
      action: "hard_delete_secret" as const,
      confidence: "high" as const,
      reason: "Looks like a secret-bearing entry.",
      safeByDefault: false,
    };

    expect(v.safeParse(MaintenancePlanItemSchema, item).success).toBe(true);
    expect(
      v.safeParse(MaintenancePlanSchema, {
        projectId: "project_1",
        reason: "manual" as const,
        items: [item],
        warnings: ["secret deletion requires review"],
      }).success,
    ).toBe(true);
  });

  it("accepts run inputs, outcomes, and journal events", () => {
    expect(
      v.safeParse(MaintenanceRunInputSchema, {
        projectId: "project_1",
        reason: "dry-run" as const,
        dryRun: true,
        triggeredBy: "test",
        sourcePointers: ["manual://operator"],
      }).success,
    ).toBe(true);

    expect(
      v.safeParse(MaintenanceRunOutcomeSchema, {
        applied: 0,
        skipped: 1,
        blocked: 1,
        warnings: ["dry run"],
        journalPath: "/tmp/project_1.jsonl",
      }).success,
    ).toBe(true);

    expect(
      v.safeParse(MaintenanceJournalEventSchema, {
        projectId: "project_1",
        action: "hard_delete_secret" as const,
        at: 1,
        entryIds: ["entry_1"],
        reasons: ["potential_secret"],
        counts: { blocked: 1 },
      }).success,
    ).toBe(true);
  });
});
