import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasInitializerAgent } from "@/agents/atlas-initializer";

describe("atlas-initializer agent config", () => {
  it("declares subagent mode", () => {
    expect(atlasInitializerAgent.mode).toBe("subagent");
  });

  it("sets a temperature appropriate for structured generation", () => {
    expect(atlasInitializerAgent.temperature).toBe(0.3);
  });

  it("sets maxTokens for long-running init runs", () => {
    expect(atlasInitializerAgent.maxTokens).toBeGreaterThan(16000);
  });

  it("describes the cold-init role", () => {
    expect(atlasInitializerAgent.description?.toLowerCase()).toContain("atlas");
    expect(atlasInitializerAgent.description?.toLowerCase()).toContain("init");
  });

  it("instructs the agent to use spawn_agent for parallel workers", () => {
    expect(atlasInitializerAgent.prompt).toContain("spawn_agent");
  });

  it("mentions multi-phase cold-init flow", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("discovery");
    expect(p).toContain("synthesis");
    expect(p).toContain("worker");
    expect(p).toContain("reconcile");
    expect(p).toContain("write");
  });

  it("bans confidence and human_authored fields", () => {
    expect(atlasInitializerAgent.prompt).toContain("confidence");
    expect(atlasInitializerAgent.prompt).toContain("human_authored");
    // The constraint should say NOT to include them
    expect(atlasInitializerAgent.prompt).toMatch(/No.*confidence|confidence.*field.*drop|drop.*confidence/i);
  });

  it("mandates Obsidian wikilinks", () => {
    expect(atlasInitializerAgent.prompt).toContain("[[");
    expect(atlasInitializerAgent.prompt).toContain("wikilink");
  });

  it("lists atlas-cold-build and atlas-cold-behavior as worker agents", () => {
    expect(atlasInitializerAgent.prompt).toContain("atlas-cold-build");
    expect(atlasInitializerAgent.prompt).toContain("atlas-cold-behavior");
  });

  it("mentions codebase-locator and codebase-analyzer as discovery agents", () => {
    expect(atlasInitializerAgent.prompt).toContain("codebase-locator");
    expect(atlasInitializerAgent.prompt).toContain("codebase-analyzer");
  });

  it("references the atlas/ vault layout", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("atlas/00-index.md");
    expect(p).toContain("10-impl");
    expect(p).toContain("20-behavior");
  });

  it("states that no lifecycle handoff is required", () => {
    expect(atlasInitializerAgent.prompt).toContain("lifecycle handoff");
  });

  it("instructs atlas-only auto-commit after a successful run", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("<auto-commit>");
    expect(p).toContain("git status --porcelain");
    expect(p).toContain("no atlas changes");
    expect(p).toContain("git add atlas/");
    expect(p).toContain("git diff --cached --name-only");
    expect(p).toContain("validateStagedPaths");
    expect(p).toContain("buildAtlasInitCommitSummary");
    expect(p).toContain("atlas: init vault (run <runId>)");
    expect(p).toContain('git commit -m "<message>"');
  });

  it("auto-pushes the atlas-only commit to origin", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("git push origin HEAD");
    expect(p).toContain("origin");
    expect(p).toContain("pushed <sha> to origin/<branch>");
    expect(p).toContain("--force");
    expect(p.toLowerCase()).toContain("do not pass `--force`");
    expect(p.toLowerCase()).toContain("never to `upstream`");
  });

  it("retains the local commit and surfaces next action when push fails", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("retained locally");
    expect(p).toContain("push failed");
    expect(p.toLowerCase()).toContain("do not amend");
    expect(p.toLowerCase()).toContain("do not retry automatically");
    expect(p.toLowerCase()).toContain("manually to retry");
  });

  it("skips push when no commit was created", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("Skip this step entirely");
    expect(p).toContain("no atlas changes");
  });

  it("refuses to commit when non-atlas paths are staged", () => {
    const p = atlasInitializerAgent.prompt.toLowerCase();
    expect(p).toContain("every output line must start with `atlas/`");
    expect(p).toContain("do not commit");
    expect(p).toContain("non-atlas");
    expect(p).toMatch(/reset|unstage/);
  });
});

describe("agents barrel includes atlas-initializer", () => {
  it("registers atlas-initializer", () => {
    expect(agents["atlas-initializer"]).toBeDefined();
    expect(agents["atlas-initializer"].mode).toBe("subagent");
  });
});
