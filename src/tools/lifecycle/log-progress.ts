import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { PROGRESS_KINDS, type ProgressKind, type ProgressLogger } from "@/lifecycle/progress";
import { extractErrorMessage } from "@/utils/errors";

const KIND_VALUES = Object.values(PROGRESS_KINDS) as readonly string[];

const DESCRIPTION = `Append a progress entry to the active lifecycle issue as a GitHub comment.

kind: decision | blocker | discovery | status | handoff
summary: short one-line summary
details: optional longer detail block (collapsed under <details> in the comment)
issue_number: optional override; when omitted the active lifecycle is resolved from current branch`;

const SUCCESS_HEADER = "## Progress logged";
const FAILURE_HEADER = "## lifecycle_log_progress failed";
const DOUBLE_LINE_BREAK = "\n\n";

const isProgressKind = (value: string): value is ProgressKind => KIND_VALUES.includes(value);

export type LogProgressHandle = Pick<ProgressLogger, "log">;

export function createLifecycleLogProgressTool(progress: LogProgressHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      kind: tool.schema.string().describe(`One of: ${KIND_VALUES.join(", ")}`),
      summary: tool.schema.string().describe("One-line summary"),
      details: tool.schema.string().optional().describe("Optional longer detail block"),
      issue_number: tool.schema.number().optional().describe("Optional explicit issue number"),
    },
    execute: async (args) => {
      const typed = args as {
        kind: string;
        summary: string;
        details?: string;
        issue_number?: number;
      };
      if (!isProgressKind(typed.kind)) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}invalid kind: ${typed.kind}. Allowed: ${KIND_VALUES.join(", ")}`;
      }
      try {
        const outcome = await progress.log({
          kind: typed.kind,
          summary: typed.summary,
          details: typed.details,
          issueNumber: typed.issue_number,
        });
        const urlSuffix = outcome.commentUrl ? `, url=${outcome.commentUrl}` : "";
        return `${SUCCESS_HEADER}${DOUBLE_LINE_BREAK}issue=#${outcome.issueNumber}, kind=${outcome.kind}${urlSuffix}`;
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
