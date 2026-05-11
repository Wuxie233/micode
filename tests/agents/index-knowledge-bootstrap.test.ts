import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("agents barrel: knowledge-bootstrap-orchestrator", () => {
  it("registers knowledge-bootstrap-orchestrator", () => {
    expect(agents["knowledge-bootstrap-orchestrator"]).toBeDefined();
  });

  it("knowledge-bootstrap-orchestrator is primary mode", () => {
    expect(agents["knowledge-bootstrap-orchestrator"].mode).toBe("primary");
  });

  it("preserves project-initializer, mm-orchestrator, atlas-initializer registrations", () => {
    expect(agents["project-initializer"]).toBeDefined();
    expect(agents["mm-orchestrator"]).toBeDefined();
    expect(agents["atlas-initializer"]).toBeDefined();
  });
});
