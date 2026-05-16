import { describe, expect, it } from "bun:test";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "@/lifecycle/recovery/temp-worktree";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const recorder = (results: readonly RunResult[]): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  let i = 0;
  const runner: LifecycleRunner = {
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const r = results[i] ?? ok();
      i += 1;
      return r;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return ok();
    },
  };
  return { runner, calls };
};

describe("computeTempWorktreePath", () => {
  it("uses /tmp/<repo>-merge-issue-<N> shape", () => {
    const path = computeTempWorktreePath({ repoRoot: "/home/user/CODE/micode", issueNumber: 67, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/micode-merge-issue-67");
  });

  it("falls back to repo basename when path has trailing slash", () => {
    const path = computeTempWorktreePath({ repoRoot: "/x/y/repo/", issueNumber: 5, tmpDir: "/tmp" });
    expect(path).toBe("/tmp/repo-merge-issue-5");
  });
});

describe("createTempMergeWorktree", () => {
  it("fetches origin baseBranch then adds a detached worktree from origin/baseBranch", async () => {
    const { runner, calls } = recorder([ok(), ok()]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("type narrow");
    expect(result.path).toBe("/tmp/micode-merge-issue-67");
    expect(calls).toEqual([
      { bin: "git", args: ["fetch", "origin", "main"], cwd: "/r/micode" },
      {
        bin: "git",
        args: ["worktree", "add", "--detach", "/tmp/micode-merge-issue-67", "origin/main"],
        cwd: "/r/micode",
      },
    ]);
  });

  it("does not pass the short local base branch to git worktree add", async () => {
    const { runner, calls } = recorder([ok(), ok()]);
    await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    const addCall = calls.find((c) => c.args[0] === "worktree" && c.args[1] === "add");
    expect(addCall?.args).toContain("origin/main");
    expect(addCall?.args).not.toContain("main");
  });

  it("returns failed and skips worktree add when fetch fails", async () => {
    const { runner, calls } = recorder([fail("couldn't find remote ref main")]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result).toEqual({
      kind: "failed",
      path: "/tmp/micode-merge-issue-67",
      reason: "couldn't find remote ref main",
    });
    expect(calls).toEqual([{ bin: "git", args: ["fetch", "origin", "main"], cwd: "/r/micode" }]);
  });

  it("returns failed when git worktree add fails", async () => {
    const { runner } = recorder([ok(), fail("path exists")]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("failed");
  });
});

describe("readMergeConflicts", () => {
  it("returns conflict files from git status --porcelain conflict lines", async () => {
    const { runner } = recorder([
      ok(
        "UU src/a.ts\nAA src/b.ts\n M src/c.ts\nDD src/d.ts\nAU src/e.ts\nUA src/f.ts\nDU src/g.ts\nUD src/h.ts\n?? untracked.ts\n",
      ),
    ]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/d.ts", "src/e.ts", "src/f.ts", "src/g.ts", "src/h.ts"]);
  });

  it("returns empty list when git status fails (caller decides what to do)", async () => {
    const { runner } = recorder([fail()]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual([]);
  });
});

describe("removeTempMergeWorktree", () => {
  it("issues `git worktree remove --force <path>` from repo root", async () => {
    const { runner, calls } = recorder([ok()]);
    await removeTempMergeWorktree(runner, { repoRoot: "/r/micode", path: "/tmp/micode-merge-issue-67" });
    expect(calls[0]?.args).toEqual(["worktree", "remove", "--force", "/tmp/micode-merge-issue-67"]);
  });
});
