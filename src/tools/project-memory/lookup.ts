import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { EntryTypeValues, formatLookupResults, lookup, type Status, StatusValues } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getReadIdentity, getStore, type ProjectMemoryToolTargetArgs } from "./runtime";

const SENSITIVITY_CEILING_VALUES = ["public", "internal"] as const;

interface ProjectMemoryLookupArgs extends ProjectMemoryToolTargetArgs {
  readonly query: string;
  readonly type?: (typeof EntryTypeValues)[number];
  readonly status?: Status;
  readonly sensitivity_ceiling?: (typeof SENSITIVITY_CEILING_VALUES)[number];
  readonly limit?: number;
}

const lookupArgs = {
  query: tool.schema.string().describe("Topic to search (e.g., 'permission cache TTL')"),
  type: tool.schema.enum(EntryTypeValues).optional().describe("Filter by entry type"),
  status: tool.schema
    .enum(StatusValues)
    .optional()
    .describe("Filter by status (default: active; archived/tombstoned/deprecated/superseded require explicit status)"),
  sensitivity_ceiling: tool.schema
    .enum(SENSITIVITY_CEILING_VALUES)
    .optional()
    .describe("Cap returned entries at this sensitivity (public or internal)"),
  limit: tool.schema.number().optional().describe("Max results (default: 10)"),
  project_target: tool.schema.string().optional().describe("Optional explicit project target identity"),
  project_origin: tool.schema.string().optional().describe("Optional explicit project git origin"),
  project_alias: tool.schema.string().optional().describe("Optional explicit project alias"),
  project_worktree: tool.schema.string().optional().describe("Optional explicit project worktree path"),
  session_project_origin: tool.schema.string().optional().describe("Optional session project git origin"),
  lifecycle_project_origin: tool.schema.string().optional().describe("Optional lifecycle project git origin"),
};

async function executeLookup(ctx: PluginInput, args: ProjectMemoryLookupArgs): Promise<string> {
  const store = await getStore();
  const identity = await getReadIdentity(ctx.directory, args);
  const hits = await lookup({
    store,
    identity,
    query: args.query,
    type: args.type,
    status: args.status,
    sensitivityCeiling: args.sensitivity_ceiling,
    limit: args.limit,
  });
  return formatLookupResults(args.query, hits);
}

export function createProjectMemoryLookupTool(ctx: PluginInput): { project_memory_lookup: ToolDefinition } {
  const project_memory_lookup = tool({
    description: `Look up durable project memory entries (decisions, lessons, risks, facts, procedures) scoped to the current project.
Prefer this over reading raw thoughts/ files when you only need conclusions.
Defaults to active entries only; archived, tombstoned, deprecated, and superseded entries require an explicit status filter.`,
    args: lookupArgs,
    execute: async (args) => {
      try {
        return await executeLookup(ctx, args as ProjectMemoryLookupArgs);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_lookup };
}
