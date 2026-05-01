import { describe, expect, it, mock } from "bun:test";

import { createPreservedRegistry } from "@/tools/spawn-agent/registry";
import { retitleStaleReviewSessions } from "@/tools/spawn-agent/retitle-stale-reviews";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const REGISTRY_OPTS = { maxResumes: 2, ttlHours: 1 } as const;

const FINAL_REVIEW = "Reviewed task 2.3.\nCHANGES REQUESTED: rename foo to bar.";
const FINAL_TEST_FAILED = "TEST FAILED: assertion 4 broke";
const NARRATIVE_REVIEW = "All passed. The reviewer would print 'CHANGES REQUESTED' if anything broke.";

describe("retitleStaleReviewSessions", () => {
  it("retitles and removes preserved reviewer sessions whose output is a final CHANGES REQUESTED", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_1",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const updateTitle = mock(async () => undefined);
    const readOutput = mock(async () => FINAL_REVIEW);

    const result = await retitleStaleReviewSessions({ registry, readOutput, updateTitle });

    expect(result.retitled).toEqual(["rev_1"]);
    expect(result.skipped).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(registry.get("rev_1")).toBeNull();
    expect(updateTitle).toHaveBeenCalledTimes(1);
    const call = updateTitle.mock.calls[0] as readonly [{ readonly sessionId: string; readonly title: string }];
    expect(call[0].sessionId).toBe("rev_1");
    expect(call[0].title).toBe("需修改: 审查 2.3");
  });

  it("skips preserved reviewer sessions whose output is a real TEST FAILED execution failure", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_2",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const updateTitle = mock(async () => undefined);
    const readOutput = mock(async () => FINAL_TEST_FAILED);

    const result = await retitleStaleReviewSessions({ registry, readOutput, updateTitle });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_2"]);
    expect(registry.get("rev_2")).not.toBeNull();
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it("skips narrative CHANGES REQUESTED", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_3",
      agent: "reviewer",
      description: "审查 2.3",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => NARRATIVE_REVIEW,
      updateTitle: async () => undefined,
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_3"]);
  });

  it("ignores preserved BLOCKED records and non-reviewer agents", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_4",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.BLOCKED,
    });
    registry.preserve({
      sessionId: "impl_1",
      agent: "implementer-backend",
      description: "实现",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const updateTitle = mock(async () => undefined);

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => FINAL_REVIEW,
      updateTitle,
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(registry.get("rev_4")).not.toBeNull();
    expect(registry.get("impl_1")).not.toBeNull();
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it("collects updateTitle failures and leaves the registry record in place", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_5",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => FINAL_REVIEW,
      updateTitle: async () => {
        throw new Error("update boom");
      },
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_5"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sessionId).toBe("rev_5");
    expect(result.failures[0]?.error).toContain("update boom");
    expect(registry.get("rev_5")).not.toBeNull();
  });

  it("collects readOutput failures as skipped", async () => {
    const registry = createPreservedRegistry(REGISTRY_OPTS);
    registry.preserve({
      sessionId: "rev_6",
      agent: "reviewer",
      description: "审查",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });

    const result = await retitleStaleReviewSessions({
      registry,
      readOutput: async () => {
        throw new Error("read boom");
      },
      updateTitle: async () => undefined,
    });

    expect(result.retitled).toEqual([]);
    expect(result.skipped).toEqual(["rev_6"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.sessionId).toBe("rev_6");
  });
});
