import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";
import { type Resolver, StaleRecordError } from "@/lifecycle/resolver";
import type { LifecycleRecord } from "@/lifecycle/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Reconstruct a local lifecycle record from the GitHub issue body.

Use when starting a new conversation or working on a fresh clone where thoughts/lifecycle/<N>.json is missing.
Hard-errors if the issue does not exist on GitHub or was not created by lifecycle_start_request.`;

const SUCCESS_HEADER = "## Lifecycle resumed";
const FAILURE_HEADER = "## lifecycle_resume failed";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatRecord = (record: LifecycleRecord): string => {
  const row = `| ${record.issueNumber} | \`${record.branch}\` | \`${record.worktree}\` | \`${record.state}\` |`;
  return `${SUCCESS_HEADER}${DOUBLE_LINE_BREAK}${[TABLE_HEADER, TABLE_SEPARATOR, row].join(LINE_BREAK)}`;
};

const formatStaleRecordFailure = (error: StaleRecordError): string => {
  const summary = error.summary.staleReason ?? extractErrorMessage(error);
  const hint = buildHint({
    failureKind: "stale_record",
    recommendedNextAction: "clean_stale_records",
    summary,
    issueNumber: error.summary.issueNumber,
    branch: error.summary.branch,
    worktree: error.summary.worktree,
    candidates: [error.summary],
  });
  return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${formatRecoveryHint(hint)}`;
};

export type ResolverResumeHandle = Pick<Resolver, "resume" | "forceRefresh">;

export function createLifecycleResumeTool(resolver: ResolverResumeHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number to reconstruct"),
      force_refresh: tool.schema
        .boolean()
        .optional()
        .describe("Refresh from GitHub issue body even when a local record exists"),
    },
    execute: async (args) => {
      try {
        const issueNumber = args.issue_number;
        const forceRefresh = args.force_refresh ?? false;
        const record = forceRefresh ? await resolver.forceRefresh(issueNumber) : await resolver.resume(issueNumber);
        return formatRecord(record);
      } catch (error) {
        if (error instanceof StaleRecordError) return formatStaleRecordFailure(error);
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
