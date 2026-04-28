import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import {
  type PromoteAccepted,
  type PromoteOutcome,
  type PromoteRejected,
  promoteMarkdown,
  SourceKindValues,
} from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

const DESCRIPTION = `Promote markdown decisions, lessons, risks, and notes into durable project memory.

Args:
- markdown: Markdown source content to promote
- entity_name: Default project-memory entity name for extracted candidates
- source_kind: Source kind for provenance
- pointer: Stable source pointer for provenance.`;
const SUCCESS_HEADER = "## Project memory promoted";
const REFUSED_HEADER = "## Project memory promotion refused";
const ERROR_HEADER = "## Error";
const ACCEPTED_HEADER = "### Accepted";
const REJECTED_HEADER = "### Rejected";
const ACCEPTED_TABLE_HEADER = "| Entry ID | Title | Status |";
const ACCEPTED_TABLE_SEPARATOR = "| --- | --- | --- |";
const REJECTED_TABLE_HEADER = "| Title | Reason |";
const REJECTED_TABLE_SEPARATOR = "| --- | --- |";
const NO_ACCEPTED = "No accepted candidates.";
const NO_REJECTED = "No rejected candidates.";
const DEGRADED_IDENTITY_REASON = "degraded_identity";
const LINE_BREAK = "\n";

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatAcceptedRow(accepted: PromoteAccepted): string {
  return `| \`${escapeCell(accepted.entryId)}\` | ${escapeCell(accepted.title)} | ${accepted.status} |`;
}

function formatRejectedRow(rejected: PromoteRejected): string {
  return `| ${escapeCell(rejected.title)} | ${escapeCell(rejected.reason)} |`;
}

function formatAcceptedTable(accepted: readonly PromoteAccepted[]): string {
  if (accepted.length === 0) return `${ACCEPTED_HEADER}${LINE_BREAK}${LINE_BREAK}${NO_ACCEPTED}`;
  return [
    ACCEPTED_HEADER,
    "",
    ACCEPTED_TABLE_HEADER,
    ACCEPTED_TABLE_SEPARATOR,
    ...accepted.map(formatAcceptedRow),
  ].join(LINE_BREAK);
}

function formatRejectedTable(rejected: readonly PromoteRejected[]): string {
  if (rejected.length === 0) return `${REJECTED_HEADER}${LINE_BREAK}${LINE_BREAK}${NO_REJECTED}`;
  return [
    REJECTED_HEADER,
    "",
    REJECTED_TABLE_HEADER,
    REJECTED_TABLE_SEPARATOR,
    ...rejected.map(formatRejectedRow),
  ].join(LINE_BREAK);
}

function formatRefusal(reason: string): string {
  if (reason === DEGRADED_IDENTITY_REASON) {
    return `${REFUSED_HEADER}${LINE_BREAK}${LINE_BREAK}Promotion refused because degraded identity cannot write durable project memory. Configure a stable git origin first.`;
  }
  return `${REFUSED_HEADER}${LINE_BREAK}${LINE_BREAK}Promotion refused: ${escapeCell(reason)}.`;
}

function formatNote(outcome: PromoteOutcome): string {
  return `**Note**: ${outcome.accepted.length} accepted, ${outcome.rejected.length} rejected`;
}

function formatOutcome(outcome: PromoteOutcome): string {
  if (outcome.refusedReason) return formatRefusal(outcome.refusedReason);
  return [
    SUCCESS_HEADER,
    "",
    formatAcceptedTable(outcome.accepted),
    "",
    formatRejectedTable(outcome.rejected),
    "",
    formatNote(outcome),
  ].join(LINE_BREAK);
}

export function createProjectMemoryPromoteTool(ctx: PluginInput): { project_memory_promote: ToolDefinition } {
  const project_memory_promote = tool({
    description: DESCRIPTION,
    args: {
      markdown: tool.schema.string().describe("Markdown source content to promote"),
      entity_name: tool.schema.string().describe("Default entity name for extracted candidates"),
      source_kind: tool.schema.enum(SourceKindValues).describe("Source kind for promotion provenance"),
      pointer: tool.schema.string().describe("Stable source pointer for promotion provenance"),
    },
    execute: async (args) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const outcome = await promoteMarkdown({
          store,
          identity,
          markdown: args.markdown,
          defaultEntityName: args.entity_name,
          sourceKind: args.source_kind,
          pointer: args.pointer,
        });
        return formatOutcome(outcome);
      } catch (error) {
        return `${ERROR_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_promote };
}
