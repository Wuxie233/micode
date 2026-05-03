import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore, SearchHit } from "./store";
import type { EntryType, LookupHit, Status } from "./types";

export interface LookupInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly query: string;
  readonly type?: EntryType;
  readonly status?: Status;
  readonly entityId?: string;
  readonly sensitivityCeiling?: "public" | "internal";
  readonly limit?: number;
}

const ELLIPSIS = "…";
const STATUS_RANK: Record<Status, number> = {
  active: 0,
  tentative: 1,
  hypothesis: 2,
  superseded: 3,
  deprecated: 4,
};

function trimSnippet(summary: string): string {
  const max = config.projectMemory.snippetMaxChars;
  if (summary.length <= max) return summary;
  return `${summary.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

function isLookupHit(hit: LookupHit | null): hit is LookupHit {
  return hit !== null;
}

function compareHits(left: LookupHit, right: LookupHit): number {
  const statusDelta = STATUS_RANK[left.entry.status] - STATUS_RANK[right.entry.status];
  if (statusDelta !== 0) return statusDelta;

  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;

  return right.entry.updatedAt - left.entry.updatedAt;
}

async function loadHit(store: ProjectMemoryStore, projectId: string, hit: SearchHit): Promise<LookupHit | null> {
  const [entity, sources] = await Promise.all([
    store.loadEntity(projectId, hit.entry.entityId),
    store.loadSourcesForEntry(projectId, hit.entry.id),
  ]);

  if (!entity) return null;

  return {
    entry: hit.entry,
    entity,
    sources,
    snippet: trimSnippet(hit.entry.summary),
    score: hit.score,
    degraded: sources.length === 0,
  };
}

export async function lookup(input: LookupInput): Promise<readonly LookupHit[]> {
  const limit = input.limit ?? config.projectMemory.defaultLookupLimit;
  const hits = await input.store.searchEntries(input.identity.projectId, input.query, {
    type: input.type,
    status: input.status,
    entityId: input.entityId,
    sensitivityCeiling: input.sensitivityCeiling,
    limit,
  });
  const loaded = await Promise.all(hits.map((hit) => loadHit(input.store, input.identity.projectId, hit)));
  return loaded.filter(isLookupHit).sort(compareHits);
}
