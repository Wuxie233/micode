import type { MaintenancePlan, MaintenancePlanItem, MaintenanceReason } from "@/project-memory/maintenance/types";
import type { Entry, Source } from "@/project-memory/types";
import { detectSecret } from "@/utils/secret-detect";

const MS_PER_DAY = 86_400_000;
const STALE_DAYS = 90;
const REVIEW_TYPES = new Set<Entry["type"]>(["decision", "risk"]);
const LOW_SIGNAL_MISSING_SOURCE_TYPES = new Set<Entry["type"]>(["note", "todo"]);

export const DEFAULT_MAINTENANCE_STALE_AFTER_MS = STALE_DAYS * MS_PER_DAY;

export interface MaintenanceSnapshot {
  readonly projectId: string;
  readonly reason: MaintenanceReason;
  readonly now?: number;
  readonly staleAfterMs?: number;
  readonly entries: readonly Entry[];
  readonly sources: readonly Source[];
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function duplicateKey(entry: Entry): string {
  return [entry.entityId, entry.type, normalizeText(entry.title), normalizeText(entry.summary)].join("\0");
}

function newerEntryFirst(left: Entry, right: Entry): number {
  return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || right.id.localeCompare(left.id);
}

function duplicateEntryIds(entries: readonly Entry[]): ReadonlySet<string> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = duplicateKey(entry);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }

  const duplicateIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const [, ...olderEntries] = [...group].sort(newerEntryFirst);
    for (const entry of olderEntries) duplicateIds.add(entry.id);
  }
  return duplicateIds;
}

function sourceEntryIds(sources: readonly Source[]): ReadonlySet<string> {
  return new Set(sources.map((source) => source.entryId));
}

function isOlderThan(entry: Entry, now: number, staleAfterMs: number): boolean {
  return now - entry.updatedAt > staleAfterMs;
}

function containsSecret(entry: Entry): boolean {
  return detectSecret(`${entry.title}\n${entry.summary}`) !== null;
}

function isAtlasObservation(entry: Entry): boolean {
  const text = `${entry.title}\n${entry.summary}`.toLowerCase();
  return text.includes("atlas observation:");
}

function planSecretDeletion(entry: Entry): MaintenancePlanItem {
  return {
    entryId: entry.id,
    kind: "potential_secret",
    action: "hard_delete_secret",
    confidence: "high",
    reason: "Entry title/summary matched secret detector; value intentionally omitted.",
    safeByDefault: true,
  };
}

function planAtlasReview(entry: Entry): MaintenancePlanItem {
  return {
    entryId: entry.id,
    kind: "stale",
    action: "needs_review",
    confidence: "medium",
    reason: "Atlas observation entries require review instead of automatic mutation.",
    safeByDefault: false,
  };
}

function planDuplicateSupersede(entry: Entry): MaintenancePlanItem {
  return {
    entryId: entry.id,
    kind: "duplicate",
    action: "supersede",
    confidence: "high",
    reason: "Exact duplicate of a newer entry in the same entity/type/title/summary group.",
    safeByDefault: true,
  };
}

function planHistoricalArchive(entry: Entry): MaintenancePlanItem | null {
  if (entry.status === "deprecated") {
    return {
      entryId: entry.id,
      kind: "deprecated",
      action: "archive",
      confidence: "high",
      reason: "Deprecated entry is older than the maintenance stale threshold.",
      safeByDefault: true,
    };
  }

  if (entry.status === "superseded") {
    return {
      entryId: entry.id,
      kind: "superseded",
      action: "archive",
      confidence: "high",
      reason: "Superseded entry is older than the maintenance stale threshold.",
      safeByDefault: true,
    };
  }

  return null;
}

function planMissingSource(entry: Entry): MaintenancePlanItem | null {
  if (LOW_SIGNAL_MISSING_SOURCE_TYPES.has(entry.type)) {
    return {
      entryId: entry.id,
      kind: "missing_source",
      action: "archive",
      confidence: "low",
      reason: "Low-signal note/todo entry has no source pointer.",
      safeByDefault: true,
    };
  }

  if (REVIEW_TYPES.has(entry.type)) {
    return {
      entryId: entry.id,
      kind: "missing_source",
      action: "needs_review",
      confidence: "medium",
      reason: "Decision/risk entry has no source pointer and must not be deleted automatically.",
      safeByDefault: false,
    };
  }

  return {
    entryId: entry.id,
    kind: "missing_source",
    action: "mark_stale",
    confidence: "low",
    reason: "Entry has no source pointer; mark stale instead of deleting.",
    safeByDefault: true,
  };
}

function planOldActive(entry: Entry): MaintenancePlanItem | null {
  if (entry.status !== "active") return null;

  if (REVIEW_TYPES.has(entry.type)) {
    return {
      entryId: entry.id,
      kind: "stale",
      action: "needs_review",
      confidence: "medium",
      reason: "Old active decision/risk needs human review before staling.",
      safeByDefault: false,
    };
  }

  return {
    entryId: entry.id,
    kind: "stale",
    action: "mark_stale",
    confidence: "medium",
    reason: "Active entry is older than the maintenance stale threshold.",
    safeByDefault: true,
  };
}

function classifyEntry(
  entry: Entry,
  context: {
    readonly duplicateIds: ReadonlySet<string>;
    readonly sourceIds: ReadonlySet<string>;
    readonly now: number;
    readonly staleAfterMs: number;
  },
): MaintenancePlanItem | null {
  if (containsSecret(entry)) return planSecretDeletion(entry);
  if (isAtlasObservation(entry)) return planAtlasReview(entry);
  if (context.duplicateIds.has(entry.id)) return planDuplicateSupersede(entry);
  if (entry.status === "archived" || entry.status === "tombstoned" || entry.status === "stale") return null;

  const old = isOlderThan(entry, context.now, context.staleAfterMs);
  if (old) {
    const historicalArchive = planHistoricalArchive(entry);
    if (historicalArchive) return historicalArchive;
  }

  if (!context.sourceIds.has(entry.id)) return planMissingSource(entry);
  if (old) return planOldActive(entry);
  return null;
}

export function classifyMaintenanceSnapshot(snapshot: MaintenanceSnapshot): MaintenancePlan {
  const now = snapshot.now ?? Date.now();
  const staleAfterMs = snapshot.staleAfterMs ?? DEFAULT_MAINTENANCE_STALE_AFTER_MS;
  const duplicateIds = duplicateEntryIds(snapshot.entries);
  const sourceIds = sourceEntryIds(snapshot.sources);
  const items = snapshot.entries
    .map((entry) => classifyEntry(entry, { duplicateIds, sourceIds, now, staleAfterMs }))
    .filter((item): item is MaintenancePlanItem => item !== null);

  return {
    projectId: snapshot.projectId,
    reason: snapshot.reason,
    items,
  };
}
