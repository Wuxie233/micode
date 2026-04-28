import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { Resolver } from "@/lifecycle/resolver";
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

export type ResolverResumeHandle = Pick<Resolver, "resume">;

export function createLifecycleResumeTool(resolver: ResolverResumeHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number to reconstruct"),
    },
    execute: async (args) => {
      try {
        const issueNumber = (args as { issue_number: number }).issue_number;
        return formatRecord(await resolver.resume(issueNumber));
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
