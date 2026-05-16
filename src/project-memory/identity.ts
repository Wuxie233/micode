import { createProjectRegistry, type ProjectRegistry, type ProjectRegistryRecord } from "@/project-memory/registry";
import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";
import { normalizeProjectOrigin, projectIdForSource, resolveProjectId } from "@/utils/project-id";

type TargetSource = "explicit" | "session" | "lifecycle";
type ResolutionSource = TargetSource | "registry" | "directory" | "degraded";
type ResolutionStatus = "resolved" | "degraded" | "ambiguous" | "blocked";

export interface ProjectMemoryTarget {
  readonly projectId?: string;
  readonly origin?: string;
  readonly alias?: string;
  readonly worktree?: string;
}

export interface ProjectMemoryIdentityContext {
  readonly directory: string;
  readonly explicitTarget?: ProjectMemoryTarget;
  readonly sessionTarget?: ProjectMemoryTarget;
  readonly lifecycleTarget?: ProjectMemoryTarget;
  readonly registry?: ProjectRegistry;
}

export interface ProjectMemoryIdentityCandidate {
  readonly projectId: string;
  readonly origin?: string;
  readonly aliases?: readonly string[];
  readonly worktrees?: readonly string[];
}

export interface ProjectMemoryIdentityResolution {
  readonly status: ResolutionStatus;
  readonly source: ResolutionSource;
  readonly identity?: ProjectIdentity;
  readonly candidates?: readonly ProjectMemoryIdentityCandidate[];
  readonly reason?: string;
}

interface SourceTarget {
  readonly source: TargetSource;
  readonly target: ProjectMemoryTarget;
}

function hasTargetValue(target: ProjectMemoryTarget): boolean {
  return Boolean(target.projectId ?? target.origin ?? target.alias ?? target.worktree);
}

function identityForProjectId(projectId: string): ProjectIdentity | null {
  const trimmed = projectId.trim();
  if (trimmed.length === 0) return null;
  return { projectId: trimmed, kind: "origin", source: `project:${trimmed}` };
}

function identityForOrigin(origin: string): ProjectIdentity | null {
  const normalized = normalizeProjectOrigin(origin);
  if (normalized.length === 0) return null;
  return { projectId: projectIdForSource(normalized), kind: "origin", source: normalized };
}

function candidateForRecord(record: ProjectRegistryRecord): ProjectMemoryIdentityCandidate {
  return {
    projectId: record.projectId,
    origin: record.origin,
    aliases: record.aliases,
    worktrees: record.worktrees,
  };
}

function identityForRecord(record: ProjectRegistryRecord): ProjectIdentity {
  if (record.origin) return { projectId: record.projectId, kind: "origin", source: record.origin };
  return { projectId: record.projectId, kind: "path", source: record.worktrees[0] ?? `registry:${record.projectId}` };
}

function resolved(identity: ProjectIdentity, source: ResolutionSource): ProjectMemoryIdentityResolution {
  return { status: "resolved", source, identity };
}

function blocked(source: ResolutionSource, reason: string): ProjectMemoryIdentityResolution {
  return { status: "blocked", source, reason };
}

function ambiguous(
  source: ResolutionSource,
  matches: readonly ProjectRegistryRecord[],
): ProjectMemoryIdentityResolution {
  return {
    status: "ambiguous",
    source,
    candidates: matches.map(candidateForRecord),
    reason: "project identity is ambiguous; specify projectId or a unique alias/origin/worktree",
  };
}

function registrySourceFor(source: TargetSource): ResolutionSource {
  return source === "explicit" ? source : "registry";
}

function unmatchedExplicitTarget(target: ProjectMemoryTarget): boolean {
  return Boolean(target.alias ?? target.worktree);
}

async function registryMatches(
  registry: ProjectRegistry,
  target: ProjectMemoryTarget,
): Promise<readonly ProjectRegistryRecord[]> {
  if (target.alias) return registry.findByAlias(target.alias);
  if (target.origin) return registry.findByOrigin(target.origin);
  if (target.worktree) return registry.findByWorktree(target.worktree);
  return [];
}

async function resolveTarget(
  registry: ProjectRegistry,
  sourceTarget: SourceTarget,
): Promise<ProjectMemoryIdentityResolution | null> {
  const { source, target } = sourceTarget;
  const byProjectId = target.projectId ? identityForProjectId(target.projectId) : null;
  if (byProjectId) return resolved(byProjectId, source);

  const byOrigin = target.origin ? identityForOrigin(target.origin) : null;
  if (byOrigin && !target.alias && !target.worktree) return resolved(byOrigin, source);

  const matches = await registryMatches(registry, target);
  const registrySource = registrySourceFor(source);
  if (matches.length === 1) return resolved(identityForRecord(matches[0]), registrySource);
  if (matches.length > 1) return ambiguous(registrySource, matches);
  if (source !== "explicit") return null;

  if (unmatchedExplicitTarget(target)) {
    return blocked(source, "explicit alias/worktree did not match any project registry record");
  }
  if (byOrigin) return resolved(byOrigin, source);
  return null;
}

function sourceTargets(context: ProjectMemoryIdentityContext): readonly SourceTarget[] {
  const targets: SourceTarget[] = [];
  if (context.explicitTarget && hasTargetValue(context.explicitTarget)) {
    targets.push({ source: "explicit", target: context.explicitTarget });
  }
  if (context.sessionTarget && hasTargetValue(context.sessionTarget)) {
    targets.push({ source: "session", target: context.sessionTarget });
  }
  if (context.lifecycleTarget && hasTargetValue(context.lifecycleTarget)) {
    targets.push({ source: "lifecycle", target: context.lifecycleTarget });
  }
  return targets;
}

async function resolveRegistryDirectory(
  registry: ProjectRegistry,
  directory: string,
): Promise<ProjectMemoryIdentityResolution | null> {
  const matches = await registry.findByWorktree(directory);
  if (matches.length === 1) return resolved(identityForRecord(matches[0]), "registry");
  if (matches.length > 1) return ambiguous("registry", matches);
  return null;
}

function directoryResolution(identity: ProjectIdentity): ProjectMemoryIdentityResolution {
  if (identity.kind === "origin") return resolved(identity, "directory");
  return {
    status: "degraded",
    source: "degraded",
    identity,
    reason: "project identity resolved from path only; origin not resolved",
  };
}

export async function resolveProjectMemoryIdentity(
  context: ProjectMemoryIdentityContext,
): Promise<ProjectMemoryIdentityResolution> {
  const registry = context.registry ?? createProjectRegistry();

  for (const sourceTarget of sourceTargets(context)) {
    const resolution = await resolveTarget(registry, sourceTarget);
    if (resolution) return resolution;
  }

  const registryResolution = await resolveRegistryDirectory(registry, context.directory);
  if (registryResolution) return registryResolution;

  return directoryResolution(await resolveProjectId(context.directory));
}

function assertProjectIdentity(resolution: ProjectMemoryIdentityResolution, operation: string): ProjectIdentity {
  if (!resolution.identity) {
    const detail = resolution.reason ? `: ${resolution.reason}` : "";
    throw new Error(`Project memory ${operation} requires a resolved project identity; ${resolution.status}${detail}`);
  }
  if (resolution.status === "ambiguous" || resolution.status === "blocked") {
    const detail = resolution.reason ? `: ${resolution.reason}` : "";
    throw new Error(
      `Project memory ${operation} requires an unambiguous project identity; ${resolution.status}${detail}`,
    );
  }
  if (resolution.identity.kind !== "origin" && config.projectMemory.refuseWritesOnDegradedIdentity) {
    throw new Error(`Project memory ${operation} refused: degraded path-only project identity is unsafe for writes`);
  }
  return resolution.identity;
}

export function assertWritableProjectIdentity(resolution: ProjectMemoryIdentityResolution): ProjectIdentity {
  return assertProjectIdentity(resolution, "write");
}

export function assertMaintenanceProjectIdentity(resolution: ProjectMemoryIdentityResolution): ProjectIdentity {
  return assertProjectIdentity(resolution, "maintenance");
}
