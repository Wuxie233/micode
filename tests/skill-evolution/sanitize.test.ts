import { describe, expect, it } from "bun:test";

import { dedupeKeyFor, sanitizeCandidateInput } from "@/skill-evolution/sanitize";

describe("sanitizeCandidateInput", () => {
  it("collapses internal whitespace and trims trigger and steps", () => {
    const result = sanitizeCandidateInput({
      trigger: "  on   lifecycle\tfinish\n",
      steps: ["  step  one  ", "step\ttwo"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trigger).toBe("on lifecycle finish");
    expect(result.value.steps).toEqual(["step one", "step two"]);
  });

  it("rejects when trigger is empty after trimming", () => {
    const result = sanitizeCandidateInput({ trigger: "   ", steps: ["x"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("trigger");
  });

  it("rejects when any step is empty after trimming", () => {
    const result = sanitizeCandidateInput({ trigger: "t", steps: ["a", "  "] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("step");
  });

  it("rejects when trigger contains a detectable secret", () => {
    const result = sanitizeCandidateInput({
      trigger: "use AKIAABCDEFGHIJKLMNOP for s3",
      steps: ["x"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("secret");
  });

  it("rejects when any step contains a detectable secret", () => {
    const result = sanitizeCandidateInput({
      trigger: "trigger",
      steps: ["call api with ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("secret");
  });
});

describe("dedupeKeyFor", () => {
  it("produces the same hex key for the same normalized input", () => {
    const a = dedupeKeyFor({ trigger: "trig", steps: ["a", "b"] });
    const b = dedupeKeyFor({ trigger: "trig", steps: ["a", "b"] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs when trigger differs", () => {
    const a = dedupeKeyFor({ trigger: "trig1", steps: ["a"] });
    const b = dedupeKeyFor({ trigger: "trig2", steps: ["a"] });
    expect(a).not.toBe(b);
  });

  it("differs when step order differs", () => {
    const a = dedupeKeyFor({ trigger: "t", steps: ["a", "b"] });
    const b = dedupeKeyFor({ trigger: "t", steps: ["b", "a"] });
    expect(a).not.toBe(b);
  });
});
