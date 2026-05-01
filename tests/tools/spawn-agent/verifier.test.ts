import { describe, expect, it } from "bun:test";
import { type VerifierDeps, verifyMarker } from "@/tools/spawn-agent/verifier";
import { VERIFIER_CONFIDENCE, VERIFIER_DECISIONS } from "@/tools/spawn-agent/verifier-types";

function makeDeps(overrides: Partial<VerifierDeps> = {}): VerifierDeps {
  return {
    runClassification: async () => '{"decision":"narrative","confidence":"high","reason":"text mention"}',
    timeoutMs: 1000,
    maxOutputChars: 4000,
    ...overrides,
  };
}

describe("verifyMarker", () => {
  it("returns parsed result when LLM produces well-formed JSON", async () => {
    const result = await verifyMarker({ assistantText: "...TEST FAILED...", marker: "TEST FAILED" }, makeDeps());
    expect(result).toEqual({
      decision: VERIFIER_DECISIONS.NARRATIVE,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "text mention",
    });
  });

  it("returns null when the runner throws", async () => {
    const result = await verifyMarker(
      { assistantText: "x", marker: "TEST FAILED" },
      makeDeps({
        runClassification: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(result).toBeNull();
  });

  it("returns null when output is malformed JSON", async () => {
    const result = await verifyMarker(
      { assistantText: "x", marker: "BLOCKED:" },
      makeDeps({ runClassification: async () => "not json at all" }),
    );
    expect(result).toBeNull();
  });

  it("returns null when verifier reports low confidence", async () => {
    const result = await verifyMarker(
      { assistantText: "x", marker: "BLOCKED:" },
      makeDeps({
        runClassification: async () => '{"decision":"final","confidence":"low","reason":"unsure"}',
      }),
    );
    expect(result).toBeNull();
  });

  it("times out and returns null when runner exceeds timeoutMs", async () => {
    const result = await verifyMarker(
      { assistantText: "x", marker: "ESCALATE:" },
      makeDeps({
        timeoutMs: 50,
        runClassification: () => new Promise((resolve) => setTimeout(() => resolve("{}"), 500)),
      }),
    );
    expect(result).toBeNull();
  });

  it("truncates assistant text in the prompt to maxOutputChars", async () => {
    let receivedPrompt = "";
    const long = "y".repeat(8000);
    await verifyMarker(
      { assistantText: long, marker: "TEST FAILED" },
      makeDeps({
        maxOutputChars: 100,
        runClassification: async (prompt) => {
          receivedPrompt = prompt;
          return '{"decision":"narrative","confidence":"high","reason":"r"}';
        },
      }),
    );
    expect(receivedPrompt.length).toBeLessThan(long.length);
    expect(receivedPrompt).toContain("TEST FAILED");
  });
});
