import { describe, expect, it } from "bun:test";

import { DEFAULT_MODEL } from "../../src/utils/config";

describe("domain-specific implementers", () => {
  it("registers implementer-frontend-ui, implementer-frontend-code, implementer-backend, implementer-general", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["implementer-frontend-ui"]).toBeDefined();
    expect(module.agents["implementer-frontend-code"]).toBeDefined();
    expect(module.agents["implementer-backend"]).toBeDefined();
    expect(module.agents["implementer-general"]).toBeDefined();
  });

  it("removes the unsuffixed implementer and the old single implementer-frontend from the registry", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.implementer).toBeUndefined();
    expect(module.agents["implementer-frontend"]).toBeUndefined();
  });

  it("configures all four domain implementers as subagents with DEFAULT_MODEL", async () => {
    const module = await import("../../src/agents/index");

    for (const name of [
      "implementer-frontend-ui",
      "implementer-frontend-code",
      "implementer-backend",
      "implementer-general",
    ]) {
      const agent = module.agents[name];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("shares the base implementer prompt across all four variants", async () => {
    const module = await import("../../src/agents/implementer");
    const uiModule = await import("../../src/agents/implementer-frontend-ui");
    const codeModule = await import("../../src/agents/implementer-frontend-code");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    const basePrompt = module.BASE_IMPLEMENTER_PROMPT;
    expect(basePrompt.length).toBeGreaterThan(0);

    for (const agent of [
      uiModule.implementerFrontendUiAgent,
      codeModule.implementerFrontendCodeAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      expect(agent.prompt).toContain(basePrompt);
    }
  });

  it("frontend-ui variant emphasises UI/UX, design system, and accessibility", async () => {
    const module = await import("../../src/agents/implementer-frontend-ui");
    const prompt = module.implementerFrontendUiAgent.prompt ?? "";

    expect(prompt).toContain("Frontend UI");
    expect(prompt).toContain("design-system");
    expect(prompt).toContain("accessibility");
    expect(prompt).toContain(".tsx");
  });

  it("frontend-code variant emphasises logic, state, types, and minimal scoped change", async () => {
    const module = await import("../../src/agents/implementer-frontend-code");
    const prompt = module.implementerFrontendCodeAgent.prompt ?? "";

    expect(prompt).toContain("Frontend code-logic");
    expect(prompt).toContain("state");
    expect(prompt).toContain("type safety");
    expect(prompt).toContain("Minimal, scoped");
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

  it("all four variants enforce the contract-read-first rule", async () => {
    const uiModule = await import("../../src/agents/implementer-frontend-ui");
    const codeModule = await import("../../src/agents/implementer-frontend-code");
    const backendModule = await import("../../src/agents/implementer-backend");
    const generalModule = await import("../../src/agents/implementer-general");

    for (const agent of [
      uiModule.implementerFrontendUiAgent,
      codeModule.implementerFrontendCodeAgent,
      backendModule.implementerBackendAgent,
      generalModule.implementerGeneralAgent,
    ]) {
      const prompt = agent.prompt ?? "";
      expect(prompt).toContain("Contract");
      expect(prompt).toContain("ESCALATE");
    }
  });
});
