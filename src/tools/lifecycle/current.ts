import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import type { Resolver, ResolverResult } from "@/lifecycle/resolver";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Resolve the active lifecycle for the current branch and worktree.

Returns kind=resolved with issue number, branch, worktree, state when an active lifecycle is detected.
Returns kind=none when no lifecycle is active for the current branch.
Returns kind=ambiguous with the candidate list when multiple open lifecycles exist and the branch is non-lifecycle.`;

const RESOLVED_HEADER = "## Active lifecycle";
const NONE_HEADER = "## No active lifecycle";
const AMBIGUOUS_HEADER = "## Ambiguous active lifecycle";
const FAILURE_HEADER = "## lifecycle_current failed";
const TABLE_HEADER = "| Issue # | Branch | Worktree | State |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";

const formatResolved = (result: Extract<ResolverResult, { kind: "resolved" }>): string => {
  const r = result.record;
  const row = `| ${r.issueNumber} | \`${r.branch}\` | \`${r.worktree}\` | \`${r.state}\` |`;
  return `${RESOLVED_HEADER}${DOUBLE_LINE_BREAK}${[TABLE_HEADER, TABLE_SEPARATOR, row].join(LINE_BREAK)}`;
};

const formatAmbiguous = (result: Extract<ResolverResult, { kind: "ambiguous" }>): string => {
  const candidates = result.candidates.map((n) => `- #${n}`).join(LINE_BREAK);
  return `${AMBIGUOUS_HEADER}${DOUBLE_LINE_BREAK}${candidates}${DOUBLE_LINE_BREAK}Pass issue_number explicitly or run lifecycle_resume first.`;
};

const formatResult = (result: ResolverResult): string => {
  if (result.kind === "resolved") return formatResolved(result);
  if (result.kind === "ambiguous") return formatAmbiguous(result);
  return `${NONE_HEADER}${DOUBLE_LINE_BREAK}No issue/<N>-* branch is checked out and no open lifecycle records are present.`;
};

export type ResolverCurrentHandle = Pick<Resolver, "current">;

export function createLifecycleCurrentTool(resolver: ResolverCurrentHandle): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {},
    execute: async () => {
      try {
        return formatResult(await resolver.current());
      } catch (error) {
        return `${FAILURE_HEADER}${DOUBLE_LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
