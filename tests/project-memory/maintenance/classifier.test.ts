import { describe, expect, it } from "bun:test";

import {
  classifyMaintenanceSnapshot,
  DEFAULT_MAINTENANCE_STALE_AFTER_MS,
} from "@/project-memory/maintenance/classifier";
import type { Entry, Source } from "@/project-memory/types";

const PROJECT_ID = "project-maintenance";
const NOW = 1_000_000;
const OLD = NOW - DEFAULT_MAINTENANCE_STALE_AFTER_MS - 1;
const RECENT = NOW - 1_000;

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "entry_1",
    projectId: PROJECT_ID,
    entityId: "entity_1",
    type: "note",
    title: "Stable entry",
    summary: "Useful project memory note.",
    status: "active",
    sensitivity: "internal",
    createdAt: OLD,
    updatedAt: RECENT,
    ...overrides,
  };
}

function source(entryId: string): Source {
  return {
    id: `source_${entryId}`,
    projectId: PROJECT_ID,
    entryId,
    kind: "manual",
    pointer: `manual://${entryId}`,
    createdAt: RECENT,
  };
}

describe("project-memory maintenance classifier", () => {
  it("supersedes exact duplicate entries while keeping the newest copy", () => {
    const older = entry({ id: "entry_old", updatedAt: OLD });
    const newest = entry({ id: "entry_new", updatedAt: RECENT });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "dry-run",
      now: NOW,
      entries: [older, newest],
      sources: [source(newest.id)],
    });

    expect(plan.items).toEqual([
      {
        entryId: older.id,
        kind: "duplicate",
        action: "supersede",
        confidence: "high",
        reason: "Exact duplicate of a newer entry in the same entity/type/title/summary group.",
        safeByDefault: true,
      },
    ]);
  });

  it("archives low-signal note and todo entries with missing sources", () => {
    const note = entry({ id: "entry_note", type: "note" });
    const todo = entry({ id: "entry_todo", type: "todo" });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "scheduled",
      now: NOW,
      entries: [note, todo],
      sources: [],
    });

    expect(plan.items).toEqual([
      {
        entryId: note.id,
        kind: "missing_source",
        action: "archive",
        confidence: "low",
        reason: "Low-signal note/todo entry has no source pointer.",
        safeByDefault: true,
      },
      {
        entryId: todo.id,
        kind: "missing_source",
        action: "archive",
        confidence: "low",
        reason: "Low-signal note/todo entry has no source pointer.",
        safeByDefault: true,
      },
    ]);
  });

  it("does not delete missing-source decisions or risks", () => {
    const decision = entry({ id: "entry_decision", type: "decision" });
    const risk = entry({ id: "entry_risk", type: "risk" });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "manual",
      now: NOW,
      entries: [decision, risk],
      sources: [],
    });

    expect(plan.items.map((item) => item.action)).toEqual(["needs_review", "needs_review"]);
    expect(plan.items.every((item) => item.kind === "missing_source" && item.safeByDefault === false)).toBe(true);
  });

  it("marks old active entries stale but sends old decisions and risks to review", () => {
    const note = entry({ id: "entry_note", type: "note", updatedAt: OLD });
    const decision = entry({ id: "entry_decision", type: "decision", updatedAt: OLD });
    const risk = entry({ id: "entry_risk", type: "risk", updatedAt: OLD });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "scheduled",
      now: NOW,
      entries: [note, decision, risk],
      sources: [source(note.id), source(decision.id), source(risk.id)],
    });

    expect(plan.items).toEqual([
      {
        entryId: note.id,
        kind: "stale",
        action: "mark_stale",
        confidence: "medium",
        reason: "Active entry is older than the maintenance stale threshold.",
        safeByDefault: true,
      },
      {
        entryId: decision.id,
        kind: "stale",
        action: "needs_review",
        confidence: "medium",
        reason: "Old active decision/risk needs human review before staling.",
        safeByDefault: false,
      },
      {
        entryId: risk.id,
        kind: "stale",
        action: "needs_review",
        confidence: "medium",
        reason: "Old active decision/risk needs human review before staling.",
        safeByDefault: false,
      },
    ]);
  });

  it("archives old deprecated and superseded entries", () => {
    const deprecated = entry({
      id: "entry_deprecated",
      status: "deprecated",
      title: "Deprecated entry",
      updatedAt: OLD,
    });
    const superseded = entry({
      id: "entry_superseded",
      status: "superseded",
      title: "Superseded entry",
      updatedAt: OLD,
    });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "scheduled",
      now: NOW,
      entries: [deprecated, superseded],
      sources: [source(deprecated.id), source(superseded.id)],
    });

    expect(plan.items).toEqual([
      {
        entryId: deprecated.id,
        kind: "deprecated",
        action: "archive",
        confidence: "high",
        reason: "Deprecated entry is older than the maintenance stale threshold.",
        safeByDefault: true,
      },
      {
        entryId: superseded.id,
        kind: "superseded",
        action: "archive",
        confidence: "high",
        reason: "Superseded entry is older than the maintenance stale threshold.",
        safeByDefault: true,
      },
    ]);
  });

  it("plans secret hard deletion without echoing the secret value", () => {
    const secretValue = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const secretEntry = entry({ id: "entry_secret", title: `leaked token=${secretValue}` });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "terminal",
      now: NOW,
      entries: [secretEntry],
      sources: [source(secretEntry.id)],
    });

    expect(plan.items).toEqual([
      {
        entryId: secretEntry.id,
        kind: "potential_secret",
        action: "hard_delete_secret",
        confidence: "high",
        reason: "Entry title/summary matched secret detector; value intentionally omitted.",
        safeByDefault: true,
      },
    ]);
    expect(JSON.stringify(plan)).not.toContain(secretValue);
  });

  it("routes Atlas observations to review only", () => {
    const atlasObservation = entry({ id: "entry_atlas", title: "Atlas observation: stale-detected — node — reason" });

    const plan = classifyMaintenanceSnapshot({
      projectId: PROJECT_ID,
      reason: "dry-run",
      now: NOW,
      entries: [atlasObservation],
      sources: [source(atlasObservation.id)],
    });

    expect(plan.items).toEqual([
      {
        entryId: atlasObservation.id,
        kind: "stale",
        action: "needs_review",
        confidence: "medium",
        reason: "Atlas observation entries require review instead of automatic mutation.",
        safeByDefault: false,
      },
    ]);
  });

  it("is a pure snapshot classifier and does not mutate inputs", () => {
    const stable = entry({ id: "entry_stable" });
    const snapshot = {
      projectId: PROJECT_ID,
      reason: "dry-run" as const,
      now: NOW,
      entries: [stable],
      sources: [source(stable.id)],
    };
    const before = JSON.stringify(snapshot);

    const plan = classifyMaintenanceSnapshot(snapshot);

    expect(plan).toEqual({ projectId: PROJECT_ID, reason: "dry-run", items: [] });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
