import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import type {
  MaintenancePlan,
  MaintenancePlanItem,
  MaintenanceReason,
  MaintenanceRunOutcome,
} from "@/project-memory/maintenance/types";
import { buildMaintenancePlan, runProjectMemoryMaintenance } from "@/project-memory/maintenance/worker";
import { extractErrorMessage } from "@/utils/errors";
import { getMaintenanceIdentity, getStore, type ProjectMemoryToolTargetArgs } from "./runtime";

const DESCRIPTION = `Run project memory maintenance for the current project.

Defaults to a manual dry-run. Passing dry_run=false applies safe maintenance actions and writes a sanitized journal entry.

Args:
- dry_run: Preview only by default; set false to apply safe archive/supersede/stale/tombstone/delete actions
- reason: manual, scheduled, or terminal; defaults to manual
- project_target/project_origin/project_alias/project_worktree/session_project_origin/lifecycle_project_origin: optional explicit project target`;

const ERROR_HEADER = "## Error";
const PLAN_HEADER = "## Project memory maintenance plan";
const APPLIED_HEADER = "## Project memory maintenance applied";
const PLAN_TABLE_HEADER = "| Entry ID | Action | Kind | Safe | Reason |";
const PLAN_TABLE_SEPARATOR = "| --- | --- | --- | --- | --- |";
const NO_PLAN_ITEMS = "No maintenance actions planned.";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";
const REASON_VALUES = ["manual", "scheduled", "terminal"] as const;
const NON_BLOCKING_ACTIONS = new Set([
  "archive",
  "supersede",
  "mark_stale",
  "tombstone",
  "hard_delete_secret",
  "deduplicate",
]);

interface ProjectMemoryMaintainArgs extends ProjectMemoryToolTargetArgs {
  readonly dry_run?: boolean;
  readonly reason?: (typeof REASON_VALUES)[number];
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatPlanRow(item: MaintenancePlanItem): string {
  return `| \`${escapeCell(item.entryId)}\` | ${item.action} | ${item.kind} | ${item.safeByDefault ? "yes" : "no"} | ${escapeCell(item.reason)} |`;
}

function formatPlanTable(plan: MaintenancePlan): string {
  if (plan.items.length === 0) return NO_PLAN_ITEMS;
  return [PLAN_TABLE_HEADER, PLAN_TABLE_SEPARATOR, ...plan.items.map(formatPlanRow)].join(LINE_BREAK);
}

function plannedUnsafeCount(plan: MaintenancePlan): number {
  return plan.items.filter((item) => !item.safeByDefault || !NON_BLOCKING_ACTIONS.has(item.action)).length;
}

function formatPlan(plan: MaintenancePlan, dryRun: boolean): string {
  return [
    PLAN_HEADER,
    `- **Project ID:** \`${plan.projectId}\``,
    `- **Reason:** ${plan.reason}`,
    `- **Dry run:** ${dryRun}`,
    `- **Planned actions:** ${plan.items.length}`,
    `- **Blocked without review:** ${plannedUnsafeCount(plan)}`,
    "",
    formatPlanTable(plan),
  ].join(LINE_BREAK);
}

function formatWarnings(warnings: readonly string[]): string {
  if (warnings.length === 0) return "- **Warnings:** None";
  return ["- **Warnings:**", ...warnings.map((warning) => `  - ${escapeCell(warning)}`)].join(LINE_BREAK);
}

function formatApplyOutcome(outcome: MaintenanceRunOutcome): string {
  return [
    APPLIED_HEADER,
    `- **Applied:** ${outcome.applied}`,
    `- **Skipped:** ${outcome.skipped}`,
    `- **Blocked:** ${outcome.blocked}`,
    `- **Journal:** \`${outcome.journalPath}\``,
    formatWarnings(outcome.warnings),
  ].join(LINE_BREAK);
}

function formatError(error: unknown): string {
  const message = extractErrorMessage(error);
  if (message.toLowerCase().includes("degraded identity")) {
    return `${ERROR_HEADER}${DOUBLE_LINE_BREAK}Maintenance refused because degraded identity cannot write durable project memory. Configure a stable git origin or pass an explicit project origin.`;
  }
  return `${ERROR_HEADER}${DOUBLE_LINE_BREAK}${message}`;
}

export function createProjectMemoryMaintainTool(ctx: PluginInput): { project_memory_maintain: ToolDefinition } {
  const project_memory_maintain = tool({
    description: DESCRIPTION,
    args: {
      dry_run: tool.schema.boolean().optional().describe("Preview only by default; set false to apply safe actions"),
      reason: tool.schema.enum(REASON_VALUES).optional().describe("Maintenance reason: manual, scheduled, or terminal"),
      project_target: tool.schema.string().optional().describe("Optional explicit project target identity"),
      project_origin: tool.schema.string().optional().describe("Optional explicit project git origin"),
      project_alias: tool.schema.string().optional().describe("Optional explicit project alias"),
      project_worktree: tool.schema.string().optional().describe("Optional explicit project worktree path"),
      session_project_origin: tool.schema.string().optional().describe("Optional session project git origin"),
      lifecycle_project_origin: tool.schema.string().optional().describe("Optional lifecycle project git origin"),
    },
    execute: async (args: ProjectMemoryMaintainArgs) => {
      try {
        const dryRun = args.dry_run ?? true;
        const reason = (args.reason ?? "manual") as MaintenanceReason;
        const identity = await getMaintenanceIdentity(ctx.directory, args);
        const store = await getStore();

        if (dryRun) {
          return formatPlan(await buildMaintenancePlan({ store, identity, reason }), dryRun);
        }

        const outcome = await runProjectMemoryMaintenance({
          projectId: identity.projectId,
          reason,
          dryRun: false,
          triggeredBy: "project_memory_maintain",
          store,
          identity,
        });
        return formatApplyOutcome(outcome);
      } catch (error) {
        return formatError(error);
      }
    },
  });

  return { project_memory_maintain };
}
