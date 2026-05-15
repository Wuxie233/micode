import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const runnerWith = (
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

describe("local merge resolver scope enforcement", () => {
  it("blocks resolved temp merges that changed unrelated files", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
      ["diff --name-only --diff-filter=U", [OK("")]],
      ["status --porcelain", [OK("M  src/lifecycle/merge.ts\nM  src/agents/commander.ts\n")]],
    ]);
    const { runner, calls } = runnerWith(responses);

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
    expect(outcome.note).toContain("scope");
    expect(calls.map((call) => call.args.join(" "))).not.toContain(
      "commit -m merge issue/85-x: resolve lifecycle conflicts",
    );
  });
});
