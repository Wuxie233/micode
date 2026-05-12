import { describe, expect, it } from "bun:test";

import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import {
  computeTempWorktreePath,
  createTempMergeWorktree,
  readMergeConflicts,
  removeTempMergeWorktree,
} from "@/lifecycle/recovery/temp-worktree";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
}

const recorder = (results: readonly RunResult[]): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  let i = 0;
  const runner: LifecycleRunner = {
    git: async (args) => {
      calls.push({ bin: "git", args });
      const r = results[i] ?? ok();
      i += 1;
      return r;
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
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
  it("issues `git worktree add <path> <baseBranch>` and returns path on success", async () => {
    const { runner, calls } = recorder([ok()]);
    const result = await createTempMergeWorktree(runner, {
      repoRoot: "/r/micode",
      issueNumber: 67,
      baseBranch: "main",
      tmpDir: "/tmp",
    });
    expect(result.kind).toBe("created");
    if (result.kind !== "created") throw new Error("type narrow");
    expect(result.path).toBe("/tmp/micode-merge-issue-67");
    expect(calls[0]?.args).toEqual(["worktree", "add", "/tmp/micode-merge-issue-67", "main"]);
  });

  it("returns failed when git worktree add fails", async () => {
    const { runner } = recorder([fail("path exists")]);
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
  it("returns conflict files from git status --porcelain UU/AA/DD lines", async () => {
    const { runner } = recorder([
      ok("UU src/a.ts\nAA src/b.ts\n M src/c.ts\nDD src/d.ts\n?? untracked.ts\n"),
    ]);
    const files = await readMergeConflicts(runner, "/tmp/wt");
    expect(files).toEqual(["src/a.ts", "src/b.ts", "src/d.ts"]);
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
