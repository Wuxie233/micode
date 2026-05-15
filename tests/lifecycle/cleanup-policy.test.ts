import { describe, expect, it } from "bun:test";

import { type CleanupPolicyInput, runCleanup } from "@/lifecycle/cleanup-policy";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface RunnerCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const fakeRunner = (
  responses: ReadonlyMap<string, readonly RunResult[]>,
): { runner: LifecycleRunner; calls: RunnerCall[] } => {
  const calls: RunnerCall[] = [];
  const cursors = new Map<string, number>();
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ args, cwd: opts?.cwd });
      const key = args.join(" ");
      const list = responses.get(key) ?? [ok()];
      const i = cursors.get(key) ?? 0;
      cursors.set(key, i + 1);
      return list[Math.min(i, list.length - 1)] ?? ok();
    },
    gh: async () => ok(),
  };
  return { runner, calls };
};

const baseInput = (overrides: Partial<CleanupPolicyInput> = {}): CleanupPolicyInput => ({
  cwd: "/repo/micode",
  worktree: "/repo/micode-issue-1",
  branch: "issue/1-x",
  baseBranch: "main",
  issueClosed: true,
  branchMerged: true,
  issueNumber: 1,
  artifactPointers: [],
  worktreeExistsOnDisk: true,
  ...overrides,
});

describe("runCleanup", () => {
  it("removes a clean worktree on first try and reports kind=removed", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("removed");
    expect(outcome.retried).toBe(false);
    expect(calls.some((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1")).toBe(true);
  });

  it("retries with prune exactly once when first remove fails on a clean worktree", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [fail("locked"), ok()]],
        ["worktree prune", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("removed");
    expect(outcome.retried).toBe(true);
    const removeCalls = calls.filter((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1");
    expect(removeCalls).toHaveLength(2);
    expect(calls.some((c) => c.args.join(" ") === "worktree prune")).toBe(true);
  });

  it("does NOT retry more than once even if second remove also fails", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [fail("locked"), fail("still locked")]],
        ["worktree prune", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("failed");
    expect(outcome.retried).toBe(true);
    const removeCalls = calls.filter((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1");
    expect(removeCalls).toHaveLength(2);
  });

  it("returns blocked-dirty without removing when working tree has tracked changes", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok(" M src/foo.ts\n")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-dirty");
    expect(outcome.reason).toContain("src/foo.ts");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns blocked-user-work when issue is still open", async () => {
    const { runner } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ issueClosed: false }));

    expect(outcome.kind).toBe("blocked-user-work");
  });

  it("returns blocked-user-work when branch is not merged", async () => {
    const { runner } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ branchMerged: false }));

    expect(outcome.kind).toBe("blocked-user-work");
  });

  it("returns blocked-ambiguous when only unknown untracked files are present", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("scratch.md\n")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-ambiguous");
    expect(outcome.reason).toContain("scratch.md");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("filters ?? status lines so unknown untracked-only worktrees are ambiguous, not dirty", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("?? scratch.md\n")]],
        ["ls-files --others --exclude-standard", [ok("scratch.md\n")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-ambiguous");
    expect(outcome.reason).toContain("scratch.md");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns already-missing when worktree path does not exist on disk", async () => {
    const { runner, calls } = fakeRunner(new Map());

    const outcome = await runCleanup(runner, baseInput({ worktreeExistsOnDisk: false }));

    expect(outcome.kind).toBe("already-missing");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns blocked-external when worktree is not registered with this repo", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /some/other/path\nbranch refs/heads/main\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-external");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("deletes a standard lifecycle branch after clean worktree removal when enabled", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n"), ok("")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
        ["branch -d issue/1-x", [ok("Deleted branch issue/1-x.\n")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ cleanupBranch: true }));

    expect(outcome.kind).toBe("removed");
    expect(outcome.reason).toContain("deleted branch issue/1-x");
    expect(calls.some((c) => c.args.join(" ") === "branch -d issue/1-x" && c.cwd === "/repo/micode")).toBe(true);
  });

  it("does not delete the branch when cleanupBranch is disabled", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("removed");
    expect(calls.some((c) => c.args[0] === "branch")).toBe(false);
  });

  it("never force deletes a branch during cleanup", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n"), ok("")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
        ["branch -d issue/1-x", [fail("not fully merged")]],
      ]),
    );

    await runCleanup(runner, baseInput({ cleanupBranch: true }));

    expect(calls.some((c) => c.args.join(" ") === "branch -D issue/1-x")).toBe(false);
    expect(calls.some((c) => c.args.includes("-D"))).toBe(false);
  });

  it("reports branch deletion failure after worktree removal succeeds", async () => {
    const { runner } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n"), ok("")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
        ["branch -d issue/1-x", [fail("not fully merged")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ cleanupBranch: true }));

    expect(outcome.kind).toBe("failed");
    expect(outcome.reason).toContain("worktree removal succeeded");
    expect(outcome.reason).toContain("branch cleanup failed");
    expect(outcome.reason).toContain("not fully merged");
  });

  it("does not delete a branch checked out in another registered worktree", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        [
          "worktree list --porcelain",
          [
            ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n"),
            ok("worktree /repo/other\nbranch refs/heads/issue/1-x\n"),
          ],
        ],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ cleanupBranch: true }));

    expect(outcome.kind).toBe("removed");
    expect(outcome.reason).toContain("branch cleanup skipped");
    expect(calls.some((c) => c.args[0] === "branch")).toBe(false);
  });
});
