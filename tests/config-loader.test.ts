// tests/config-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadMicodeConfig, mergeAgentConfigs } from "../src/config-loader";

describe("config-loader", () => {
  let testConfigDir: string;

  beforeEach(() => {
    // Create a test config directory
    testConfigDir = join(tmpdir(), `micode-config-test-${Date.now()}`);
    mkdirSync(testConfigDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testConfigDir, { recursive: true, force: true });
  });

  it("should return null when micode.json does not exist", async () => {
    const config = await loadMicodeConfig(testConfigDir);
    expect(config).toBeNull();
  });

  it("should load agent model overrides from micode.json", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          Commander: { model: "openai/gpt-4o" },
          brainstormer: { model: "openai/gpt-4o", temperature: 0.5 },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents?.Commander?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.brainstormer?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.brainstormer?.temperature).toBe(0.5);
  });

  it("should return null for invalid JSON", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, "{ invalid json }");

    const config = await loadMicodeConfig(testConfigDir);
    expect(config).toBeNull();
  });

  it("should handle empty agents object", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(configPath, JSON.stringify({ agents: {} }));

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents).toEqual({});
  });

  it("should only allow safe properties (model, temperature, maxTokens)", async () => {
    const configPath = join(testConfigDir, "micode.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        agents: {
          Commander: {
            model: "openai/gpt-4o",
            temperature: 0.3,
            maxTokens: 8000,
            prompt: "MALICIOUS PROMPT", // Should be filtered
            tools: { bash: true }, // Should be filtered
          },
        },
      }),
    );

    const config = await loadMicodeConfig(testConfigDir);

    expect(config).not.toBeNull();
    expect(config?.agents?.Commander?.model).toBe("openai/gpt-4o");
    expect(config?.agents?.Commander?.temperature).toBe(0.3);
    expect(config?.agents?.Commander?.maxTokens).toBe(8000);
    // These should be filtered out
    expect((config?.agents?.Commander as Record<string, unknown>)?.prompt).toBeUndefined();
    expect((config?.agents?.Commander as Record<string, unknown>)?.tools).toBeUndefined();
  });
});

describe("mergeAgentConfigs", () => {
  it("should merge user config into plugin agents", () => {
    const pluginAgents = {
      Commander: {
        description: "Main agent",
        mode: "primary" as const,
        model: "anthropic/claude-opus-4-5",
        temperature: 0.2,
        prompt: "System prompt",
      },
    };

    const userConfig = {
      agents: {
        Commander: { model: "openai/gpt-4o", temperature: 0.5 },
      },
    };

    const merged = mergeAgentConfigs(pluginAgents, userConfig);

    expect(merged.Commander.model).toBe("openai/gpt-4o");
    expect(merged.Commander.temperature).toBe(0.5);
    // Original properties should be preserved
    expect(merged.Commander.description).toBe("Main agent");
    expect(merged.Commander.prompt).toBe("System prompt");
  });

  it("should not modify agents without user overrides", () => {
    const pluginAgents = {
      Commander: {
        description: "Main agent",
        model: "anthropic/claude-opus-4-5",
      },
      brainstormer: {
        description: "Design agent",
        model: "anthropic/claude-opus-4-5",
      },
    };

    const userConfig = {
      agents: {
        Commander: { model: "openai/gpt-4o" },
      },
    };

    const merged = mergeAgentConfigs(pluginAgents, userConfig);

    expect(merged.Commander.model).toBe("openai/gpt-4o");
    expect(merged.brainstormer.model).toBe("anthropic/claude-opus-4-5");
  });

  it("should handle null user config", () => {
    const pluginAgents = {
      Commander: {
        description: "Main agent",
        model: "anthropic/claude-opus-4-5",
      },
    };

    const merged = mergeAgentConfigs(pluginAgents, null);

    expect(merged.Commander.model).toBe("anthropic/claude-opus-4-5");
  });
});
