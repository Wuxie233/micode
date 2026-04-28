import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { EntryTypeValues, formatLookupResults, lookup, type Status, StatusValues } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

const DEFAULT_STATUS: Status = "active";

export function createProjectMemoryLookupTool(ctx: PluginInput): { project_memory_lookup: ToolDefinition } {
  const project_memory_lookup = tool({
    description: `Look up durable project memory entries (decisions, lessons, risks, facts) scoped to the current project.
Prefer this over reading raw thoughts/ files when you only need conclusions.`,
    args: {
      query: tool.schema.string().describe("Topic to search (e.g., 'permission cache TTL')"),
      type: tool.schema.enum(EntryTypeValues).optional().describe("Filter by entry type"),
      status: tool.schema.enum(StatusValues).optional().describe("Filter by status (default: active)"),
      limit: tool.schema.number().optional().describe("Max results (default: 10)"),
    },
    execute: async ({ query, type, status, limit }) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const hits = await lookup({
          store,
          identity,
          query,
          type,
          status: status ?? DEFAULT_STATUS,
          limit,
        });
        return formatLookupResults(query, hits);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_lookup };
}
