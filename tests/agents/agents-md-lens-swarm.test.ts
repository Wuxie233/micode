import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("AGENTS.md Lens Swarm workflow mirror", () => {
  it("documents Lens Swarm, Discovery Swarm, and Adversarial Swarm", () => {
    expect(AGENTS_MD).toContain("## Lens Swarm Discovery / Adversarial Review");
    expect(AGENTS_MD).toContain("Lens Swarm protocol");
    expect(AGENTS_MD).toContain("Discovery Swarm");
    expect(AGENTS_MD).toContain("Adversarial Swarm");
  });

  it("documents brainstorm-scout as read-only and not part of executor routing", () => {
    const section = AGENTS_MD.match(/## Lens Swarm Discovery \/ Adversarial Review[\s\S]*?(?=\n## |$)/)?.[0] ?? "";

    expect(section).toContain("brainstorm-scout");
    expect(section.toLowerCase()).toContain("read-only");
    expect(section).toContain("不进入 executor");
  });

  it("preserves explicit critic-role compatibility", () => {
    const section = AGENTS_MD.match(/## Lens Swarm Discovery \/ Adversarial Review[\s\S]*?(?=\n## |$)/)?.[0] ?? "";

    expect(section).toContain("critic");
    expect(section).toContain("redteam");
    expect(section).toContain("yagni");
    expect(section).toContain("显式");
  });

  it("documents whitelist-based reviewer skipping", () => {
    const section = AGENTS_MD.match(/## Lens Swarm Discovery \/ Adversarial Review[\s\S]*?(?=\n## |$)/)?.[0] ?? "";

    expect(section).toContain("review policy");
    expect(section).toContain("whitelist");
    expect(section).toContain("executor");
    expect(section).toContain("高风险");
  });
});
