import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "/root";
const ACTIVE_CONFIG_PATH = join(HOME, ".config", "opencode", "micode.jsonc");

function readActiveConfig(): string | null {
  if (!existsSync(ACTIVE_CONFIG_PATH)) {
    return null;
  }
  return readFileSync(ACTIVE_CONFIG_PATH, "utf-8");
}

function stripJsonc(source: string): string {
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("active host config: commander model strategy (issue #23)", () => {
  const source = readActiveConfig();

  if (source === null) {
    it.skip("active config not present on this host (skipped)", () => {});
    return;
  }

  const stripped = stripJsonc(source);
  const config = JSON.parse(stripped) as {
    agents?: Record<string, { model?: string; options?: { reasoningEffort?: string } }>;
  };
  const agents = config.agents ?? {};

  it("routes commander to wuxie-claude/claude-sonnet-4-6", () => {
    expect(agents.commander).toBeDefined();
    expect(agents.commander?.model).toBe("wuxie-claude/claude-sonnet-4-6");
  });

  it("keeps executor on wuxie-openai/gpt-5.5", () => {
    expect(agents.executor).toBeDefined();
    expect(agents.executor?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-frontend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-frontend"]).toBeDefined();
    expect(agents["implementer-frontend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-backend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-backend"]).toBeDefined();
    expect(agents["implementer-backend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-general on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-general"]).toBeDefined();
    expect(agents["implementer-general"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("does not route commander to any GPT model (regression: design says Sonnet 4.6)", () => {
    expect(agents.commander?.model ?? "").not.toMatch(/gpt-/i);
  });
});
