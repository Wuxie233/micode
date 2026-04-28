import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { ProgressEntry, ProgressLogger } from "@/lifecycle/progress";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Return the GitHub issue body and the last 10 lifecycle progress comments.

Use this when starting a new conversation to onboard the active lifecycle without re-deriving from chat history.`;

const HEADER = "## Lifecycle context";
const FAILURE_HEADER = "## lifecycle_context failed";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatProgress = (entries: readonly ProgressEntry[]): string => {
  if (entries.length === 0) return "_no progress entries yet_";
  return entries
    .map((e) => `- **${e.kind}** (${e.createdAt || "?"}): ${e.summary}${e.url ? ` - ${e.url}` : ""}`)
    .join(LINE_BREAK);
};

export type ContextHandle = Pick<ProgressLogger, "context">;

export function createLifecycleContextTool(progress: ContextHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().optional().describe("Optional explicit issue number"),
    },
    execute: async (args) => {
      try {
        const typed = args as { issue_number?: number };
        const snap = await progress.context({ issueNumber: typed.issue_number });
        return [
          `${HEADER} (issue #${snap.issueNumber})`,
          "",
          "### Issue body",
          snap.body || "_(empty)_",
          "",
          "### Recent progress",
          formatProgress(snap.recentProgress),
        ].join(LINE_BREAK);
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
