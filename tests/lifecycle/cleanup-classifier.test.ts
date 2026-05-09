import { describe, expect, it } from "bun:test";

import { type CleanupQuery, classifyCleanup } from "@/lifecycle/cleanup-classifier";

const baseQuery: CleanupQuery = {
  worktreeExists: true,
  branchMerged: true,
  issueClosed: true,
  workingTreeStatus: "",
  untrackedPaths: [],
  worktreeIsRegistered: true,
  worktreeIsExternalClone: false,
};

describe("classifyCleanup", () => {
  it("returns kind=clean when worktree is registered, merged, closed, and tree is empty", () => {
    expect(classifyCleanup(baseQuery)).toEqual({
      kind: "clean",
      reason: "worktree merged, issue closed, working tree empty",
    });
  });

  it("returns kind=missing when worktree directory does not exist", () => {
    expect(classifyCleanup({ ...baseQuery, worktreeExists: false })).toEqual({
      kind: "missing",
      reason: "worktree path does not exist on disk",
    });
  });

  it("returns kind=dirty when working tree has tracked modifications", () => {
    const result = classifyCleanup({ ...baseQuery, workingTreeStatus: " M src/foo.ts\n" });
    expect(result.kind).toBe("dirty");
    expect(result.reason).toContain("src/foo.ts");
  });

  it("returns kind=has-user-work when issue is still open even if tree is clean", () => {
    expect(classifyCleanup({ ...baseQuery, issueClosed: false }).kind).toBe("has-user-work");
  });

  it("returns kind=has-user-work when branch is not yet merged", () => {
    expect(classifyCleanup({ ...baseQuery, branchMerged: false }).kind).toBe("has-user-work");
  });

  it("returns kind=ambiguous when worktree only has untracked generated files", () => {
    const result = classifyCleanup({
      ...baseQuery,
      untrackedPaths: ["thoughts/shared/plans/foo.md"],
    });
    expect(result.kind).toBe("ambiguous");
    expect(result.reason).toContain("untracked");
  });

  it("returns kind=unknown-external when worktree is not registered with git", () => {
    expect(classifyCleanup({ ...baseQuery, worktreeIsRegistered: false, worktreeIsExternalClone: true }).kind).toBe(
      "unknown-external",
    );
  });

  it("never returns kind=clean if there are untracked paths", () => {
    const result = classifyCleanup({ ...baseQuery, untrackedPaths: ["foo.txt"] });
    expect(result.kind).not.toBe("clean");
  });
});
