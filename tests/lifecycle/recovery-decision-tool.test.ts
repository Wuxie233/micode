import { describe, expect, it } from "bun:test";

import type { LifecycleHandle } from "@/lifecycle";
import { RECOVERY_SECTION_HEADER } from "@/lifecycle/recovery/hint-format";
import { RECOVERY_DECISION_KINDS, type RecoveryDecision } from "@/lifecycle/recovery/types";
import { createLifecycleRecoveryDecisionTool } from "@/tools/lifecycle/recovery-decision";

const ISSUE_NUMBER = 67;
const OWNER = "session-a";

const fakeHandle = (decision: RecoveryDecision): Pick<LifecycleHandle, "decideRecovery"> => ({
  decideRecovery: async () => decision,
});

const executeTool = async (decision: RecoveryDecision): Promise<string> => {
  const tool = createLifecycleRecoveryDecisionTool(fakeHandle(decision));
  return tool.execute({ issue_number: ISSUE_NUMBER, owner: OWNER }, {} as never);
};

describe("lifecycle_recovery_decision tool recovery hints", () => {
  it("appends an ask_user recovery hint when recovery is blocked", async () => {
    const output = await executeTool({
      kind: RECOVERY_DECISION_KINDS.BLOCKED,
      reason: "branch_mismatch",
      detail: "expected issue/67-fix, found main",
      lastSeq: 3,
    });

    expect(output).toContain("**kind:** `blocked`");
    expect(output).toContain(RECOVERY_SECTION_HEADER);
    expect(output).toContain("**failure_kind:** `unknown`");
    expect(output).toContain("**recommended_next_action:** `ask_user`");
    expect(output).toContain("**issue_number:** `67`");
    expect(output).toContain("**summary:** branch_mismatch: expected issue/67-fix, found main");
  });

  it("does not append a recovery hint for clean_resume", async () => {
    const output = await executeTool({
      kind: RECOVERY_DECISION_KINDS.CLEAN_RESUME,
      nextBatchId: "4",
      lastSeq: 3,
    });

    expect(output).toContain("**kind:** `clean_resume`");
    expect(output).not.toContain(RECOVERY_SECTION_HEADER);
  });

  it("does not append a recovery hint for partial_resume", async () => {
    const output = await executeTool({
      kind: RECOVERY_DECISION_KINDS.PARTIAL_RESUME,
      completedBatches: ["1", "2"],
      pendingBatchId: "3",
      note: "batch 3 dispatched but not completed",
      lastSeq: 5,
    });

    expect(output).toContain("**kind:** `partial_resume`");
    expect(output).not.toContain(RECOVERY_SECTION_HEADER);
  });
});
