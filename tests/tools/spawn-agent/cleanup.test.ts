import { describe, expect, it } from "bun:test";
import { cleanupGeneration } from "@/tools/spawn-agent/cleanup";
import { createSpawnSessionRegistry } from "@/tools/spawn-agent/spawn-session-registry";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

function fakeCtx(deleteImpl: (id: string) => Promise<void>) {
  return {
    directory: "/tmp",
    client: {
      session: {
        delete: async (req: { path: { id: string } }) => deleteImpl(req.path.id),
      },
    },
  } as unknown as Parameters<typeof cleanupGeneration>[0]["ctx"];
}

const baseRecord = {
  agent: "implementer-backend",
  description: "x",
  ownerSessionId: "owner",
  runId: "run-A",
  generation: 1,
  taskIdentity: "task-A",
};

describe("cleanupGeneration", () => {
  it("aborts and deletes all running children of the generation", async () => {
    const registry = createSpawnSessionRegistry({ maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 });
    registry.registerRunning({ ...baseRecord, sessionId: "s1" });
    registry.registerRunning({ ...baseRecord, sessionId: "s2", taskIdentity: "task-B" });
    const deleted: string[] = [];
    const result = await cleanupGeneration({
      ctx: fakeCtx(async (id) => {
        deleted.push(id);
      }),
      registry,
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      reason: "supersede",
    });
    expect(result.aborted).toBe(2);
    expect(result.deleted).toBe(2);
    expect(deleted.sort()).toEqual(["s1", "s2"]);
  });

  it("does not touch preserved records belonging to the generation", async () => {
    const registry = createSpawnSessionRegistry({ maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 });
    registry.registerRunning({ ...baseRecord, sessionId: "s1" });
    registry.markPreserved("s1", SPAWN_OUTCOMES.TASK_ERROR);
    const deleted: string[] = [];
    const result = await cleanupGeneration({
      ctx: fakeCtx(async (id) => {
        deleted.push(id);
      }),
      registry,
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      reason: "supersede",
    });
    expect(result.aborted).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("counts delete failures separately and does not throw", async () => {
    const registry = createSpawnSessionRegistry({ maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 });
    registry.registerRunning({ ...baseRecord, sessionId: "s1" });
    registry.registerRunning({ ...baseRecord, sessionId: "s2" });
    const result = await cleanupGeneration({
      ctx: fakeCtx(async (id) => {
        if (id === "s1") throw new Error("delete failed");
      }),
      registry,
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      reason: "test",
    });
    expect(result.aborted).toBe(2);
    expect(result.deleted).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sessionId).toBe("s1");
  });

  it("handles missing client.session.delete gracefully (returns deleted=0)", async () => {
    const registry = createSpawnSessionRegistry({ maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 });
    registry.registerRunning({ ...baseRecord, sessionId: "s1" });
    const ctx = { directory: "/tmp", client: { session: {} } } as unknown as Parameters<
      typeof cleanupGeneration
    >[0]["ctx"];
    const result = await cleanupGeneration({
      ctx,
      registry,
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      reason: "test",
    });
    expect(result.aborted).toBe(1);
    expect(result.deleted).toBe(0);
    expect(result.failures.length).toBe(1);
  });
});
