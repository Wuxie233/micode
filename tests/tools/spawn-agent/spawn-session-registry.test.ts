import { describe, expect, it } from "bun:test";
import { createSpawnSessionRegistry, SPAWN_RECORD_STATES } from "@/tools/spawn-agent/spawn-session-registry";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const baseOptions = { maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 } as const;

describe("createSpawnSessionRegistry", () => {
  it("registers a running child and looks it up by session id", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    const record = registry.registerRunning({
      sessionId: "s1",
      agent: "implementer-backend",
      description: "Task 2.1",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    expect(record.state).toBe(SPAWN_RECORD_STATES.RUNNING);
    expect(registry.get("s1")?.state).toBe(SPAWN_RECORD_STATES.RUNNING);
  });

  it("transitions running to preserved with outcome and resume metadata", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "reviewer",
      description: "Review 2.1",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "review-2.1",
    });
    const preserved = registry.markPreserved("s1", SPAWN_OUTCOMES.TASK_ERROR);
    expect(preserved?.state).toBe(SPAWN_RECORD_STATES.PRESERVED);
    expect(preserved?.outcome).toBe(SPAWN_OUTCOMES.TASK_ERROR);
    expect(preserved?.resumeCount).toBe(0);
  });

  it("removes the record entirely when complete is called", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "implementer-general",
      description: "1.1",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-1.1",
    });
    registry.complete("s1");
    expect(registry.get("s1")).toBeNull();
  });

  it("increments resume count up to maxResumes", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "implementer-frontend",
      description: "ui",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "ui-task",
    });
    registry.markPreserved("s1", SPAWN_OUTCOMES.BLOCKED);
    expect(registry.incrementResume("s1")).toBe(1);
    expect(registry.incrementResume("s1")).toBe(2);
    expect(registry.incrementResume("s1")).toBe(3);
    expect(registry.incrementResume("s1")).toBe(3);
  });

  it("findActiveByTaskIdentity ignores aborted and preserved records", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "implementer-backend",
      description: "2.1",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-2.1",
    });
    registry.registerRunning({
      sessionId: "s2",
      agent: "implementer-backend",
      description: "2.1",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-other",
    });
    registry.markAborted("s2", "test");
    const active = registry.findActiveByTaskIdentity({ ownerSessionId: "owner", taskIdentity: "task-2.1" });
    expect(active.map((r) => r.sessionId)).toEqual(["s1"]);
  });

  it("aborts running records belonging to a generation but leaves preserved alone", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "t1",
    });
    registry.registerRunning({
      sessionId: "s2",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "t2",
    });
    registry.markPreserved("s2", SPAWN_OUTCOMES.TASK_ERROR);
    const aborted = registry.abortGeneration({
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      reason: "supersede",
    });
    expect(aborted.map((r) => r.sessionId)).toEqual(["s1"]);
    expect(registry.get("s2")?.state).toBe(SPAWN_RECORD_STATES.PRESERVED);
  });

  it("isolates generation aborts and active lookup by owner session", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "owner-a",
      runId: "run-A",
      generation: 1,
      taskIdentity: "shared-task",
    });
    registry.registerRunning({
      sessionId: "s2",
      agent: "x",
      description: "d",
      ownerSessionId: "owner-b",
      runId: "run-A",
      generation: 1,
      taskIdentity: "shared-task",
    });

    const aborted = registry.abortGeneration({
      ownerSessionId: "owner-a",
      runId: "run-A",
      generation: 1,
      reason: "supersede",
    });

    expect(aborted.map((r) => r.sessionId)).toEqual(["s1"]);
    expect(registry.get("s1")?.state).toBe(SPAWN_RECORD_STATES.ABORTED);
    expect(registry.get("s2")?.state).toBe(SPAWN_RECORD_STATES.RUNNING);
    expect(registry.findActiveByTaskIdentity({ ownerSessionId: "owner-a", taskIdentity: "shared-task" })).toEqual([]);
    expect(
      registry
        .findActiveByTaskIdentity({ ownerSessionId: "owner-b", taskIdentity: "shared-task" })
        .map((r) => r.sessionId),
    ).toEqual(["s2"]);
  });

  it("listPreserved returns only preserved records", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "r",
      generation: 1,
      taskIdentity: "t1",
    });
    registry.markPreserved("s1", SPAWN_OUTCOMES.BLOCKED);
    registry.registerRunning({
      sessionId: "s2",
      agent: "x",
      description: "d",
      ownerSessionId: "owner",
      runId: "r",
      generation: 1,
      taskIdentity: "t2",
    });
    expect(registry.listPreserved().map((r) => r.sessionId)).toEqual(["s1"]);
  });

  it("sweep removes preserved records older than ttlHours and aborted records too", () => {
    const registry = createSpawnSessionRegistry({ ...baseOptions, ttlHours: 0.0001, runningTtlMs: 1 });
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      taskIdentity: "t",
    });
    registry.markPreserved("s1", SPAWN_OUTCOMES.TASK_ERROR);
    const removed = registry.sweep(Date.now() + 60_000);
    expect(removed).toBe(1);
    expect(registry.get("s1")).toBeNull();
  });

  it("sweep removes aborted records older than ttlHours", () => {
    const registry = createSpawnSessionRegistry({ ...baseOptions, ttlHours: 0.0001 });
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      taskIdentity: "t",
    });
    registry.markAborted("s1", "supersede");

    const removed = registry.sweep(Date.now() + 60_000);

    expect(removed).toBe(1);
    expect(registry.get("s1")).toBeNull();
  });

  it("sweep also expires stale running records as aborted then removes them", () => {
    const registry = createSpawnSessionRegistry({ ...baseOptions, runningTtlMs: 1 });
    registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "d",
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      taskIdentity: "t",
    });
    const removed = registry.sweep(Date.now() + 1000);
    expect(removed).toBe(1);
    expect(registry.get("s1")).toBeNull();
  });

  it("returns cloned records so callers cannot mutate registry state", () => {
    const registry = createSpawnSessionRegistry(baseOptions);
    const registered = registry.registerRunning({
      sessionId: "s1",
      agent: "x",
      description: "original",
      ownerSessionId: "owner",
      runId: "run-A",
      generation: 1,
      taskIdentity: "task-1",
    });
    Object.assign(registered, { description: "changed registered" });
    expect(registry.get("s1")?.description).toBe("original");

    const active = registry.findActiveByTaskIdentity({ ownerSessionId: "owner", taskIdentity: "task-1" });
    Object.assign(active[0], { description: "changed active" });
    expect(registry.get("s1")?.description).toBe("original");

    const generation = registry.listByGeneration({ ownerSessionId: "owner", runId: "run-A", generation: 1 });
    Object.assign(generation[0], { description: "changed generation" });
    expect(registry.get("s1")?.description).toBe("original");

    const preserved = registry.markPreserved("s1", SPAWN_OUTCOMES.BLOCKED);
    if (!preserved) throw new Error("Expected preserved record");
    Object.assign(preserved, { description: "changed preserved" });
    expect(registry.get("s1")?.description).toBe("original");

    const listed = registry.listPreserved();
    Object.assign(listed[0], { description: "changed listed" });
    expect(registry.get("s1")?.description).toBe("original");
  });
});
