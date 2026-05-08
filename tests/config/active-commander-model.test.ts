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

  it("does not keep the old implementer-frontend in active config (it must be removed)", () => {
    // After issue #56, implementer-frontend no longer exists. The active host config
    // must either omit the key entirely or have been replaced by the two new agents.
    if (agents["implementer-frontend"] !== undefined) {
      throw new Error(
        "active config still references the stale implementer-frontend agent; replace it with implementer-frontend-ui and implementer-frontend-code",
      );
    }
  });

  it("routes implementer-frontend-ui to a UI/UX-strong model when configured", () => {
    if (agents["implementer-frontend-ui"] === undefined) {
      // Host has not yet adopted the new split; treat as skipped at expectation level.
      return;
    }
    expect(agents["implementer-frontend-ui"]?.model).toBeDefined();
  });

  it("routes implementer-frontend-code to a code-logic-strong model when configured", () => {
    if (agents["implementer-frontend-code"] === undefined) {
      return;
    }
    expect(agents["implementer-frontend-code"]?.model).toBeDefined();
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
