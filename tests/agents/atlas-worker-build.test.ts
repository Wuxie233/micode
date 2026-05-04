import { describe, expect, it } from "bun:test";

import { atlasWorkerBuildAgent } from "@/agents/atlas-worker-build";

describe("atlas-worker-build agent", () => {
  it("is a subagent", () => {
    expect(atlasWorkerBuildAgent.mode).toBe("subagent");
  });

  it("focuses on the Build layer and module map", () => {
    expect(atlasWorkerBuildAgent.prompt.toLowerCase()).toContain("build layer");
    expect(atlasWorkerBuildAgent.prompt).toContain("10-impl");
    expect(atlasWorkerBuildAgent.prompt).toContain("source pointer");
  });

  it("instructs worker to emit claims, not write directly", () => {
    expect(atlasWorkerBuildAgent.prompt).toContain("emit claims");
    expect(atlasWorkerBuildAgent.prompt).toContain("do not write");
  });
});
