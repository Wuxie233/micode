import { basename } from "node:path";

import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

export interface TempWorktreePathInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly tmpDir: string;
}

export function computeTempWorktreePath(input: TempWorktreePathInput): string {
  const stripped = input.repoRoot.replace(/\/+$/, "");
  const repo = basename(stripped);
  return `${input.tmpDir.replace(/\/+$/, "")}/${repo}-merge-issue-${input.issueNumber}`;
}

export interface CreateTempInput {
  readonly repoRoot: string;
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly tmpDir: string;
}

export type CreateTempResult =
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "failed"; readonly path: string; readonly reason: string };

const OK = 0;
const GIT_STATUS_PATH_OFFSET = 3;
const CONFLICT_PREFIXES: readonly string[] = ["UU", "AA", "DD", "AU", "UA", "DU", "UD"];

export async function createTempMergeWorktree(
  runner: LifecycleRunner,
  input: CreateTempInput,
): Promise<CreateTempResult> {
  const path = computeTempWorktreePath({
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    tmpDir: input.tmpDir,
  });
  const result = await runner.git(["worktree", "add", path, input.baseBranch], { cwd: input.repoRoot });
  if (result.exitCode === OK) return { kind: "created", path };
  return { kind: "failed", path, reason: `${result.stderr}\n${result.stdout}`.trim() };
}

export async function readMergeConflicts(runner: LifecycleRunner, worktreePath: string): Promise<readonly string[]> {
  const status = await runner.git(["status", "--porcelain"], { cwd: worktreePath });
  if (status.exitCode !== OK) return [];
  return status.stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length >= GIT_STATUS_PATH_OFFSET)
    .filter((line) => CONFLICT_PREFIXES.some((p) => line.startsWith(p)))
    .map((line) => line.slice(GIT_STATUS_PATH_OFFSET).trim())
    .filter((p) => p.length > 0);
}

export interface RemoveTempInput {
  readonly repoRoot: string;
  readonly path: string;
}

export async function removeTempMergeWorktree(runner: LifecycleRunner, input: RemoveTempInput): Promise<RunResult> {
  return runner.git(["worktree", "remove", "--force", input.path], { cwd: input.repoRoot });
}
