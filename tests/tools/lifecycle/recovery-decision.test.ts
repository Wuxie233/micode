import { describe, expect, it } from "bun:test";

import type { LifecycleHandle } from "@/lifecycle";
import { RECOVERY_DECISION_KINDS, type RecoveryDecision } from "@/lifecycle/recovery/types";
import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";

const fakeHandle = (decision: RecoveryDecision): Pick<LifecycleHandle, "decideRecovery"> => ({
  decideRecovery: async () => decision,
});

describe("lifecycle_recovery_decision tool", () => {
  it("formats a clean_resume decision", async () => {
    const tool = createLifecycleRecoveryDecisionTool(
      fakeHandle({ kind: RECOVERY_DECISION_KINDS.CLEAN_RESUME, nextBatchId: null, lastSeq: 0 }) as LifecycleHandle,
    );
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("clean_resume");
  });

  it("formats a blocked decision with reason", async () => {
    const tool = createLifecycleRecoveryDecisionTool(
      fakeHandle({
        kind: RECOVERY_DECISION_KINDS.BLOCKED,
        reason: "branch_mismatch",
        detail: "expected issue/10-x, found main",
        lastSeq: 3,
      }) as LifecycleHandle,
    );
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("blocked");
    expect(output).toContain("branch_mismatch");
    expect(output).toContain("expected issue/10-x");
  });

  it("returns failure header when handle throws", async () => {
    const tool = createLifecycleRecoveryDecisionTool({
      decideRecovery: async () => {
        throw new Error("kaboom");
      },
    } as LifecycleHandle);
    const output = await tool.execute({ issue_number: 10, owner: "session-a" }, {} as never);
    expect(output).toContain("failed");
    expect(output).toContain("kaboom");
  });
});
