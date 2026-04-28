import { describe, expect, it } from "bun:test";

import { RECOVERY_DECISION_KINDS, type RecoveryDecision } from "@/lifecycle/recovery/types";

describe("recovery decision types", () => {
  it("exposes the documented decision kinds", () => {
    expect(Object.values(RECOVERY_DECISION_KINDS).sort()).toEqual([
      "blocked",
      "clean_resume",
      "partial_resume",
      "reconciled_resume",
    ]);
  });

  it("compiles a blocked decision", () => {
    const decision: RecoveryDecision = {
      kind: RECOVERY_DECISION_KINDS.BLOCKED,
      reason: "branch_mismatch",
      detail: "expected issue/10-x, found main",
      lastSeq: 4,
    };
    expect(decision.kind).toBe("blocked");
  });

  it("compiles a reconciled resume decision", () => {
    const decision: RecoveryDecision = {
      kind: RECOVERY_DECISION_KINDS.RECONCILED_RESUME,
      backfilledBatches: ["1", "2"],
      nextBatchId: "3",
      lastSeq: 7,
    };
    expect(decision.backfilledBatches).toEqual(["1", "2"]);
  });
});
