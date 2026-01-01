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

  describe("btca_ask tool", () => {
    it("should be a valid tool with correct schema", async () => {
      const { btca_ask } = await import("../../src/tools/btca");

      expect(btca_ask).toBeDefined();
      expect(btca_ask.description).toContain("source code");
    });

    it("should require tech and question parameters", async () => {
      const { btca_ask } = await import("../../src/tools/btca");

      expect(btca_ask.args).toHaveProperty("tech");
      expect(btca_ask.args).toHaveProperty("question");
    });
  });

  describe("btca registration", () => {
    it("should export checkBtcaAvailable and btca_ask", async () => {
      const btcaModule = await import("../../src/tools/btca");

      expect(btcaModule.checkBtcaAvailable).toBeDefined();
      expect(typeof btcaModule.checkBtcaAvailable).toBe("function");
      expect(btcaModule.btca_ask).toBeDefined();
    });
  });
});
