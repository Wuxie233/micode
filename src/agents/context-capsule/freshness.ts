import type { ContextCapsuleFreshnessInput, ContextCapsuleFreshnessResult } from "./types";

const HARD_DISCARD_REASONS = ["lifecycle_issue_mismatch", "branch_mismatch", "worktree_mismatch"] as const;

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function findStaleSourceFiles(input: ContextCapsuleFreshnessInput): readonly string[] {
  const sourceFiles = new Set([...input.frontmatter.source_files, ...Object.keys(input.frontmatter.source_hashes)]);

  for (const sourceFile of Object.keys(input.sourceHashes)) {
    sourceFiles.add(sourceFile);
  }

  return sortedUnique(
    [...sourceFiles].filter(
      (sourceFile) => input.frontmatter.source_hashes[sourceFile] !== input.sourceHashes[sourceFile],
    ),
  );
}

export function evaluateContextCapsuleFreshness(input: ContextCapsuleFreshnessInput): ContextCapsuleFreshnessResult {
  const discardReasons: string[] = [];

  if (input.frontmatter.lifecycle_issue !== input.expectedLifecycleIssue) {
    discardReasons.push(HARD_DISCARD_REASONS[0]);
  }
  if (input.frontmatter.branch !== input.branch) {
    discardReasons.push(HARD_DISCARD_REASONS[1]);
  }
  if (input.frontmatter.worktree !== input.worktree) {
    discardReasons.push(HARD_DISCARD_REASONS[2]);
  }

  if (discardReasons.length > 0) {
    return {
      status: "discarded",
      reasons: discardReasons,
      staleSourceFiles: [],
    };
  }

  const staleSourceFiles = findStaleSourceFiles(input);
  const reasons: string[] = [];

  if (input.frontmatter.head_sha !== input.headSha) {
    reasons.push("head_sha_changed");
  }
  if (staleSourceFiles.length > 0) {
    reasons.push("source_hashes_changed");
  }

  if (reasons.length > 0) {
    return {
      status: "partially-stale",
      reasons,
      staleSourceFiles,
    };
  }

  return {
    status: "fresh",
    reasons: [],
    staleSourceFiles: [],
  };
}
