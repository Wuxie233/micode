import { describe, expect, it } from "bun:test";

import { evaluateConflictResolverScope } from "@/lifecycle/conflict-scope";
import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
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
        calls.push({ args, cwd: options?.cwd });
        return next(args);
      },
      gh: async () => OK("[]"),
    },
  };
};

describe("conflict resolver recovery end-to-end guard", () => {
  it("blocks first on unresolved conflict, then succeeds after direct-scope resolver edits", async () => {
    const first = createRunner(
      new Map([
        ["worktree add /tmp/micode-merge-issue-85 main", [OK()]],
        ["fetch origin main", [OK()]],
        ["merge --ff-only origin/main", [OK()]],
        ["merge --no-ff issue/85-x", [FAIL("CONFLICT")]],
        ["status --porcelain", [OK("UU src/lifecycle/merge.ts\n")]],
      ]),
    );

    const blocked = await finishLifecycle(first.runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(blocked.merged).toBe(false);
    expect(blocked.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(
      evaluateConflictResolverScope({
        conflictFiles: ["src/lifecycle/merge.ts"],
        modifiedFiles: ["src/lifecycle/merge.ts", "tests/lifecycle/merge.test.ts"],
      }).status,
    ).toBe("allowed");

    const second = createRunner(
      new Map([
        ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
        ["diff --name-only --diff-filter=U", [OK("")]],
        ["status --porcelain", [OK("M  src/lifecycle/merge.ts\nM  tests/lifecycle/merge.test.ts\n")]],
        ["commit -m merge issue/85-x: resolve lifecycle conflicts", [OK()]],
        ["push origin main", [OK()]],
        ["worktree remove --force /tmp/micode-merge-issue-85", [OK()]],
        ["worktree list --porcelain", [OK("worktree /repo/issue-85\n")]],
        ["worktree remove /repo/issue-85", [OK()]],
        ["ls-files --others --exclude-standard", [OK()]],
        ["branch -d issue/85-x", [OK()]],
      ]),
    );

    const finished = await finishLifecycle(second.runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(finished.merged).toBe(true);
    const commands = second.calls.map((call) => call.args.join(" "));
    expect(commands).toContain("push origin main");
    expect(commands.some((command) => command.includes("--force-with-lease"))).toBe(false);
    expect(commands.some((command) => command.includes("--no-verify"))).toBe(false);
    expect(commands.some((command) => command.startsWith("reset --hard"))).toBe(false);
  });
});
