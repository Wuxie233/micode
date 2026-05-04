import { describe, expect, it } from "bun:test";

import { extractRawCandidates } from "@/skill-autopilot/miner";

describe("extractRawCandidates", () => {
  it("never uses lifecycle Request first line verbatim as a trigger", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: "## Request\n\nSkill Autopilot Native Alignment\n\n## Constraints\n- ok",
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "Add token-aware truncation hook" } as never,
        { kind: "batch_completed", summary: "Run bun run check before commit" } as never,
      ],
      ledgers: [],
    });

    for (const candidate of mined.candidates) {
      expect(candidate.trigger).not.toBe("Skill Autopilot Native Alignment");
    }
  });

  it("emits a lifecycle candidate only when first batch summary is substantive", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: "## Request\n\nDeploy CI\n\n## Constraints\n- ok",
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "Add token-aware truncation hook" } as never,
        { kind: "batch_completed", summary: "Run bun run check before commit" } as never,
      ],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(1);
    expect(mined.candidates[0]?.trigger).toBe("Add token-aware truncation hook");
    expect(mined.candidates[0]?.steps).toEqual(["Run bun run check before commit"]);
  });

  it("rejects lifecycle drafts whose first step is lifecycle-tooling-shaped", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: null,
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "executor dispatch ran" } as never,
        { kind: "batch_completed", summary: "lifecycle workflow finished" } as never,
      ],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(0);
  });

  it("emits nothing when review was not approved", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: null,
      journalEvents: [{ kind: "batch_completed", summary: "Add a hook" } as never],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(0);
  });

  it("emits a candidate from a substantive ledger procedure when the parser exposes one", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: null,
      lifecycleRecord: null,
      journalEvents: [],
      ledgers: [
        {
          path: "thoughts/ledgers/CONTINUITY_2026-05-04.md",
          text: "## Procedures\n\n- Add token-aware truncation hook; verify with bun test\n",
        },
      ],
    });

    expect(mined.candidates.length).toBe(1);
    expect(mined.candidates[0]?.trigger.startsWith("Add")).toBe(true);
    expect(mined.candidates[0]?.steps).toEqual(["verify with bun test"]);
  });
});
