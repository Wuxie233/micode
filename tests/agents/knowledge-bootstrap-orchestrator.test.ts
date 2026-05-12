import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { knowledgeBootstrapOrchestratorAgent } from "@/agents/knowledge-bootstrap-orchestrator";

describe("knowledge-bootstrap-orchestrator agent config", () => {
  it("is registered as a primary-mode agent", () => {
    expect(knowledgeBootstrapOrchestratorAgent.mode).toBe("primary");
  });

  it("has a non-empty description naming the three commands", () => {
    const desc = knowledgeBootstrapOrchestratorAgent.description ?? "";
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain("/all-init");
    expect(desc).toContain("/all-rebuild");
    expect(desc).toContain("/all-status");
  });

  it("prompt contains a mode-handling block keyed by command name", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<mode-handling>");
    expect(p).toContain("/all-init");
    expect(p).toContain("/all-rebuild");
    expect(p).toContain("/all-status");
    expect(p).toContain("missing-only");
    expect(p).toContain("refresh-all");
    expect(p).toContain("status-only");
  });

  it("prompt contains a process block referencing detect_knowledge_state", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<process>");
    expect(p).toContain("detect_knowledge_state");
  });

  it("prompt instructs serial spawning of project-initializer, mm-orchestrator, atlas-initializer", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("project-initializer");
    expect(p).toContain("mm-orchestrator");
    expect(p).toContain("atlas-initializer");
    // dependency order asserted by appearance order
    const pi = p.indexOf("project-initializer");
    const mm = p.indexOf("mm-orchestrator");
    const ai = p.indexOf("atlas-initializer");
    expect(pi).toBeGreaterThan(-1);
    expect(mm).toBeGreaterThan(pi);
    expect(ai).toBeGreaterThan(mm);
  });

  it("prompt includes the octto questionnaire block and references intent question keys", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<bootstrap-questionnaire>");
    expect(p).toContain("intent.pitch");
    expect(p).toContain("intent.user");
    expect(p).toContain("intent.shape");
  });

  it("prompt explicitly requires confirm before /all-rebuild executes", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("confirm");
    // confirm rule must appear inside the refresh-all branch
    expect(p).toMatch(/refresh-all[\s\S]*confirm/);
  });

  it("prompt forbids parallel spawning of the three child orchestrators", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt.toLowerCase();
    expect(p).toMatch(/serial|sequential|in order|顺序|串行/);
  });

  it("prompt forbids rollback on mid-flight failure", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt.toLowerCase();
    expect(p).toMatch(/no rollback|do not rollback|不回滚|不撤销/);
  });

  it("prompt status-only branch is read-only", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toMatch(/status-only[\s\S]*read[- ]only|status-only[\s\S]*不写/);
  });

  it("prompt injects ATLAS_MENTAL_MODEL_PROTOCOL", () => {
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("<atlas-mental-model");
  });

  it("prompt injects KNOWLEDGE_CONTEXT_SECTION", () => {
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("<knowledge-context-section");
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("本次知识上下文");
  });

  it("prompt instructs friendly exit when /all-init finds all three layers present", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toMatch(/all.*present|all.*三层都.?在|全有/);
    expect(p).toContain("/all-rebuild");
  });

  it("prompt mentions runAtlasInit force-rebuild semantics for /all-rebuild atlas step", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("force-rebuild");
  });
});

describe("agents barrel includes knowledge-bootstrap-orchestrator", () => {
  it("registers knowledge-bootstrap-orchestrator", () => {
    expect(agents["knowledge-bootstrap-orchestrator"]).toBeDefined();
    expect(agents["knowledge-bootstrap-orchestrator"].mode).toBe("primary");
  });
});
