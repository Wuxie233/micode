import { describe, expect, it } from "bun:test";
import { evaluateFence, FENCE_DECISIONS } from "@/tools/spawn-agent/generation-fence";
import { createSpawnSessionRegistry } from "@/tools/spawn-agent/spawn-session-registry";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const baseOptions = { maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 } as const;

const baseQuery = {
  ownerSessionId: "owner",
  runId: "run-B",
  generation: 2,
  taskIdentity: "task-2.1",
};

describe("evaluateFence", () => {
  it("returns launch when no matching record exists", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    expect(evaluateFence(registry, baseQuery)).toEqual({
      decision: FENCE_DECISIONS.LAUNCH,
      conflictSessionId: null,
    });
  });

  it("returns launch when only same-generation records exist", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-B",
      generation: 2,
      taskIdentity: "task-2.1",
    });
    expect(evaluateFence(registry, baseQuery).decision).toBe(FENCE_DECISIONS.LAUNCH);
  });

  it("returns duplicate_running when an older generation has a running record", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s-old",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    expect(evaluateFence(registry, baseQuery)).toEqual({
      decision: FENCE_DECISIONS.DUPLICATE_RUNNING,
      conflictSessionId: "s-old",
    });
  });

  it("returns duplicate_preserved when an older generation left a preserved record", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s-old",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    registry.markPreserved("s-old", SPAWN_OUTCOMES.BLOCKED);
    expect(evaluateFence(registry, baseQuery)).toEqual({
      decision: FENCE_DECISIONS.DUPLICATE_PRESERVED,
      conflictSessionId: "s-old",
    });
  });

  it("ignores aborted records and returns launch", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s-old",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    registry.markAborted("s-old", "supersede");
    expect(evaluateFence(registry, baseQuery).decision).toBe(FENCE_DECISIONS.LAUNCH);
  });

  it("does not match across owner sessions", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s-foreign",
      agent: "x",
      description: "d",
      ownerSessionId: "OTHER-OWNER",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    expect(evaluateFence(registry, baseQuery).decision).toBe(FENCE_DECISIONS.LAUNCH);
  });
});
