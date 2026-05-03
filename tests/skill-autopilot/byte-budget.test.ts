import { describe, expect, it } from "bun:test";

import { byteLength, fitsInBudget, truncateToByteBudget } from "@/skill-autopilot/byte-budget";

describe("byteLength", () => {
  it("returns UTF-8 byte length", () => {
    expect(byteLength("a")).toBe(1);
    expect(byteLength("啊")).toBe(3);
  });
});

describe("fitsInBudget", () => {
  it("returns true when under or equal", () => {
    expect(fitsInBudget("ab", 2)).toBe(true);
    expect(fitsInBudget("ab", 1)).toBe(false);
  });
});

describe("truncateToByteBudget", () => {
  it("returns input unchanged when under budget", () => {
    expect(truncateToByteBudget("hi", 10)).toBe("hi");
  });

  it("never splits a multi-byte char in the middle", () => {
    const out = truncateToByteBudget("啊啊啊啊", 7);
    expect(byteLength(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith("啊")).toBe(true);
  });
});
