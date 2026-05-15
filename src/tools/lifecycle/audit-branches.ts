import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { auditLifecycleBranches, type BranchCleanupAuditEntry } from "@/lifecycle/branch-cleanup-policy";
import { resolveDefaultBranch } from "@/lifecycle/default-branch";
import { classifyRepo } from "@/lifecycle/pre-flight";
import type { LifecycleRunner } from "@/lifecycle/runner";
import type { LifecycleRecord } from "@/lifecycle/types";
import { extractErrorMessage } from "@/utils/errors";

const DESCRIPTION = `Audit lifecycle-owned local and remote branches.

Dry-run by default. Local pruning requires prune=true and dry_run=false. Remote branch deletion is also gated by repository ownership pre-flight and only targets origin.`;
const SUCCESS_HEADER = "## Lifecycle branch audit";
const FAILURE_HEADER = "## lifecycle_audit_branches failed";
const TABLE_HEADER = "| Candidate | Decision | Reason | Deletion attempted |";
const TABLE_SEPARATOR = "| --- | --- | --- | --- |";
const LINE_BREAK = "\n";
const DEFAULT_DRY_RUN = true;
const DEFAULT_PRUNE = false;
const MISSING = "-";

export interface BranchAuditResolver {
  readonly listRecords: () => Promise<readonly LifecycleRecord[]>;
}

export interface LifecycleAuditBranchesDeps {
  readonly runner: LifecycleRunner;
  readonly resolver: BranchAuditResolver;
  readonly cwd: string;
}

const code = (value: string): string => `\`${value}\``;

const formatCandidate = (entry: BranchCleanupAuditEntry): string => {
  const scope = entry.candidate.scope;
  return `${scope}:${entry.candidate.branchName}`;
};

const formatDeletionAttempted = (entry: BranchCleanupAuditEntry): string => {
  if (entry.pruned) return "yes";
  if (entry.mutationError) return `failed: ${entry.mutationError}`;
  if (entry.mutationSkippedReason) return `no: ${entry.mutationSkippedReason}`;
  return "no";
};

const row = (entry: BranchCleanupAuditEntry): string =>
  `| ${code(formatCandidate(entry))} | ${code(entry.decision.kind)} | ${entry.decision.reason} | ${formatDeletionAttempted(entry)} |`;

const formatReport = (
  entries: readonly BranchCleanupAuditEntry[],
  dryRun: boolean,
  prune: boolean,
  baseBranch: string,
): string => {
  const rows =
    entries.length > 0 ? entries.map(row) : [`| ${MISSING} | ${MISSING} | no lifecycle branch candidates found | no |`];
  return [
    SUCCESS_HEADER,
    "",
    `**dry_run:** ${dryRun}`,
    `**prune:** ${prune}`,
    `**base_branch:** ${code(baseBranch)}`,
    "",
    TABLE_HEADER,
    TABLE_SEPARATOR,
    ...rows,
  ].join(LINE_BREAK);
};

export function createLifecycleAuditBranchesTool(deps: LifecycleAuditBranchesDeps): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      dry_run: tool.schema.boolean().optional().describe("Audit only; defaults to true"),
      prune: tool.schema
        .boolean()
        .optional()
        .describe("Attempt branch deletion only when explicitly true; defaults to false"),
      base_branch: tool.schema.string().optional().describe("Base branch for merge/no-diff evidence"),
    },
    execute: async (args) => {
      const dryRun = args.dry_run ?? DEFAULT_DRY_RUN;
      const prune = args.prune ?? DEFAULT_PRUNE;
      const shouldMutate = prune && !dryRun;

      try {
        const [records, base, preflight] = await Promise.all([
          deps.resolver.listRecords(),
          resolveDefaultBranch(deps.runner, { cwd: deps.cwd, override: args.base_branch }),
          classifyRepo(deps.runner, deps.cwd),
        ]);
        const entries = await auditLifecycleBranches(deps.runner, {
          cwd: deps.cwd,
          baseBranch: base.branch,
          records,
          preflight,
          dryRun: !shouldMutate,
        });
        return formatReport(entries, dryRun, prune, base.branch);
      } catch (error) {
        return `${FAILURE_HEADER}${LINE_BREAK}${LINE_BREAK}${extractErrorMessage(error)}`;
      }
    },
  });
}
