import { describe, expect, it } from "bun:test";

import { classifyStale, type StaleProbe } from "@/lifecycle/recovery/stale-classifier";

const baseProbe = (overrides: Partial<StaleProbe> = {}): StaleProbe => ({
  issueNumber: 7,
  state: "in_progress",
  worktreeExists: true,
  worktreeIsRegistered: true,
  branchExists: true,
  branchMergedIntoBase: false,
  issueClosedOnGithub: false,
  ...overrides,
});

describe("classifyStale", () => {
  it("returns stale when GitHub issue is closed", () => {
    const result = classifyStale(baseProbe({ issueClosedOnGithub: true }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("issue_closed");
  });

  it("returns stale when worktree is missing on disk and not registered", () => {
    const result = classifyStale(baseProbe({ worktreeExists: false, worktreeIsRegistered: false }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("worktree_missing");
  });

  it("returns stale when branch is already merged into base", () => {
    const result = classifyStale(baseProbe({ branchMergedIntoBase: true }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("branch_merged");
  });

  it("returns stale when branch no longer exists locally or on remote", () => {
    const result = classifyStale(baseProbe({ branchExists: false }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("branch_missing");
  });

  it("returns NOT stale for an active in-progress lifecycle", () => {
    const result = classifyStale(baseProbe());
    expect(result.stale).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("treats terminal local states as stale (defensive: should not be in open list)", () => {
    const result = classifyStale(baseProbe({ state: "closed" }));
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("local_state_terminal");
  });
});
