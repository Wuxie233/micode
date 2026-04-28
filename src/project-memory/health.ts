import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore } from "./store";
import type { HealthReport } from "./types";

const STALE_DAYS = 90;
const MS_PER_DAY = 86_400_000;
const STALE_WINDOW_MS = STALE_DAYS * MS_PER_DAY;
const DEGRADED_IDENTITY_WARNING = "identity_degraded: origin not resolved";

function identityWarnings(identity: ProjectIdentity): readonly string[] {
  if (identity.kind === "origin") return [];
  return [DEGRADED_IDENTITY_WARNING];
}

export async function buildHealthReport(store: ProjectMemoryStore, identity: ProjectIdentity): Promise<HealthReport> {
  const projectId = identity.projectId;
  const [entityCount, entryCount, entriesByStatus, staleEntryCount, missingSourceCount] = await Promise.all([
    store.countEntities(projectId),
    store.countEntries(projectId),
    store.countEntriesByStatus(projectId),
    store.countStaleEntries(projectId, STALE_WINDOW_MS),
    store.countMissingSources(projectId),
  ]);

  return {
    projectId,
    identityKind: identity.kind,
    entityCount,
    entryCount,
    entriesByStatus,
    staleEntryCount,
    missingSourceCount,
    recentUpdates: entryCount - staleEntryCount,
    warnings: identityWarnings(identity),
  };
}
