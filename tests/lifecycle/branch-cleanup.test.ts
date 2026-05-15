import { describe, expect, it } from "bun:test";

import { type BranchCleanupCandidate, classifyBranchCleanupCandidate } from "@/lifecycle/branch-cleanup";
import { REPO_KIND } from "@/lifecycle/pre-flight";

const candidate = (overrides: Partial<BranchCleanupCandidate>): BranchCleanupCandidate => ({
  branchName: "issue/81-hardening",
  scope: "local",
  remoteName: null,
  lifecycleRecordMatch: false,
  issueMarkerMatch: false,
  commitMarkerMatch: false,
  recoveryMarkerMatch: false,
  branchMerged: false,
  noDiffWithBase: false,
  registeredWorktreeMatch: false,
  activeWorktreePath: null,
  preflightKind: null,
  ...overrides,
});

describe("classifyBranchCleanupCandidate", () => {
  it("classifies lifecycle-owned merged issue/* branches as local prune candidates", () => {
    const decision = classifyBranchCleanupCandidate(candidate({ lifecycleRecordMatch: true, branchMerged: true }));

    expect(decision.kind).toBe("prune-local");
    expect(decision.reason).toContain("lifecycle-owned");
  });

  it("classifies lifecycle-owned remote branches as prune candidates when preflight is fork or own", () => {
    const forkDecision = classifyBranchCleanupCandidate(
      candidate({
        branchName: "origin/issue/81-hardening",
        scope: "remote",
        remoteName: "origin",
        issueMarkerMatch: true,
        branchMerged: true,
        preflightKind: REPO_KIND.FORK,
      }),
    );
    const ownDecision = classifyBranchCleanupCandidate(
      candidate({
        branchName: "origin/issue/82-other",
        scope: "remote",
        remoteName: "origin",
        issueMarkerMatch: true,
        noDiffWithBase: true,
        preflightKind: REPO_KIND.OWN,
      }),
    );

    expect(forkDecision.kind).toBe("prune-remote");
    expect(ownDecision.kind).toBe("prune-remote");
  });

  it("blocks owned remote branch pruning when preflight says upstream", () => {
    const decision = classifyBranchCleanupCandidate(
      candidate({
        branchName: "origin/issue/81-hardening",
        scope: "remote",
        remoteName: "origin",
        lifecycleRecordMatch: true,
        branchMerged: true,
        preflightKind: REPO_KIND.UPSTREAM,
      }),
    );

    expect(decision.kind).toBe("blocked-upstream");
  });

  it("blocks owned remote branch pruning when preflight is unknown", () => {
    const decision = classifyBranchCleanupCandidate(
      candidate({
        branchName: "origin/issue/81-hardening",
        scope: "remote",
        remoteName: "origin",
        lifecycleRecordMatch: true,
        branchMerged: true,
        preflightKind: REPO_KIND.UNKNOWN,
      }),
    );

    expect(decision.kind).toBe("blocked-upstream");
  });

  it("keeps branches currently used by any worktree active", () => {
    const decision = classifyBranchCleanupCandidate(
      candidate({ lifecycleRecordMatch: true, branchMerged: true, activeWorktreePath: "/tmp/issue-81" }),
    );

    expect(decision.kind).toBe("keep-active");
  });

  it("keeps non lifecycle-owned user branches", () => {
    const decision = classifyBranchCleanupCandidate(candidate({ branchName: "feature/user-work" }));

    expect(decision.kind).toBe("keep-user");
  });

  it("blocks ambiguous issue-like branches without ownership evidence", () => {
    const decision = classifyBranchCleanupCandidate(
      candidate({ branchName: "issue/81-hardening", branchMerged: true }),
    );

    expect(decision.kind).toBe("blocked-ambiguous");
  });

  it("requires rescue branches to have a recovery marker and merged/no-diff proof", () => {
    const missingMarker = classifyBranchCleanupCandidate(
      candidate({ branchName: "rescue/all-local/2026-05-16", branchMerged: true }),
    );
    const missingProof = classifyBranchCleanupCandidate(
      candidate({ branchName: "rescue/all-local/2026-05-16", recoveryMarkerMatch: true }),
    );
    const safe = classifyBranchCleanupCandidate(
      candidate({ branchName: "rescue/all-local/2026-05-16", recoveryMarkerMatch: true, noDiffWithBase: true }),
    );

    expect(missingMarker.kind).toBe("blocked-ambiguous");
    expect(missingProof.kind).toBe("blocked-ambiguous");
    expect(safe.kind).toBe("prune-local");
  });

  it("blocks lifecycle-owned branches with unmerged user commits", () => {
    const decision = classifyBranchCleanupCandidate(candidate({ lifecycleRecordMatch: true }));

    expect(decision.kind).toBe("blocked-ambiguous");
    expect(decision.reason).toContain("not proven merged or no-diff");
  });
});
