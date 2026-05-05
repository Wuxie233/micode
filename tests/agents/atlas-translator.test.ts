import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasTranslatorAgent } from "@/agents/atlas-translator";

describe("atlas-translator agent config", () => {
  it("declares subagent mode", () => {
    expect(atlasTranslatorAgent.mode).toBe("subagent");
  });

  it("sets a low temperature for precise translation", () => {
    expect(atlasTranslatorAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("sets maxTokens for full-vault translate runs", () => {
    expect(atlasTranslatorAgent.maxTokens).toBeGreaterThan(16000);
  });

  it("describes the translator role", () => {
    expect(atlasTranslatorAgent.description?.toLowerCase()).toContain("translat");
    expect(atlasTranslatorAgent.description?.toLowerCase()).toContain("atlas");
  });

  it("instructs to preserve frontmatter unchanged", () => {
    expect(atlasTranslatorAgent.prompt).toContain("frontmatter");
    expect(atlasTranslatorAgent.prompt).toMatch(/PRESERVE|unchanged|exactly/i);
  });

  it("instructs to preserve wikilinks", () => {
    expect(atlasTranslatorAgent.prompt).toContain("[[");
    expect(atlasTranslatorAgent.prompt).toContain("wikilink");
  });

  it("instructs to preserve code blocks", () => {
    expect(atlasTranslatorAgent.prompt).toContain("backtick");
  });

  it("instructs to skip schema-version file", () => {
    expect(atlasTranslatorAgent.prompt).toContain("schema-version");
  });

  it("instructs to write a maintenance log", () => {
    expect(atlasTranslatorAgent.prompt).toContain("atlas/_meta/log/");
  });

  it("mentions target scope / path filtering", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toMatch(/target|scope/i);
  });
});

describe("agents barrel includes atlas-translator", () => {
  it("registers atlas-translator", () => {
    expect(agents["atlas-translator"]).toBeDefined();
    expect(agents["atlas-translator"].mode).toBe("subagent");
  });
});
