import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { CommitOutcome, LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";

export type CommitHandle = Pick<LifecycleHandle, "commit">;

const DESCRIPTION = `Commit lifecycle work for an issue.

Args:
- issue_number: GitHub issue number for the lifecycle record
- scope: Conventional commit scope
- summary: Commit summary
- push: Optional push override. Defaults to config.lifecycle.autoPush.`;
const SUCCESS_HEADER = "## Lifecycle commit recorded";
const FAILURE_HEADER = "## Lifecycle commit failed";
const PUSH_FAILED_HEADER = "## Push failed (commit retained locally)";
const NOTHING_TO_COMMIT_HEADER = "## Nothing to commit";
const TABLE_HEADER = "| Issue # | SHA | Pushed |";
const TABLE_SEPARATOR = "| --- | --- | --- |";
const MISSING_VALUE = "-";
const LINE_BREAK = "\n";

const formatSha = (sha: string | null): string => {
  if (sha === null) return MISSING_VALUE;
  return `\`${sha}\``;
};

const formatBoolean = (value: boolean): string => `\`${String(value)}\``;

const formatTable = (issueNumber: number, outcome: CommitOutcome): string => {
  return [
    TABLE_HEADER,
    TABLE_SEPARATOR,
    `| ${issueNumber} | ${formatSha(outcome.sha)} | ${formatBoolean(outcome.pushed)} |`,
  ].join(LINE_BREAK);
};

const formatNote = (note: string | null): string => {
  if (note === null) return "";
  return `${LINE_BREAK}${LINE_BREAK}**Note**: ${note}`;
};

const formatHintSuffix = (hint: CommitOutcome["recoveryHint"]): string => {
  if (hint === undefined) return "";
  return `${LINE_BREAK}${LINE_BREAK}${formatRecoveryHint(hint)}`;
};

const formatOutcome = (issueNumber: number, outcome: CommitOutcome): string => {
  const table = formatTable(issueNumber, outcome);
  const hintSuffix = formatHintSuffix(outcome.recoveryHint);
  const isPushFailure =
    outcome.committed && !outcome.pushed && (outcome.retried || outcome.recoveryHint?.failureKind === "push_failed");

  if (outcome.committed && outcome.pushed)
    return `${SUCCESS_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
  if (isPushFailure)
    return `${PUSH_FAILED_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
  if (outcome.committed && outcome.recoveryHint === undefined)
    return `${SUCCESS_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}`;
  if (!outcome.committed && outcome.recoveryHint === undefined)
    return `${NOTHING_TO_COMMIT_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}`;
  return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${table}${formatNote(outcome.note)}${hintSuffix}`;
};

export function createLifecycleCommitTool(handle: CommitHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      issue_number: tool.schema.number().describe("GitHub issue number for the lifecycle record"),
      scope: tool.schema.string().describe("Conventional commit scope"),
      summary: tool.schema.string().describe("Commit summary"),
      push: tool.schema.boolean().optional().describe("Push after commit (default: config.lifecycle.autoPush)"),
    },
    execute: async (args) => {
      try {
        const outcome = await handle.commit(args.issue_number, {
          scope: args.scope,
          summary: args.summary,
          push: args.push ?? config.lifecycle.autoPush,
        });
        return formatOutcome(args.issue_number, outcome);
      } catch (error) {
        const message = extractErrorMessage(error);
        const hint = buildHint({
          failureKind: "unknown",
          recommendedNextAction: "ask_user",
          summary: message,
          issueNumber: args.issue_number,
        });
        return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${message}${LINE_BREAK}${LINE_BREAK}${formatRecoveryHint(hint)}`;
      }
    },
  });
}
