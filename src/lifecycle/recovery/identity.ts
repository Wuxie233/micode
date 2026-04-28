import type { LifecycleRunner } from "@/lifecycle/runner";

const OK_EXIT = 0;
const BRANCH_ARGS = ["rev-parse", "--abbrev-ref", "HEAD"] as const;
const ORIGIN_ARGS = ["remote", "get-url", "origin"] as const;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;

export interface RuntimeIdentity {
  readonly branch: string | null;
  readonly origin: string | null;
  readonly worktree: string;
}

const stdoutOrNull = (run: { stdout: string; exitCode: number }): string | null => {
  if (run.exitCode !== OK_EXIT) return null;
  const trimmed = run.stdout.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function probeRuntimeIdentity(
  runner: LifecycleRunner,
  fallbackWorktree: string,
): Promise<RuntimeIdentity> {
  const [branchRun, originRun, toplevelRun] = await Promise.all([
    runner.git(BRANCH_ARGS, { cwd: fallbackWorktree }),
    runner.git(ORIGIN_ARGS, { cwd: fallbackWorktree }),
    runner.git(TOPLEVEL_ARGS, { cwd: fallbackWorktree }),
  ]);

  return {
    branch: stdoutOrNull(branchRun),
    origin: stdoutOrNull(originRun),
    worktree: stdoutOrNull(toplevelRun) ?? fallbackWorktree,
  };
}
