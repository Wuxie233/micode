import {
  getDefaultStore,
  type ProjectMemoryStore,
  resetDefaultProjectMemoryStoreForTest,
  setDefaultProjectMemoryStoreForTest,
} from "@/project-memory";
import { createProjectRegistry, type ProjectRegistryRecord } from "@/project-memory/registry";
import {
  isDegradedProjectIdentity,
  normalizeProjectOrigin,
  type ProjectIdentity,
  projectIdForSource,
  resolveProjectId,
} from "@/utils/project-id";

export interface ProjectMemoryToolTargetArgs {
  readonly project_target?: string;
  readonly project_origin?: string;
  readonly project_alias?: string;
  readonly project_worktree?: string;
  readonly session_project_origin?: string;
  readonly lifecycle_project_origin?: string;
}

type IdentityMode = "read" | "write" | "maintenance";

const FIELD_PRIORITY = [
  "project_origin",
  "project_target",
  "project_alias",
  "project_worktree",
  "session_project_origin",
  "lifecycle_project_origin",
] as const;

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function identityForOrigin(origin: string): ProjectIdentity {
  const source = normalizeProjectOrigin(origin);
  return { projectId: projectIdForSource(source), kind: "origin", source };
}

function identityForRecord(record: ProjectRegistryRecord): ProjectIdentity {
  if (record.origin) return identityForOrigin(record.origin);
  return { projectId: record.projectId, kind: "origin", source: record.projectId };
}

function identityKey(identity: ProjectIdentity): string {
  return `${identity.projectId}\0${identity.kind}\0${identity.source}`;
}

function describeTarget(field: string, value: string): string {
  return `${field}=${value}`;
}

function uniqueTargetCount(candidates: readonly { readonly identity: ProjectIdentity }[]): number {
  return new Set(candidates.map((candidate) => identityKey(candidate.identity))).size;
}

function describeCandidates(candidates: readonly { readonly field: string; readonly value: string }[]): string {
  return candidates.map((candidate) => describeTarget(candidate.field, candidate.value)).join(", ");
}

async function findRegistryIdentity(field: string, value: string): Promise<ProjectIdentity | null> {
  const registry = createProjectRegistry();
  const matches =
    field === "project_alias" || field === "project_target"
      ? await registry.findByAlias(value)
      : await registry.findByWorktree(value);

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`ambiguous project target: ${describeTarget(field, value)} matched ${matches.length} projects`);
  }
  return identityForRecord(matches[0]);
}

async function resolveCandidate(field: (typeof FIELD_PRIORITY)[number], value: string): Promise<ProjectIdentity> {
  if (field === "project_alias" || field === "project_worktree") {
    const registryMatch = await findRegistryIdentity(field, value);
    if (!registryMatch) {
      throw new Error(`unknown project target: ${describeTarget(field, value)} did not match registry`);
    }
    return registryMatch;
  }

  if (field === "project_target") {
    const registryMatch = await findRegistryIdentity(field, value);
    return registryMatch ?? identityForOrigin(value);
  }

  return identityForOrigin(value);
}

async function resolveTargetIdentity(args: ProjectMemoryToolTargetArgs | undefined): Promise<ProjectIdentity | null> {
  if (!args) return null;

  const candidates: { readonly field: string; readonly value: string; readonly identity: ProjectIdentity }[] = [];

  for (const field of FIELD_PRIORITY) {
    const value = nonEmpty(args[field]);
    if (!value) continue;

    candidates.push({ field, value, identity: await resolveCandidate(field, value) });
  }

  if (candidates.length === 0) return null;

  if (uniqueTargetCount(candidates) > 1) {
    throw new Error(`ambiguous project target: ${describeCandidates(candidates)} resolved to multiple projects`);
  }

  return candidates[0].identity;
}

async function getIdentityForMode(
  directory: string,
  args: ProjectMemoryToolTargetArgs | undefined,
  mode: IdentityMode,
): Promise<ProjectIdentity> {
  const identity = (await resolveTargetIdentity(args)) ?? (await resolveProjectId(directory));
  if (mode !== "read" && isDegradedProjectIdentity(identity)) {
    throw new Error("degraded identity cannot write durable project memory. Configure a stable git origin first.");
  }
  return identity;
}

export async function getStore(): Promise<ProjectMemoryStore> {
  return getDefaultStore();
}

export async function getReadIdentity(directory: string, args?: ProjectMemoryToolTargetArgs): Promise<ProjectIdentity> {
  return getIdentityForMode(directory, args, "read");
}

export async function getWriteIdentity(
  directory: string,
  args?: ProjectMemoryToolTargetArgs,
): Promise<ProjectIdentity> {
  return getIdentityForMode(directory, args, "write");
}

export async function getMaintenanceIdentity(
  directory: string,
  args?: ProjectMemoryToolTargetArgs,
): Promise<ProjectIdentity> {
  return getIdentityForMode(directory, args, "maintenance");
}

export async function getIdentity(directory: string): Promise<ProjectIdentity> {
  return getReadIdentity(directory);
}

export function setProjectMemoryStoreForTest(memory: ProjectMemoryStore | null): void {
  setDefaultProjectMemoryStoreForTest(memory);
}

export async function resetProjectMemoryRuntimeForTest(): Promise<void> {
  await resetDefaultProjectMemoryStoreForTest();
}
