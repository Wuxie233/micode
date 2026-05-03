import { describe, expect, it } from "bun:test";
import { computeClaimHash } from "@/atlas/claim-hash";
import { ATLAS_CLAIM_HASH_HEX_LENGTH } from "@/atlas/config";

describe("claim hash", () => {
  it("returns a 12-hex string", () => {
    const hash = computeClaimHash("10-impl/runner.md", "the runner spawns workers");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(ATLAS_CLAIM_HASH_HEX_LENGTH);
  });

  it("normalizes whitespace and case", () => {
    const a = computeClaimHash("a", "  Hello   World!  ");
    const b = computeClaimHash("a", "hello world");
    expect(a).toBe(b);
  });

  it("differs across targets", () => {
    expect(computeClaimHash("a", "x")).not.toBe(computeClaimHash("b", "x"));
  });
});
