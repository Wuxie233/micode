import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasTranslatorAgent } from "@/agents/atlas-translator";

describe("atlas-translator agent config", () => {
  it("declares subagent mode", () => {
    expect(atlasTranslatorAgent.mode).toBe("subagent");
  });

  it("preserves machine syntax while translating prose", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("PRESERVE EXACTLY");
    expect(p).toContain("YAML frontmatter keys");
    expect(p).toContain("Obsidian wikilinks [[Target Name]]");
    expect(p).toContain("Inline code spans and fenced code blocks");
    expect(p).toContain("Source pointers");
    expect(p).toContain("TRANSLATE: Body prose");
  });

  it("accepts TARGET_PATH from the spawn prompt", () => {
    expect(atlasTranslatorAgent.prompt).toContain("TARGET_PATH=<value>");
    expect(atlasTranslatorAgent.prompt).toContain('"all" if no argument');
  });

  it("writes translate maintenance logs under atlas meta log", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("atlas/_meta/log/translate-{timestamp}.md");
    expect(p).toContain("# Atlas Translate Run {TIMESTAMP}");
  });

  it("instructs atlas-only auto-commit after a successful run", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("<auto-commit>");
    expect(p).toContain("git status --porcelain");
    expect(p).toContain("no atlas changes");
    expect(p).toContain("git add atlas/");
    expect(p).toContain("git diff --cached --name-only");
    expect(p).toContain("validateStagedPaths");
    expect(p).toContain("buildAtlasTranslateCommitSummary");
    expect(p).toContain("atlas: translate <targetPath> (run <runId>)");
    expect(p).toContain('git commit -m "<message>"');
    expect(p.toLowerCase()).toContain("do not push");
  });

  it("refuses to commit when non-atlas paths are staged", () => {
    const p = atlasTranslatorAgent.prompt.toLowerCase();
    expect(p).toContain("every output line must start with `atlas/`");
    expect(p).toContain("do not commit");
    expect(p).toContain("non-atlas");
    expect(p).toMatch(/reset|unstage/);
  });
});

describe("agents barrel includes atlas-translator", () => {
  it("registers atlas-translator", () => {
    expect(agents["atlas-translator"]).toBeDefined();
    expect(agents["atlas-translator"].mode).toBe("subagent");
  });
});
