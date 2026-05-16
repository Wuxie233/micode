export const CAPSULE_STATUSES = ["none", "fresh", "partially-stale", "discarded", "skipped", "blocked"] as const;

export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];
export type CapsuleFreshnessStatus = "fresh" | "partially-stale" | "discarded";

export interface ContextCapsuleFrontmatter {
  readonly lifecycle_issue: number | null;
  readonly branch: string;
  readonly head_sha: string;
  readonly worktree: string;
  readonly created_at: string;
  readonly source_files: readonly string[];
  readonly source_hashes: Readonly<Record<string, string>>;
}

export interface ContextCapsuleSource {
  readonly path: string;
  readonly content: string;
}

export interface ContextCapsuleBuildInput {
  readonly topic: string;
  readonly lifecycleIssue: number | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceFiles: readonly ContextCapsuleSource[];
  readonly confirmedFacts: readonly string[];
  readonly createdAt?: Date;
  readonly outputDir?: string;
  readonly softWindowRatio?: number;
}

export interface BuiltContextCapsule {
  readonly status: "fresh";
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
  readonly document: string;
  readonly warnings: readonly string[];
}

export interface BlockedContextCapsule {
  readonly status: "blocked";
  readonly reason: string;
  readonly detail?: string;
}

export type BuildContextCapsuleResult = BuiltContextCapsule | BlockedContextCapsule;

export interface ContextCapsuleRef {
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly content: string;
}

export interface ContextCapsuleFreshnessInput {
  readonly expectedLifecycleIssue: number | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly frontmatter: ContextCapsuleFrontmatter;
}

export interface ContextCapsuleFreshnessResult {
  readonly status: CapsuleFreshnessStatus;
  readonly reasons: readonly string[];
  readonly staleSourceFiles: readonly string[];
}

export function isCapsuleStatus(value: string): value is CapsuleStatus {
  return (CAPSULE_STATUSES as readonly string[]).includes(value);
}
