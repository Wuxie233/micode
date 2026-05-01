import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { config } from "@/utils/config";
import { createPreservedRegistryOver, getSpawnRegistryForPreservedRegistry, type PreservedRegistry } from "./registry";
import { createSpawnSessionRegistry, type SpawnSessionRegistry } from "./spawn-session-registry";
import { createSpawnAgentTool as createSpawnAgentToolWithOptions, type SpawnAgentToolOptions } from "./tool";
import { type VerifierDeps, verifyMarker } from "./verifier";

export type { SpawnAgentToolOptions } from "./tool";
export { buildAgentsSchema, buildArgsShape } from "./tool";

function createDefaultSpawnRegistry(): SpawnSessionRegistry {
  return createSpawnSessionRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
    runningTtlMs: config.subagent.spawnRegistryRunningTtlMs,
  });
}

function createDefaultRegistryOver(spawn: SpawnSessionRegistry): PreservedRegistry {
  return createPreservedRegistryOver(spawn, {
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
  });
}

interface CreateOptions extends Partial<SpawnAgentToolOptions> {
  readonly spawnRegistry?: SpawnSessionRegistry;
  readonly verifier?: SpawnAgentToolOptions["verifier"];
}

function buildVerifier(ctx: PluginInput): SpawnAgentToolOptions["verifier"] {
  if (!config.subagent.markerVerification.enabled) return undefined;
  const deps: Omit<VerifierDeps, "runClassification"> = {
    timeoutMs: config.subagent.markerVerification.timeoutMs,
    maxOutputChars: config.subagent.markerVerification.maxOutputChars,
  };
  return async (input) => {
    const runner = createVerifierRunner(ctx);
    return verifyMarker(input, { ...deps, runClassification: runner });
  };
}

function createVerifierRunner(ctx: PluginInput): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    void ctx;
    void prompt;
    return "";
  };
}

function resolveCreateOptions(ctx: PluginInput, options?: CreateOptions): SpawnAgentToolOptions {
  const backedSpawn = options?.registry ? getSpawnRegistryForPreservedRegistry(options.registry) : null;
  const spawnRegistry = options?.spawnRegistry ?? backedSpawn ?? createDefaultSpawnRegistry();
  const registry = options?.registry ?? createDefaultRegistryOver(spawnRegistry);
  const verifier = options?.verifier ?? buildVerifier(ctx);
  const resolved = { ...options, registry, spawnRegistry };
  if (!verifier) return resolved;
  return { ...resolved, verifier };
}

export function createSpawnAgentTool(ctx: PluginInput, options?: CreateOptions): ToolDefinition {
  return createSpawnAgentToolWithOptions(ctx, resolveCreateOptions(ctx, options));
}

export type { PreservedRegistry } from "./registry";
export { createPreservedRegistry, createPreservedRegistryOver } from "./registry";
export type { SpawnSessionRegistry } from "./spawn-session-registry";
export { createSpawnSessionRegistry } from "./spawn-session-registry";
