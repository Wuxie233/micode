import { describe, expect, it } from "bun:test";

import { atlasWorkerBehaviorAgent } from "@/agents/atlas-worker-behavior";

describe("atlas-worker-behavior agent", () => {
  it("is a subagent", () => {
    expect(atlasWorkerBehaviorAgent.mode).toBe("subagent");
  });

  it("focuses on Behavior layer anchored to User Perspective", () => {
    expect(atlasWorkerBehaviorAgent.prompt.toLowerCase()).toContain("behavior layer");
    expect(atlasWorkerBehaviorAgent.prompt).toContain("20-behavior");
    expect(atlasWorkerBehaviorAgent.prompt).toContain("User Perspective");
  });

  it("forbids freeform code summaries", () => {
    expect(atlasWorkerBehaviorAgent.prompt).toContain("not a free-form code summary");
  });
});
