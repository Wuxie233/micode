import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd: string | undefined;
}

const recorder = (queue: Map<string, RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ bin: "git", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      return r ?? OK();
    },
    gh: async (args, opts) => {
      calls.push({ bin: "gh", args, cwd: opts?.cwd });
      const key = args.join(" ");
      const r = queue.get(key)?.shift();
      // Default: no remote CI so resolveStrategy stays in local-merge mode.
      return r ?? OK("[]");
    },
  };
  return { runner, calls };
};

describe("finishViaLocalMerge with temp worktree", () => {
  it("creates /tmp/<repo>-merge-issue-<N>, runs merge inside it, pushes, then removes it", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]"), OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [OK()]);
    queue.set("fetch origin main", [OK()]);
    queue.set("merge --ff-only origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [OK()]);
    queue.set("push origin main", [OK()]);
    queue.set("worktree remove --force /tmp/micode-merge-issue-67", [OK()]);
    queue.set("worktree list --porcelain", [OK("worktree /r/micode-issue-67\n")]);
    queue.set("worktree remove /r/micode-issue-67", [OK()]);
    queue.set("status --porcelain", [OK()]);
    queue.set("ls-files --others --exclude-standard", [OK()]);
    queue.set("branch -d issue/67-x", [OK()]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(true);
    expect(outcome.recoveryHint).toBeUndefined();

    const cwds = calls.map((c) => `${c.args.join(" ")}@${c.cwd}`);
    expect(cwds).toEqual(
      expect.arrayContaining([
        "fetch origin main@/tmp/micode-merge-issue-67",
        "merge --ff-only origin/main@/tmp/micode-merge-issue-67",
        "merge --no-ff issue/67-x@/tmp/micode-merge-issue-67",
      ]),
    );
    expect(cwds.indexOf("fetch origin main@/tmp/micode-merge-issue-67")).toBeLessThan(
      cwds.indexOf("merge --ff-only origin/main@/tmp/micode-merge-issue-67"),
    );
    expect(cwds.indexOf("merge --ff-only origin/main@/tmp/micode-merge-issue-67")).toBeLessThan(
      cwds.indexOf("merge --no-ff issue/67-x@/tmp/micode-merge-issue-67"),
    );
    expect(cwds).toContain("merge --no-ff issue/67-x@/tmp/micode-merge-issue-67");
    expect(cwds).toContain("push origin main@/tmp/micode-merge-issue-67");
    // main worktree was NEVER `git checkout`'d
    expect(cwds.some((s) => s.startsWith("checkout main@/r/micode"))).toBe(false);
  });

  it("on merge conflict, keeps tmp worktree, returns merge_conflict hint with conflict_files", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [OK()]);
    queue.set("fetch origin main", [OK()]);
    queue.set("merge --ff-only origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [FAIL("CONFLICT")]);
    queue.set("status --porcelain", [OK("UU src/a.ts\nAA src/b.ts\n")]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.recoveryHint?.conflictFiles).toEqual(["src/a.ts", "src/b.ts"]);
    expect(outcome.recoveryHint?.worktree).toBe("/tmp/micode-merge-issue-67");
    // tmp worktree must NOT have been removed (AI needs to resolve conflicts in it)
    expect(calls.some((c) => c.args.join(" ") === "worktree remove --force /tmp/micode-merge-issue-67")).toBe(false);
  });

  it("on push failure, removes tmp worktree before returning retryable push_failed hint", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [OK()]);
    queue.set("fetch origin main", [OK()]);
    queue.set("merge --ff-only origin/main", [OK()]);
    queue.set("merge --no-ff issue/67-x", [OK()]);
    queue.set("push origin main", [FAIL("rejected")]);
    queue.set("worktree remove --force /tmp/micode-merge-issue-67", [OK()]);

    const { runner, calls } = recorder(queue);
    const outcome = await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("push_failed");
    expect(outcome.recoveryHint?.safeToRetry).toBe(true);
    expect(outcome.recoveryHint?.worktree).toBe("/tmp/micode-merge-issue-67");
    const pushIndex = calls.findIndex((c) => c.args.join(" ") === "push origin main");
    const removeIndex = calls.findIndex(
      (c) => c.args.join(" ") === "worktree remove --force /tmp/micode-merge-issue-67",
    );
    expect(removeIndex).toBeGreaterThan(pushIndex);
  });

  it("safety: never executes `git reset --hard` against the main worktree", async () => {
    const queue = new Map<string, RunResult[]>();
    queue.set("pr checks issue/67-x --required --json state,name", [OK("[]")]);
    queue.set("worktree add /tmp/micode-merge-issue-67 main", [FAIL("path exists")]);

    const { runner, calls } = recorder(queue);
    await finishLifecycle(runner, {
      cwd: "/r/micode",
      branch: "issue/67-x",
      worktree: "/r/micode-issue-67",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });
    expect(calls.some((c) => c.args.join(" ").startsWith("reset --hard"))).toBe(false);
    expect(calls.some((c) => c.args.join(" ").includes("--force-with-lease"))).toBe(false);
    expect(calls.some((c) => c.args.join(" ").startsWith("push --force"))).toBe(false);
  });
});
