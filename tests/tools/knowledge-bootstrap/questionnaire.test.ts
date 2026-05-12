import { describe, expect, it } from "bun:test";

import {
  BOOTSTRAP_QUESTION_KEYS,
  buildBootstrapQuestionPrompt,
  DEFAULT_BOOTSTRAP_ANSWERS,
} from "@/tools/knowledge-bootstrap/questionnaire";

describe("BOOTSTRAP_QUESTION_KEYS", () => {
  it("exposes the three atlas cold-init intent question ids", () => {
    expect(BOOTSTRAP_QUESTION_KEYS).toEqual(["intent.pitch", "intent.user", "intent.shape"]);
  });
});

describe("DEFAULT_BOOTSTRAP_ANSWERS", () => {
  it("provides safe defaults so atlas-initializer never blocks on octto", () => {
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.pitch"]).toBeDefined();
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.user"]).toBeDefined();
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.shape"]).toBe("other");
  });
});

describe("buildBootstrapQuestionPrompt", () => {
  it("renders a chinese-friendly prompt block listing all bootstrap questions", () => {
    const prompt = buildBootstrapQuestionPrompt();
    expect(prompt).toContain("intent.pitch");
    expect(prompt).toContain("intent.user");
    expect(prompt).toContain("intent.shape");
    expect(prompt).toContain("octto");
  });

  it("includes a fallback instruction for when octto is unavailable", () => {
    const prompt = buildBootstrapQuestionPrompt();
    expect(prompt.toLowerCase()).toContain("fallback");
    expect(prompt.toLowerCase()).toContain("default");
  });
});
