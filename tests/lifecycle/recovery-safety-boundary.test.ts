import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { runCleanup } from "@/lifecycle/cleanup-policy";
import { commitAndPush } from "@/lifecycle/commits";
import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface RecordedCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface RecordedFsOps {
  readonly mkdirs: string[];
  readonly renames: Array<{ readonly from: string; readonly to: string }>;
}

const createRecordingRunner = (
  responses: ReadonlyMap<string, readonly RunResult[]> = new Map(),
): { readonly runner: LifecycleRunner; readonly calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
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

const createFsOps = (): RecordedFsOps & {
  readonly fsOps: { mkdir: (path: string) => void; rename: (from: string, to: string) => void };
} => {
  const mkdirs: string[] = [];
  const renames: Array<{ readonly from: string; readonly to: string }> = [];
  return {
    mkdirs,
    renames,
    fsOps: {
      mkdir: (path) => mkdirs.push(path),
      rename: (from, to) => renames.push({ from, to }),
    },
  };
};

const joinedArgs = (calls: readonly RecordedCall[]): readonly string[] => calls.map((call) => call.args.join(" "));

const expectNoUnsafeRecoveryCommands = (calls: readonly RecordedCall[]): void => {
  const commands = joinedArgs(calls);
  expect(commands.some((command) => command.startsWith("push --force"))).toBe(false);
  expect(commands.some((command) => command.includes("--force-with-lease"))).toBe(false);
  expect(commands.some((command) => command.includes("--no-verify"))).toBe(false);
  expect(commands.some((command) => command.startsWith("reset --hard"))).toBe(false);
  expect(commands.some((command) => command === "rm" || command.startsWith("rm "))).toBe(false);
  expect(commands.some((command) => command.includes("restart"))).toBe(false);
};

describe("lifecycle recovery safety boundary", () => {
  let sleep: ReturnType<typeof spyOn>;

  beforeEach(() => {
    sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    sleep.mockRestore();
  });

  it("finishLifecycle recovery paths avoid unsafe git commands and never checkout main in the repo worktree", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/67-safety --required --json state,name", [OK("[]")]],
      ["worktree add /tmp/micode-merge-issue-67 main", [OK()]],
      ["fetch origin main", [OK()]],
      ["merge --ff-only origin/main", [OK()]],
      ["merge --no-ff issue/67-safety", [FAIL("CONFLICT")]],
      ["status --porcelain", [OK("UU src/conflict.ts\n")]],
    ]);
    const { runner, calls } = createRecordingRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/67-safety",
      worktree: "/repo/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expectNoUnsafeRecoveryCommands(calls);
    expect(calls.some((call) => call.args.join(" ") === "checkout main" && call.cwd === "/repo/micode")).toBe(false);
    expect(calls.some((call) => call.args.join(" ").startsWith("checkout "))).toBe(false);
    expect(calls).toContainEqual({
      bin: "git",
      args: ["merge", "--no-ff", "issue/67-safety"],
      cwd: "/tmp/micode-merge-issue-67",
    });
  });

  it("commitAndPush retry path never force-pushes and never bypasses hooks", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["add --all", [OK()]],
      ["commit -m feat(lifecycle): safety\n\nRefs #67", [OK()]],
      ["rev-parse HEAD", [OK("abc123\n")]],
      ["push --set-upstream origin issue/67-safety", [FAIL("network"), FAIL("still down")]],
    ]);
    const { runner, calls } = createRecordingRunner(responses);

    const outcome = await commitAndPush(runner, {
      cwd: "/repo/micode-issue-67",
      issueNumber: 67,
      branch: "issue/67-safety",
      type: "feat",
      scope: "lifecycle",
      summary: "safety",
      push: true,
    });

    expect(outcome.committed).toBe(true);
    expect(outcome.pushed).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("push_failed");
    expect(
      joinedArgs(calls).filter((command) => command === "push --set-upstream origin issue/67-safety"),
    ).toHaveLength(2);
    expectNoUnsafeRecoveryCommands(calls);
  });

  it("runCleanup quarantines lifecycle artifacts by rename only and never shells out to rm", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["worktree list --porcelain", [OK("worktree /repo/micode-issue-67\nbranch refs/heads/issue/67-safety\n")]],
      ["status --porcelain", [OK("?? thoughts/shared/designs/recovery.md\n")]],
      ["ls-files --others --exclude-standard", [OK("thoughts/shared/designs/recovery.md\n")]],
      ["worktree remove /repo/micode-issue-67", [OK()]],
    ]);
    const { runner, calls } = createRecordingRunner(responses);
    const fs = createFsOps();

    const outcome = await runCleanup(runner, {
      cwd: "/repo/micode",
      worktree: "/repo/micode-issue-67",
      branch: "issue/67-safety",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: fs.fsOps,
      now: () => new Date("2026-05-12T00:00:00Z"),
    });

    expect(outcome.kind).toBe("removed");
    expect(outcome.reason).toContain("quarantined 1");
    expect(fs.renames).toEqual([
      {
        from: "/repo/micode-issue-67/thoughts/shared/designs/recovery.md",
        to: "/repo/micode/thoughts/lifecycle/backups/issue-67/2026-05-12T00-00-00-000Z/thoughts/shared/designs/recovery.md",
      },
    ]);
    expect(fs.mkdirs).toEqual([
      "/repo/micode/thoughts/lifecycle/backups/issue-67/2026-05-12T00-00-00-000Z/thoughts/shared/designs",
    ]);
    expectNoUnsafeRecoveryCommands(calls);
  });
});
