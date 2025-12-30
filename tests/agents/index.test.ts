import { describe, it, expect } from "bun:test";

describe("agents index", () => {
  it("should not export handoff agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["handoff-creator"]).toBeUndefined();
    expect(module.agents["handoff-resumer"]).toBeUndefined();
    expect((module as Record<string, unknown>).handoffCreatorAgent).toBeUndefined();
    expect((module as Record<string, unknown>).handoffResumerAgent).toBeUndefined();
  });

  it("should still export other agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["ledger-creator"]).toBeDefined();
    expect(module.agents["brainstormer"]).toBeDefined();
    expect(module.agents["commander"]).toBeDefined();
  });
});
