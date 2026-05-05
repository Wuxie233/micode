import { describe, expect, it } from "bun:test";

import { atlasColdBuildAgent } from "@/agents/atlas-cold-build";

describe("atlas-cold-build prompt", () => {
  it("declares subagent mode", () => {
    expect(atlasColdBuildAgent.mode).toBe("subagent");
  });

  it("instructs the worker to write prose in Chinese while preserving machine syntax", () => {
    const prompt = atlasColdBuildAgent.prompt;
    expect(prompt).toMatch(/中文|Chinese/);
    expect(prompt).toContain("source pointer");
    expect(prompt).toContain("file path");
    expect(prompt).toContain("identifier");
  });

  it("constrains the worker to the Build layer", () => {
    expect(atlasColdBuildAgent.prompt).toContain("Build layer");
  });
});
