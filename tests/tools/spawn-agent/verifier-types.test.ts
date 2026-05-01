import { describe, expect, it } from "bun:test";
import { parseVerifierResponse, VERIFIER_CONFIDENCE, VERIFIER_DECISIONS } from "@/tools/spawn-agent/verifier-types";

describe("parseVerifierResponse", () => {
  it("parses well-formed JSON with high confidence", () => {
    const raw = '{"decision":"narrative","confidence":"high","reason":"text discussion"}';
    expect(parseVerifierResponse(raw)).toEqual({
      decision: VERIFIER_DECISIONS.NARRATIVE,
      confidence: VERIFIER_CONFIDENCE.HIGH,
      reason: "text discussion",
    });
  });

  it("returns null for non-JSON output", () => {
    expect(parseVerifierResponse("not json")).toBeNull();
  });

  it("returns null when decision field is missing", () => {
    expect(parseVerifierResponse('{"confidence":"high"}')).toBeNull();
  });

  it("returns null for unknown decision values", () => {
    expect(parseVerifierResponse('{"decision":"weird","confidence":"high"}')).toBeNull();
  });

  it("defaults confidence to low when malformed", () => {
    const parsed = parseVerifierResponse('{"decision":"final","confidence":"???","reason":"r"}');
    expect(parsed?.confidence).toBe(VERIFIER_CONFIDENCE.LOW);
  });

  it("trims reason and limits to short string", () => {
    const longReason = " ".repeat(10) + "x".repeat(500);
    const parsed = parseVerifierResponse(`{"decision":"final","confidence":"high","reason":"${longReason}"}`);
    expect(parsed?.reason.length).toBeLessThanOrEqual(200);
  });

  it("handles JSON wrapped in markdown fences", () => {
    const raw = '```json\n{"decision":"narrative","confidence":"high","reason":"r"}\n```';
    const parsed = parseVerifierResponse(raw);
    expect(parsed?.decision).toBe(VERIFIER_DECISIONS.NARRATIVE);
  });
});
