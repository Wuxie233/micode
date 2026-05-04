import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("agents barrel includes atlas agents", () => {
  it("registers atlas-compiler", () => {
    expect(agents["atlas-compiler"]).toBeDefined();
    expect(agents["atlas-compiler"].mode).toBe("subagent");
  });

  it("registers atlas-worker-build", () => {
    expect(agents["atlas-worker-build"]).toBeDefined();
  });

  it("registers atlas-worker-behavior", () => {
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });
});
