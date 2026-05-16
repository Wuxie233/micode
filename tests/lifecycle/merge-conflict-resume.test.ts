import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRunner = (
  responses: ReadonlyMap<string, readonly RunResult[]>,
): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();
  const next = (args: readonly string[]): RunResult => {
    const key = args.join(" ");
    const list = responses.get(key);
    const index = cursors.get(key) ?? 0;
    cursors.set(key, index + 1);
    return list?.[Math.min(index, list.length - 1)] ?? OK();
  };

  return {
    calls,
    runner: {
      git: async (args, options) => {
        calls.push({ bin: "git", args, cwd: options?.cwd });
        return next(args);
      },
      gh: async (args, options) => {
        calls.push({ bin: "gh", args, cwd: options?.cwd });
        return next(args);
      },
    },
  };
};

const commandNames = (calls: readonly Call[]): readonly string[] => calls.map((call) => call.args.join(" "));

describe("finishLifecycle resolved conflict continuation", () => {
  it("continues an in-progress temp merge when conflicts are already resolved", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/85-x --required --json state,name", [OK("[]")]],
      ["fetch origin main", [OK()]],
      ["worktree add --detach /tmp/micode-merge-issue-85 origin/main", [FAIL("already exists")]],
      ["status --porcelain", [OK("M  src/lifecycle/merge.ts\n")]],
      ["diff --name-only --diff-filter=U", [OK("")]],
      ["commit -m merge issue/85-x: resolve lifecycle conflicts", [OK()]],
      ["push origin HEAD:main", [OK()]],
      ["worktree remove --force /tmp/micode-merge-issue-85", [OK()]],
      ["worktree list --porcelain", [OK("worktree /repo/issue-85\n")]],
      ["worktree remove /repo/issue-85", [OK()]],
      ["ls-files --others --exclude-standard", [OK()]],
      ["branch -d issue/85-x", [OK()]],
    ]);
    const { runner, calls } = createRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.recoveryHint).toBeUndefined();
    expect(commandNames(calls)).toContain("commit -m merge issue/85-x: resolve lifecycle conflicts");
    expect(commandNames(calls)).toContain("push origin HEAD:main");
    expect(commandNames(calls).some((command) => command.includes("--force-with-lease"))).toBe(false);
    expect(commandNames(calls).some((command) => command.includes("--no-verify"))).toBe(false);
    expect(commandNames(calls).some((command) => command.startsWith("reset --hard"))).toBe(false);
  });

  it("returns merge_conflict again when the preserved temp worktree still has unresolved conflicts", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/85-x --required --json state,name", [OK("[]")]],
      ["fetch origin main", [OK()]],
      ["worktree add --detach /tmp/micode-merge-issue-85 origin/main", [FAIL("already exists")]],
      ["status --porcelain", [OK("UU src/lifecycle/merge.ts\n")]],
      ["diff --name-only --diff-filter=U", [OK("src/lifecycle/merge.ts\n")]],
    ]);
    const { runner } = createRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.recoveryHint?.conflictFiles).toEqual(["src/lifecycle/merge.ts"]);
  });
});
