import { describe, expect, it } from "bun:test";

import { atlasCompilerAgent } from "@/agents/atlas-compiler";

describe("atlas-compiler agent", () => {
  it("declares subagent mode", () => {
    expect(atlasCompilerAgent.mode).toBe("subagent");
  });

  it("describes the agent's role and constraints", () => {
    expect(atlasCompilerAgent.description?.toLowerCase()).toContain("atlas");
    expect(atlasCompilerAgent.prompt).toContain("agent2");
    expect(atlasCompilerAgent.prompt).toContain("staging");
    expect(atlasCompilerAgent.prompt).toContain("challenge");
    expect(atlasCompilerAgent.prompt).toContain("mtime");
    expect(atlasCompilerAgent.prompt).toContain("atlas:");
  });

  it("forbids self-modification of _meta logs and challenges", () => {
    expect(atlasCompilerAgent.prompt).toContain("must not modify");
    expect(atlasCompilerAgent.prompt).toContain("_meta");
  });
});
