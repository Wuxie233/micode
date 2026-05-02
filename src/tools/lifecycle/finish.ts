import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { FinishInput, FinishOutcome, LifecycleHandle } from "@/lifecycle";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

export type LifecycleFinishHandle = Pick<LifecycleHandle, "finish">;

const MERGE_STRATEGIES = ["auto", "pr", "local-merge"] as const;
export type LifecycleToolMergeStrategy = (typeof MERGE_STRATEGIES)[number];

const DESCRIPTION = `Finish lifecycle work for an issue.

Args:
- issue_number: GitHub issue number for the lifecycle record
- merge_strategy: Optional merge mode. Defaults to config.lifecycle.mergeStrategy.
- wait_for_checks: Optional PR check wait override. Defaults to true.`;
const SUCCESS_HEADER = "## Lifecycle finished";
const FAILURE_HEADER = "## Lifecycle finish failed";
const BLOCKED_HEADER = "## Lifecycle blocked";
const CHECKS_FAILED_HEADER = "## PR checks failed";
const EXECUTOR_BLOCKED_NOTE = "executor_blocked";
const PR_CHECKS_FAILED_NOTE = "pr_checks_failed";
const TABLE_HEADER = "| Issue # | PR URL | Closed At |";
const TABLE_SEPARATOR = "| --- | --- | --- |";
const MISSING_VALUE = "-";
const LINE_BREAK = "\n";
const DEFAULT_WAIT_FOR_CHECKS = true;

const formatPrUrl = (prUrl: string | null): string => {
  if (prUrl === null) return MISSING_VALUE;
  return prUrl;
};

const formatClosedAt = (closedAt: number | null): string => {
  if (closedAt === null) return MISSING_VALUE;
  return new Date(closedAt).toISOString();
};

const formatTable = (issueNumber: number, outcome: FinishOutcome): string => {
  return [
    TABLE_HEADER,
    TABLE_SEPARATOR,
    `| ${issueNumber} | ${formatPrUrl(outcome.prUrl)} | ${formatClosedAt(outcome.closedAt)} |`,
  ].join(LINE_BREAK);
};

const formatNote = (note: string | null): string => {
  if (note === null) return "";
  return `${LINE_BREAK}${LINE_BREAK}**Note**: ${note}`;
};

const formatReport = (header: string, table: string, note: string | null): string => {
  return `${header}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(note)}`;
};

const hasFailedChecks = (outcome: FinishOutcome): boolean => {
  return !outcome.merged && outcome.note?.startsWith(PR_CHECKS_FAILED_NOTE) === true;
};

const hasExecutorBlocked = (outcome: FinishOutcome): boolean => {
  return !outcome.merged && outcome.note?.startsWith(EXECUTOR_BLOCKED_NOTE) === true;
};

const formatOutcome = (issueNumber: number, outcome: FinishOutcome): string => {
  const table = formatTable(issueNumber, outcome);
  if (hasExecutorBlocked(outcome)) return formatReport(BLOCKED_HEADER, table, outcome.note);
  if (hasFailedChecks(outcome)) return formatReport(CHECKS_FAILED_HEADER, table, outcome.note);
  if (!outcome.merged) return formatReport(FAILURE_HEADER, table, outcome.note);
  return formatReport(SUCCESS_HEADER, table, outcome.note);
};

const createFinishInput = (mergeStrategy: LifecycleToolMergeStrategy, waitForChecks: boolean): FinishInput => {
  return { mergeStrategy, waitForChecks } as FinishInput;
};

export function createLifecycleFinishTool(handle: LifecycleFinishHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number for the lifecycle record"),
      merge_strategy: tool.schema.enum(MERGE_STRATEGIES).optional().describe("Merge mode"),
      wait_for_checks: tool.schema.boolean().optional().describe("Wait for required PR checks before merging"),
    },
    execute: async (args) => {
      try {
        const mergeStrategy = args.merge_strategy ?? config.lifecycle.mergeStrategy;
        const waitForChecks = args.wait_for_checks ?? DEFAULT_WAIT_FOR_CHECKS;
        const outcome = await handle.finish(args.issue_number, createFinishInput(mergeStrategy, waitForChecks));
        return formatOutcome(args.issue_number, outcome);
      } catch (error) {
        return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
