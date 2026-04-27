import { describe, expect, it } from "bun:test";

import { parseModelReference, resolveModelName, resolveModelReference } from "../../src/utils/model-selection";

const availableModels = new Set(["anthropic/claude-opus-4.1", "openai/gpt-5.5", "openai/gpt-5.5-codex"]);

describe("model selection", () => {
  it("parses provider and model IDs", () => {
    expect(parseModelReference("openrouter/anthropic/claude-opus-4.1")).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-opus-4.1",
    });
  });

  it("rejects model references without provider", () => {
    expect(parseModelReference("gpt-5.5")).toBeNull();
  });

  it("resolves fuzzy aliases against configured models", () => {
    expect(resolveModelName("gpt5.5", availableModels)).toBe("openai/gpt-5.5");
    expect(resolveModelName("opus", availableModels)).toBe("anthropic/claude-opus-4.1");
  });

  it("returns a model reference for explicit aliases", () => {
    expect(resolveModelReference("gpt5.5", availableModels)).toEqual({ providerID: "openai", modelID: "gpt-5.5" });
  });
});
