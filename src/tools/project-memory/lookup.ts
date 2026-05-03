import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { EntryTypeValues, formatLookupResults, lookup, type Status, StatusValues } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

const DEFAULT_STATUS: Status = "active";
const SENSITIVITY_CEILING_VALUES = ["public", "internal"] as const;

export function createProjectMemoryLookupTool(ctx: PluginInput): { project_memory_lookup: ToolDefinition } {
  const project_memory_lookup = tool({
    description: `Look up durable project memory entries (decisions, lessons, risks, facts, procedures) scoped to the current project.
Prefer this over reading raw thoughts/ files when you only need conclusions.`,
    args: {
      query: tool.schema.string().describe("Topic to search (e.g., 'permission cache TTL')"),
      type: tool.schema.enum(EntryTypeValues).optional().describe("Filter by entry type"),
      status: tool.schema.enum(StatusValues).optional().describe("Filter by status (default: active)"),
      sensitivity_ceiling: tool.schema
        .enum(SENSITIVITY_CEILING_VALUES)
        .optional()
        .describe("Cap returned entries at this sensitivity (public or internal)"),
      limit: tool.schema.number().optional().describe("Max results (default: 10)"),
    },
    execute: async ({ query, type, status, sensitivity_ceiling: sensitivityCeiling, limit }) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const lookupInput = {
          store,
          identity,
          query,
          type,
          status: status ?? DEFAULT_STATUS,
          sensitivityCeiling,
          limit,
        };
        const hits = await lookup(lookupInput);
        return formatLookupResults(query, hits);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_lookup };
}
