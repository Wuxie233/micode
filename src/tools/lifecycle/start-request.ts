import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { LIFECYCLE_STATES, type LifecycleHandle, type LifecycleRecord } from "@/lifecycle";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Start an issue-driven lifecycle request.

Calls the lifecycle handle to create the GitHub issue, branch, and worktree, then returns the lifecycle summary.`;

const PREFLIGHT_CATEGORY = "pre_flight_failed";
const ISSUES_DISABLED_CATEGORY = "issues_disabled_upstream";
const WORKTREE_CONFLICT_CATEGORY = "worktree_conflict";
const PREFLIGHT_HEADER = "## Lifecycle pre-flight failed";
const ISSUES_DISABLED_HEADER = "## Lifecycle aborted: issues disabled on upstream";
const WORKTREE_CONFLICT_HEADER = "## Worktree conflict";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "|---|---|---|---|";

const formatRecordRow = (record: LifecycleRecord): string => {
  return `| ${record.issueNumber} | \`${record.branch}\` | \`${record.worktree}\` | \`${record.state}\` |`;
};

const formatRecordTable = (record: LifecycleRecord): string => {
  return [TABLE_HEADER, TABLE_SEPARATOR, formatRecordRow(record)].join(LINE_BREAK);
};

const formatNotes = (notes: readonly string[]): string => {
  if (notes.length === 0) return "";
  return `${notes.join(LINE_BREAK)}${DOUBLE_LINE_BREAK}`;
};

const headerFor = (record: LifecycleRecord): string => {
  const note = record.notes[0] ?? "";
  if (note.startsWith(ISSUES_DISABLED_CATEGORY)) return ISSUES_DISABLED_HEADER;
  if (note.startsWith(WORKTREE_CONFLICT_CATEGORY)) return WORKTREE_CONFLICT_HEADER;
  return PREFLIGHT_HEADER;
};

const formatRecord = (record: LifecycleRecord): string => {
  const table = formatRecordTable(record);
  if (record.state !== LIFECYCLE_STATES.ABORTED) return table;
  return `${headerFor(record)}${DOUBLE_LINE_BREAK}${formatNotes(record.notes)}${table}`;
};

const formatThrown = (error: unknown): string => {
  const message = extractErrorMessage(error);
  if (message.startsWith(ISSUES_DISABLED_CATEGORY)) return `${ISSUES_DISABLED_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  if (message.startsWith(WORKTREE_CONFLICT_CATEGORY))
    return `${WORKTREE_CONFLICT_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  if (message.startsWith(PREFLIGHT_CATEGORY)) return `${PREFLIGHT_HEADER}${DOUBLE_LINE_BREAK}${message}`;
  throw error;
};

export function createLifecycleStartRequestTool(handle: LifecycleHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      summary: tool.schema.string().describe("Short request summary used as the issue title"),
      goals: tool.schema.array(tool.schema.string()).describe("Goals the lifecycle request should accomplish"),
      constraints: tool.schema.array(tool.schema.string()).describe("Constraints that must be respected"),
    },
    execute: async ({ summary, goals, constraints }) => {
      try {
        const record = await handle.start({
          summary,
          goals,
          constraints,
        });
        return formatRecord(record);
      } catch (error) {
        return formatThrown(error);
      }
    },
  });
}
