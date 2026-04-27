import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";

import { config } from "@/utils/config";
import { createPreservedRegistry, type PreservedRegistry } from "./registry";
import { createSpawnAgentTool as createSpawnAgentToolWithOptions, type SpawnAgentToolOptions } from "./tool";

export type { SpawnAgentToolOptions } from "./tool";
export { buildAgentsSchema, buildArgsShape } from "./tool";

function createDefaultRegistry(): PreservedRegistry {
  return createPreservedRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
  });
}

export function createSpawnAgentTool(ctx: PluginInput, options?: SpawnAgentToolOptions): ToolDefinition {
  return createSpawnAgentToolWithOptions(ctx, options ?? { registry: createDefaultRegistry() });
}
