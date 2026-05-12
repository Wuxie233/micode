import { describe, expect, it } from "bun:test";

import { runCleanup } from "@/lifecycle/cleanup-policy";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

interface Captured {
  readonly mkdirs: string[];
  readonly renames: Array<{ from: string; to: string }>;
}

const fakeRunner = (status: string, untracked: string): LifecycleRunner => ({
  git: async (args) => {
    const key = args.join(" ");
    if (key.startsWith("worktree list")) return OK("worktree /r/wt\n");
    if (key.startsWith("status --porcelain")) return OK(status);
    if (key.startsWith("ls-files --others")) return OK(untracked);
    if (key.startsWith("worktree remove")) return OK();
    if (key.startsWith("worktree prune")) return OK();
    return OK();
  },
  gh: async () => OK(),
});

describe("runCleanup with quarantine", () => {
  it("quarantines lifecycle-owned untracked artifacts then succeeds", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    const outcome = await runCleanup(fakeRunner("", "thoughts/shared/designs/x.md\nthoughts/shared/plans/y.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: {
        mkdir: (p) => captured.mkdirs.push(p),
        rename: (from, to) => captured.renames.push({ from, to }),
      },
      now: () => new Date("2026-05-12T10:00:00Z"),
    });
    expect(outcome.kind).toBe("removed");
    expect(captured.renames.length).toBe(2);
    expect(captured.renames[0].to.startsWith("/r/thoughts/lifecycle/backups/issue-67/")).toBe(true);
    expect(captured.renames[0].to.endsWith("thoughts/shared/designs/x.md")).toBe(true);
    expect(outcome.reason).toContain("quarantined 2");
  });

  it("blocks when an untracked file looks like a secret or unknown user work", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    const outcome = await runCleanup(fakeRunner("", "src/new-feature.ts\nthoughts/shared/designs/x.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: { mkdir: (p) => captured.mkdirs.push(p), rename: (from, to) => captured.renames.push({ from, to }) },
    });
    expect(outcome.kind).toBe("blocked-ambiguous");
    expect(captured.renames.length).toBe(0);
    expect(outcome.reason).toContain("unknown_untracked");
  });

  it("never deletes untracked files (rename only, no rm)", async () => {
    const captured: Captured = { mkdirs: [], renames: [] };
    await runCleanup(fakeRunner("", "thoughts/shared/designs/x.md\n"), {
      cwd: "/r",
      worktree: "/r/wt",
      branch: "issue/67-x",
      baseBranch: "main",
      issueClosed: true,
      branchMerged: true,
      issueNumber: 67,
      artifactPointers: [],
      worktreeExistsOnDisk: true,
      fsOps: { mkdir: (p) => captured.mkdirs.push(p), rename: (from, to) => captured.renames.push({ from, to }) },
    });
    // We don't shell out to rm; only rename
    expect(captured.renames.length).toBe(1);
  });
});
