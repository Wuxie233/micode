import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import { buildHint } from "@/lifecycle/recovery/hint";
import { formatRecoveryHint } from "@/lifecycle/recovery/hint-format";
import type { LifecycleCandidateSummary, Resolver, ResolverResult } from "@/lifecycle/resolver";
import { formatLifecycleIdentity, LIFECYCLE_MODES, type LifecycleMode, type LifecycleRecord } from "@/lifecycle/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Resolve the active lifecycle for the current branch and worktree.

Returns kind=resolved with issue number, branch, worktree, state when an active lifecycle is detected.
Returns kind=none when no lifecycle is active for the current branch.
Returns kind=ambiguous with the candidate list when multiple open lifecycles exist and the branch is non-lifecycle.`;

const RESOLVED_HEADER = "## Active lifecycle";
const NONE_HEADER = "## No active lifecycle";
const AMBIGUOUS_HEADER = "## Ambiguous active lifecycle";
const FAILURE_HEADER = "## lifecycle_current failed";
const TABLE_HEADER = "| Issue / Local ID | Mode | Branch | Worktree | State |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- | --- |";
const CANDIDATE_TABLE_HEADER = "| Issue / Local ID | Mode | Branch | Worktree | State | Stale | Reason |";
const CANDIDATE_TABLE_SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DOUBLE_LINE_BREAK = "\n\n";
const MISSING = "-";
const AMBIGUOUS_NEXT_STEP = "Select the matching issue_number or local_id explicitly, or clean stale records first.";

const formatNullable = (value: string | number | null): string => {
  if (value === null) return MISSING;
  return String(value);
};

const formatCode = (value: string | number | null): string => {
  if (value === null) return `\`${MISSING}\``;
  return `\`${String(value)}\``;
};

type CandidateWithMode = LifecycleCandidateSummary & {
  readonly mode?: LifecycleMode;
  readonly localId?: string | null;
};

const formatMode = (mode: LifecycleMode | undefined): LifecycleMode => mode ?? LIFECYCLE_MODES.REMOTE;

const formatCandidateIdentity = (candidate: CandidateWithMode): string => {
  if (formatMode(candidate.mode) === LIFECYCLE_MODES.LOCAL_ONLY)
    return candidate.localId ?? String(candidate.issueNumber);
  return String(candidate.issueNumber);
};

const formatResolvedRow = (record: LifecycleRecord): string =>
  `| ${formatLifecycleIdentity(record).replace(/^#/, "")} | ${formatCode(record.mode)} | ${formatCode(record.branch)} | ${formatCode(record.worktree)} | ${formatCode(record.state)} |`;

const formatCandidateRow = (candidate: CandidateWithMode): string =>
  `| ${formatCandidateIdentity(candidate)} | ${formatCode(formatMode(candidate.mode))} | ${formatCode(candidate.branch)} | ${formatCode(candidate.worktree)} | ${formatCode(candidate.state)} | ${formatCode(String(candidate.stale))} | ${formatNullable(candidate.staleReason)} |`;

const formatResolved = (result: Extract<ResolverResult, { kind: "resolved" }>): string => {
  const row = formatResolvedRow(result.record);
  return `${RESOLVED_HEADER}${DOUBLE_LINE_BREAK}${[TABLE_HEADER, TABLE_SEPARATOR, row].join(LINE_BREAK)}`;
};

const formatAmbiguous = (result: Extract<ResolverResult, { kind: "ambiguous" }>): string => {
  const rows = result.candidates.map((c) => formatCandidateRow(c));
  const summary = `Multiple lifecycle records match the current context; ${result.candidates.length} candidate(s) found.`;
  const recommendedNextAction = result.candidates.some((c) => c.stale) ? "clean_stale_records" : "ask_user";
  const hint = formatRecoveryHint(
    buildHint({
      failureKind: "ambiguous_lifecycle",
      recommendedNextAction,
      summary,
      candidates: result.candidates,
    }),
  );
  return `${AMBIGUOUS_HEADER}${DOUBLE_LINE_BREAK}${[CANDIDATE_TABLE_HEADER, CANDIDATE_TABLE_SEPARATOR, ...rows].join(
    LINE_BREAK,
  )}${DOUBLE_LINE_BREAK}${AMBIGUOUS_NEXT_STEP}${DOUBLE_LINE_BREAK}${hint}`;
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
