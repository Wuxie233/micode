import { describe, expect, it } from "bun:test";

import { applyDefaultQuestionPermission } from "../../src/utils/question-permission";

describe("applyDefaultQuestionPermission", () => {
  it("adds built-in question permission when missing", () => {
    expect(applyDefaultQuestionPermission({ bash: "allow" })).toEqual({ bash: "allow", question: "allow" });
  });

  it("creates a permission map when input is undefined", () => {
    expect(applyDefaultQuestionPermission(undefined)).toEqual({ question: "allow" });
  });

  it("preserves explicit deny override", () => {
    expect(applyDefaultQuestionPermission({ question: "deny" })).toEqual({ question: "deny" });
  });

  it("preserves explicit ask override", () => {
    expect(applyDefaultQuestionPermission({ question: "ask" })).toEqual({ question: "ask" });
  });

  it("preserves explicit pattern-map/object override", () => {
    const questionPermission = { "question.*": "allow" };
    expect(applyDefaultQuestionPermission({ question: questionPermission })).toEqual({ question: questionPermission });
  });

  it("treats an own question property as explicit even when value is undefined", () => {
    expect(applyDefaultQuestionPermission({ question: undefined })).toEqual({ question: undefined });
  });
});
