import { describe, expect, it } from "bun:test";

import { classifyLostUpdateEvidence, createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";

describe("createLostUpdateAuditPlan", () => {
  it("returns the read-only evidence commands for a suspected lost update", () => {
    const plan = createLostUpdateAuditPlan({ issueNumber: 85, baseBranch: "main", suspectedBranch: "issue/85-x" });

    expect(plan.issueNumber).toBe(85);
    expect(plan.baseBranch).toBe("main");
    expect(plan.suspectedBranch).toBe("issue/85-x");
    expect(plan.steps).toEqual([
      {
        kind: "visible_branch_topology",
        title: "Visible branch topology",
        command: "git log --graph --decorate --oneline --all --boundary",
        readOnly: true,
      },
      {
        kind: "remote_tracking_reflog",
        title: "Remote-tracking reflog",
        command: "git reflog show --date=iso origin/main",
        readOnly: true,
      },
      {
        kind: "pr_history",
        title: "PR history",
        command: "gh pr list --state all --search issue/85",
        readOnly: true,
      },
      {
        kind: "lifecycle_issue_comments",
        title: "Lifecycle issue comments",
        command: "gh issue view 85 --comments",
        readOnly: true,
      },
    ]);
    expect(plan.limitation).toContain("read-only/evidence-based");
    expect(plan.limitation).toContain("cannot prove absence of force-push without provider audit logs");
  });
});

describe("classifyLostUpdateEvidence", () => {
  it("prioritizes force-push evidence as high severity", () => {
    expect(classifyLostUpdateEvidence({ forcePush: true, squashMerge: true })).toEqual({
      kind: "force-push",
      severity: "high",
    });
  });

  it("classifies medium-severity lost update causes by priority", () => {
    expect(classifyLostUpdateEvidence({ squashMerge: true, semanticOverwrite: true })).toEqual({
      kind: "squash",
      severity: "medium",
    });
    expect(classifyLostUpdateEvidence({ semanticOverwrite: true, manualRemoteMutation: true })).toEqual({
      kind: "semantic-overwrite",
      severity: "medium",
    });
    expect(classifyLostUpdateEvidence({ manualRemoteMutation: true, pushRejectionRace: true })).toEqual({
      kind: "manual-remote-mutation",
      severity: "medium",
    });
    expect(classifyLostUpdateEvidence({ pushRejectionRace: true })).toEqual({
      kind: "push-rejection-race",
      severity: "medium",
    });
  });

  it("returns inconclusive when evidence is absent", () => {
    expect(classifyLostUpdateEvidence({})).toEqual({ kind: "inconclusive", severity: "low" });
  });
});
