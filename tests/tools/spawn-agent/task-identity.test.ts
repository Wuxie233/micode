import { describe, expect, it } from "bun:test";
import { deriveTaskIdentity, IDENTITY_SOURCES } from "@/tools/spawn-agent/task-identity";

describe("deriveTaskIdentity", () => {
  it("uses explicit metadata when present", () => {
    const prompt = `<spawn-meta task-id="task-2.1" run-id="run-A" generation="2" />\nDo the work.`;
    const id = deriveTaskIdentity({
      agent: "implementer-backend",
      description: "Task 2.1",
      prompt,
      ownerSessionId: "owner",
    });
    expect(id).toEqual({
      taskIdentity: "task-2.1",
      runId: "run-A",
      generation: 2,
      source: IDENTITY_SOURCES.EXPLICIT,
    });
  });

  it("falls back to hash and owner-derived run id when metadata absent", () => {
    const id = deriveTaskIdentity({
      agent: "implementer-frontend",
      description: "ui card",
      prompt: "do the thing",
      ownerSessionId: "owner-xyz",
    });
    expect(id.source).toBe(IDENTITY_SOURCES.INFERRED);
    expect(id.runId).toBe("owner-xyz");
    expect(id.generation).toBe(1);
    expect(id.taskIdentity).toMatch(/^[a-f0-9]{64}$/);
  });

  it("hash is stable for same agent + description", () => {
    const a = deriveTaskIdentity({
      agent: "implementer-backend",
      description: "Task 2.1",
      prompt: "x",
      ownerSessionId: "o",
    });
    const b = deriveTaskIdentity({
      agent: "implementer-backend",
      description: "Task 2.1",
      prompt: "y",
      ownerSessionId: "o",
    });
    expect(a.taskIdentity).toBe(b.taskIdentity);
  });

  it("ignores malformed generation values and defaults to 1", () => {
    const prompt = `<spawn-meta task-id="t" run-id="r" generation="abc" />`;
    const id = deriveTaskIdentity({
      agent: "x",
      description: "d",
      prompt,
      ownerSessionId: "o",
    });
    expect(id.generation).toBe(1);
  });

  it("rejects empty task-id and falls back to hash", () => {
    const prompt = `<spawn-meta task-id="" run-id="r" generation="1" />`;
    const id = deriveTaskIdentity({
      agent: "x",
      description: "d",
      prompt,
      ownerSessionId: "o",
    });
    expect(id.source).toBe(IDENTITY_SOURCES.INFERRED);
  });
});
