import { describe, it, expect } from "bun:test";

describe("btca tool", () => {
  describe("checkBtcaAvailable", () => {
    it("should return available status object", async () => {
      const { checkBtcaAvailable } = await import("../../src/tools/btca");
      const result = await checkBtcaAvailable();

      expect(result).toHaveProperty("available");
      expect(typeof result.available).toBe("boolean");

      if (!result.available) {
        expect(result.message).toContain("btca");
        expect(result.message).toContain("Install");
      }
    });
  });
});
