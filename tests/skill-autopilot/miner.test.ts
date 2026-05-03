import { describe, expect, it } from "bun:test";

import { extractRawCandidates } from "@/skill-autopilot/miner";

describe("extractRawCandidates", () => {
  it("emits a candidate when a lifecycle review_completed event approves and batches exist", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 27,
      lifecycleRecord: "## Request\n\nDeploy CI\n\n## Constraints\n- ok",
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "ran lint" } as never,
        { kind: "batch_completed", summary: "ran tests" } as never,
      ],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(1);
    expect(mined.candidates[0]?.steps).toEqual(["ran lint", "ran tests"]);
  });

  it("emits nothing when review was not approved", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 27,
      lifecycleRecord: null,
      journalEvents: [{ kind: "batch_completed", summary: "x" } as never],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(0);
  });
});
