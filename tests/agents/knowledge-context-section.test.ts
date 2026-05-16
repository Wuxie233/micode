import { describe, expect, it } from "bun:test";

import { KNOWLEDGE_CONTEXT_SECTION } from "@/agents/knowledge-context-section";

describe("KNOWLEDGE_CONTEXT_SECTION", () => {
  it("is a non-empty string", () => {
    expect(typeof KNOWLEDGE_CONTEXT_SECTION).toBe("string");
    expect(KNOWLEDGE_CONTEXT_SECTION.length).toBeGreaterThan(0);
  });

  it("declares the 本次知识上下文 output block", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("本次知识上下文");
  });

  it("instructs agents to list what they READ from atlas / mindmodel / project memory", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("读取");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("atlas");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("mindmodel");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("project memory");
  });

  it("instructs agents to list what they MAINTAINED / wrote", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("维护");
  });

  it("uses a wrapping XML-style block so it can be injected into agent prompts", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("<knowledge-context-section");
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("</knowledge-context-section>");
  });

  it("declares the working-context capsule status line and enum", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("Capsule status:");
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain(
      "<none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>",
    );
  });
});
