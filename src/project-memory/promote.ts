import { createHash } from "node:crypto";

import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";
import { detectSecret } from "@/utils/secret-detect";
import { extractCandidates, type PromotionCandidate } from "./parser";
import type { ProjectMemoryStore } from "./store";
import type { Entity, Entry, Source, SourceKind, Status } from "./types";

export interface PromoteInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly markdown: string;
  readonly defaultEntityName: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromoteAccepted {
  readonly entryId: string;
  readonly title: string;
  readonly status: Status;
}

export interface PromoteRejected {
  readonly title: string;
  readonly reason: string;
}

export interface PromoteOutcome {
  readonly accepted: readonly PromoteAccepted[];
  readonly rejected: readonly PromoteRejected[];
  readonly refusedReason: string | null;
}

const TENTATIVE_KINDS: ReadonlySet<SourceKind> = new Set(["design", "plan", "skill"]);
const ID_HASH_CHARS = 12;
const ENTITY_ID_PREFIX = "ent";
const ENTRY_ID_PREFIX = "entry";
const SOURCE_ID_PREFIX = "src";
const ID_SEPARATOR = "\0";
const DEGRADED_IDENTITY_REASON = "degraded_identity";
const SECRET_REASON_PREFIX = "secret: ";
const PROMOTED_ENTITY_KIND = "module";
const PROMOTED_SENSITIVITY = "internal";

function digestFor(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, ID_HASH_CHARS);
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${digestFor(parts.join(ID_SEPARATOR))}`;
}

function statusFor(kind: SourceKind): Status {
  if (TENTATIVE_KINDS.has(kind)) return "tentative";
  return "active";
}

function entityIdFor(projectId: string, name: string): string {
  return `${ENTITY_ID_PREFIX}_${digestFor(`${projectId}/${name}`)}`;
}

function entryIdFor(projectId: string, entityId: string, candidate: PromotionCandidate): string {
  return stableId(ENTRY_ID_PREFIX, [projectId, entityId, candidate.entryType, candidate.title, candidate.summary]);
}

function sourceIdFor(projectId: string, entryId: string, candidate: PromotionCandidate): string {
  return stableId(SOURCE_ID_PREFIX, [projectId, entryId, candidate.sourceKind, candidate.pointer]);
}

function entitySummary(name: string): string {
  return `Project memory module for ${name}`;
}

function entityFor(projectId: string, candidate: PromotionCandidate, now: number, createdAt: number): Entity {
  return {
    projectId,
    id: entityIdFor(projectId, candidate.entityName),
    kind: PROMOTED_ENTITY_KIND,
    name: candidate.entityName,
    summary: entitySummary(candidate.entityName),
    createdAt,
    updatedAt: now,
  };
}

function entryFor(
  projectId: string,
  entityId: string,
  candidate: PromotionCandidate,
  now: number,
  createdAt: number,
): Entry {
  return {
    projectId,
    id: entryIdFor(projectId, entityId, candidate),
    entityId,
    type: candidate.entryType,
    title: candidate.title,
    summary: candidate.summary,
    status: statusFor(candidate.sourceKind),
    sensitivity: PROMOTED_SENSITIVITY,
    createdAt,
    updatedAt: now,
  };
}

function sourceFor(projectId: string, entry: Entry, candidate: PromotionCandidate, now: number): Source {
  return {
    projectId,
    id: sourceIdFor(projectId, entry.id, candidate),
    entryId: entry.id,
    kind: candidate.sourceKind,
    pointer: candidate.pointer,
    excerpt: candidate.summary,
    createdAt: now,
  };
}

function secretRejection(candidate: PromotionCandidate): PromoteRejected | null {
  const match = detectSecret(candidate.summary);
  if (!match) return null;
  return { title: candidate.title, reason: `${SECRET_REASON_PREFIX}${match.reason}` };
}

async function ensureEntity(
  store: ProjectMemoryStore,
  projectId: string,
  candidate: PromotionCandidate,
  now: number,
): Promise<string> {
  const entityId = entityIdFor(projectId, candidate.entityName);
  const existing = await store.loadEntity(projectId, entityId);
  await store.upsertEntity(entityFor(projectId, candidate, now, existing?.createdAt ?? now));
  return entityId;
}

async function upsertEntry(
  store: ProjectMemoryStore,
  projectId: string,
  entityId: string,
  candidate: PromotionCandidate,
  now: number,
): Promise<Entry> {
  const entryId = entryIdFor(projectId, entityId, candidate);
  const existing = await store.loadEntry(projectId, entryId);
  const entry = entryFor(projectId, entityId, candidate, now, existing?.createdAt ?? now);
  await store.upsertEntry(entry);
  return entry;
}

async function acceptCandidate(input: PromoteInput, candidate: PromotionCandidate): Promise<PromoteAccepted> {
  const projectId = input.identity.projectId;
  const now = Date.now();
  const entityId = await ensureEntity(input.store, projectId, candidate, now);
  const entry = await upsertEntry(input.store, projectId, entityId, candidate, now);
  await input.store.upsertSource(sourceFor(projectId, entry, candidate, now));
  return { entryId: entry.id, title: entry.title, status: entry.status };
}

export async function promoteMarkdown(input: PromoteInput): Promise<PromoteOutcome> {
  if (input.identity.kind !== "origin" && config.projectMemory.refuseWritesOnDegradedIdentity) {
    return { accepted: [], rejected: [], refusedReason: DEGRADED_IDENTITY_REASON };
  }

  const extraction = extractCandidates(input);
  const accepted: PromoteAccepted[] = [];
  const rejected: PromoteRejected[] = [];

  for (const candidate of extraction.candidates) {
    const rejection = secretRejection(candidate);
    if (rejection) {
      rejected.push(rejection);
      continue;
    }
    accepted.push(await acceptCandidate(input, candidate));
  }

  return { accepted, rejected, refusedReason: null };
}
