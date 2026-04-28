import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { buildHealthReport, type HealthReport, StatusValues } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

const DESCRIPTION = `Report project memory health for the current project.

Returns entity and entry counts, entries by status, stale entries, missing sources, recent updates, and identity warnings.`;
const HEALTH_HEADER = "## Project Memory Health";
const STATUS_HEADER = "### Entries by status";
const WARNINGS_HEADER = "### Identity warnings";
const ERROR_HEADER = "## Error";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";
const NO_WARNINGS = "- None";

function formatSummary(report: HealthReport): string {
  return [
    `- **Project ID:** \`${report.projectId}\``,
    `- **Identity:** \`${report.identityKind}\``,
    `- **Entities:** ${report.entityCount}`,
    `- **Entries:** ${report.entryCount}`,
    `- **Stale entries:** ${report.staleEntryCount}`,
    `- **Missing sources:** ${report.missingSourceCount}`,
    `- **Recent updates:** ${report.recentUpdates}`,
  ].join(LINE_BREAK);
}

function formatStatuses(report: HealthReport): string {
  return StatusValues.map((status) => `- **${status}:** ${report.entriesByStatus[status]}`).join(LINE_BREAK);
}

function formatWarnings(report: HealthReport): string {
  if (report.warnings.length === 0) return NO_WARNINGS;
  return report.warnings.map((warning) => `- ${warning}`).join(LINE_BREAK);
}

function formatHealthReport(report: HealthReport): string {
  return [
    HEALTH_HEADER,
    formatSummary(report),
    STATUS_HEADER,
    formatStatuses(report),
    WARNINGS_HEADER,
    formatWarnings(report),
  ].join(DOUBLE_LINE_BREAK);
}

export function createProjectMemoryHealthTool(ctx: PluginInput): { project_memory_health: ToolDefinition } {
  const project_memory_health = tool({
    description: DESCRIPTION,
    args: {},
    execute: async () => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const report = await buildHealthReport(store, identity);
        return formatHealthReport(report);
      } catch (error) {
        return `${ERROR_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_health };
}
