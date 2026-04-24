import { describe, expect, it } from "bun:test";

import { DEFAULT_MODEL } from "../../src/utils/config";

describe("domain-specific implementers", () => {
  it("registers implementer-frontend, implementer-backend, implementer-general", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["implementer-frontend"]).toBeDefined();
    expect(module.agents["implementer-backend"]).toBeDefined();
    expect(module.agents["implementer-general"]).toBeDefined();
  });

  it("removes the unsuffixed implementer from the registry", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.implementer).toBeUndefined();
  });

  it("configures all three domain implementers as subagents with DEFAULT_MODEL", async () => {
    const module = await import("../../src/agents/index");

    for (const name of ["implementer-frontend", "implementer-backend", "implementer-general"]) {
      const agent = module.agents[name];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("shares the base implementer prompt across all three variants", async () => {
    const module = await import("../../src/agents/implementer");
    const frontendModule = await import("../../src/agents/implementer-frontend");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    const basePrompt = module.BASE_IMPLEMENTER_PROMPT;
    expect(basePrompt.length).toBeGreaterThan(0);

    for (const agent of [
      frontendModule.implementerFrontendAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      expect(agent.prompt).toContain(basePrompt);
    }
  });

  it("frontend variant includes UI-specific constraints", async () => {
    const module = await import("../../src/agents/implementer-frontend");
    const prompt = module.implementerFrontendAgent.prompt ?? "";

    expect(prompt).toContain("Frontend");
    expect(prompt).toContain(".tsx");
    expect(prompt).toContain("components/");
  });

  it("backend variant includes server-side constraints", async () => {
    const module = await import("../../src/agents/implementer-backend");
    const prompt = module.implementerBackendAgent.prompt ?? "";

    expect(prompt).toContain("Backend");
    expect(prompt).toContain("src/api/");
    expect(prompt).toContain(".sql");
  });

  it("general variant describes cross-cutting scope", async () => {
    const module = await import("../../src/agents/implementer-general");
    const prompt = module.implementerGeneralAgent.prompt ?? "";

    expect(prompt).toContain("General");
    expect(prompt).toContain("src/shared/");
  });

  it("all three variants enforce the contract-read-first rule", async () => {
    const frontendModule = await import("../../src/agents/implementer-frontend");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    for (const agent of [
      frontendModule.implementerFrontendAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      const prompt = agent.prompt ?? "";
      expect(prompt).toContain("Contract");
      expect(prompt).toContain("ESCALATE");
    }
  });
});
