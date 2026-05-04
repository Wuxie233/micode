import { describe, expect, it } from "bun:test";

import { agents } from "@/agents/index";

describe("cold-init agent registration", () => {
  it("registers atlas-cold-build", () => {
    expect(agents["atlas-cold-build"]).toBeDefined();
  });

  it("registers atlas-cold-behavior", () => {
    expect(agents["atlas-cold-behavior"]).toBeDefined();
  });

  it("keeps the lifecycle-finish atlas-worker agents intact", () => {
    expect(agents["atlas-worker-build"]).toBeDefined();
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });
});
