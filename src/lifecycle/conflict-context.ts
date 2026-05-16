import type { LifecycleRecoveryHint } from "./recovery/hint";

export const CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS = [
  "git push --force",
  "git push --force-with-lease",
  "git reset --hard",
  "git commit --no-verify",
  "deleting user files",
  "auto-restarting OpenCode",
] as const;

export const CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS = ["test", "type", "call-site"] as const;

export type ConflictResolverAllowedExpansionKind = (typeof CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS)[number];

export interface ConflictResolverContext {
  readonly issueNumber: number;
  readonly branch: string;
  readonly baseBranch: string | null;
  readonly tempWorktree: string;
  readonly conflictFiles: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly allowedExpansionKinds: readonly ConflictResolverAllowedExpansionKind[];
  readonly forbiddenOperations: typeof CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS;
  readonly requiresSemanticQuestion: boolean;
  readonly maxValidationRepairRounds: number;
}

export interface BuildConflictResolverContextOptions {
  readonly baseBranch?: string | null;
  readonly maxValidationRepairRounds?: number;
}

const DEFAULT_MAX_VALIDATION_REPAIR_ROUNDS = 2;
const TEST_PATH_RE = /(^|\/)tests?\/|\.test\.[cm]?[jt]sx?$|_test\.go$/;
const TYPE_PATH_RE = /(^|\/)(types|schemas|contracts)\.[cm]?[jt]s$|(^|\/)types\//;
const INDEX_OR_CALLSITE_RE = /(^|\/)index\.[cm]?[jt]s$|(^|\/)runner\.[cm]?[jt]s$|(^|\/)tool\.[cm]?[jt]s$/;

const normalizePath = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

const basenameWithoutExt = (path: string): string => {
  const normalized = normalizePath(path);
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.replace(/(\.test)?\.[^.]+$/, "");
};

const dirOf = (path: string): string => {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};

const unique = (items: readonly string[]): readonly string[] => [...new Set(items.map(normalizePath))];

export function isDirectlyRelatedResolverPath(candidate: string, conflictFiles: readonly string[]): boolean {
  const normalized = normalizePath(candidate);
  const conflicts = unique(conflictFiles);
  if (conflicts.includes(normalized)) return true;

  const candidateBase = basenameWithoutExt(normalized);
  const sameStem = conflicts.some((file) => basenameWithoutExt(file) === candidateBase);
  if (TEST_PATH_RE.test(normalized) && sameStem) return true;

  const sameDirectory = conflicts.some((file) => dirOf(file) === dirOf(normalized));
  if (sameDirectory && TYPE_PATH_RE.test(normalized)) return true;
  if (sameDirectory && INDEX_OR_CALLSITE_RE.test(normalized)) return true;
  return false;
}

export function buildConflictResolverContext(
  hint: LifecycleRecoveryHint,
  options: BuildConflictResolverContextOptions = {},
): ConflictResolverContext {
  if (hint.failureKind !== "merge_conflict" || hint.recommendedNextAction !== "resolve_conflicts") {
    throw new Error("conflict resolver context requires a merge_conflict/resolve_conflicts recovery hint");
  }
  if (hint.issueNumber === null || hint.worktree === null || hint.conflictFiles.length === 0) {
    throw new Error("merge_conflict hint must include worktree, conflict_files, and issue_number");
  }

  const conflictFiles = unique(hint.conflictFiles);
  return {
    issueNumber: hint.issueNumber,
    branch: hint.branch ?? `issue/${hint.issueNumber}`,
    baseBranch: options.baseBranch ?? null,
    tempWorktree: hint.worktree,
    conflictFiles,
    allowedFiles: conflictFiles,
    allowedExpansionKinds: CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS,
    forbiddenOperations: CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
    requiresSemanticQuestion: true,
    maxValidationRepairRounds: options.maxValidationRepairRounds ?? DEFAULT_MAX_VALIDATION_REPAIR_ROUNDS,
  };
}
