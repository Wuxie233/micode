import { describe, expect, it } from "bun:test";
import { createPreservedRegistry, createPreservedRegistryOver } from "@/tools/spawn-agent/registry";
import { createSpawnSessionRegistry } from "@/tools/spawn-agent/spawn-session-registry";
import { SPAWN_OUTCOMES } from "@/tools/spawn-agent/types";

const opts = { maxResumes: 3, ttlHours: 24 };

describe("createPreservedRegistry (façade)", () => {
  it("preserves a record and reads it back", () => {
    const r = createPreservedRegistry(opts);
    const rec = r.preserve({
      sessionId: "s1",
      agent: "implementer-backend",
      description: "x",
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
    });
    expect(rec.sessionId).toBe("s1");
    expect(r.get("s1")?.outcome).toBe(SPAWN_OUTCOMES.TASK_ERROR);
  });

  it("upserts a preserved record for the same session id", () => {
    const r = createPreservedRegistry(opts);
    r.preserve({ sessionId: "s1", agent: "a", description: "old", outcome: SPAWN_OUTCOMES.TASK_ERROR });

    const rec = r.preserve({ sessionId: "s1", agent: "b", description: "new", outcome: SPAWN_OUTCOMES.BLOCKED });

    expect(rec.sessionId).toBe("s1");
    expect(rec.agent).toBe("b");
    expect(rec.description).toBe("new");
    expect(rec.outcome).toBe(SPAWN_OUTCOMES.BLOCKED);
    expect(r.get("s1")).toEqual(rec);
  });

  it("returns null for absent session id", () => {
    const r = createPreservedRegistry(opts);
    expect(r.get("missing")).toBeNull();
  });

  it("removes a record on remove()", () => {
    const r = createPreservedRegistry(opts);
    r.preserve({ sessionId: "s1", agent: "a", description: "d", outcome: SPAWN_OUTCOMES.BLOCKED });
    r.remove("s1");
    expect(r.get("s1")).toBeNull();
  });

  it("increments resume count up to maxResumes", () => {
    const r = createPreservedRegistry(opts);
    r.preserve({ sessionId: "s1", agent: "a", description: "d", outcome: SPAWN_OUTCOMES.BLOCKED });
    expect(r.incrementResume("s1")).toBe(1);
    expect(r.incrementResume("s1")).toBe(2);
    expect(r.incrementResume("s1")).toBe(3);
    expect(r.incrementResume("s1")).toBe(3);
  });

  it("sweep removes expired records", () => {
    const r = createPreservedRegistry({ maxResumes: 3, ttlHours: 0.0001 });
    r.preserve({ sessionId: "s1", agent: "a", description: "d", outcome: SPAWN_OUTCOMES.BLOCKED });
    expect(r.sweep(Date.now() + 60_000)).toBe(1);
    expect(r.size()).toBe(0);
  });
});

describe("createPreservedRegistryOver", () => {
  it("shares state with the underlying SpawnSessionRegistry", () => {
    const spawn = createSpawnSessionRegistry({ maxResumes: 3, ttlHours: 24, runningTtlMs: 60_000 });
    spawn.registerRunning({
      sessionId: "s1",
      agent: "a",
      description: "d",
      ownerSessionId: "o",
      runId: "r",
      generation: 1,
      taskIdentity: "t",
    });
    spawn.markPreserved("s1", SPAWN_OUTCOMES.TASK_ERROR);
    const facade = createPreservedRegistryOver(spawn, { maxResumes: 3, ttlHours: 24 });
    expect(facade.get("s1")?.sessionId).toBe("s1");
    facade.remove("s1");
    expect(spawn.get("s1")).toBeNull();
  });
});
