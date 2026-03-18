// tests/utils/errors.test.ts
import { describe, expect, it } from "bun:test";

describe("errors utility", () => {
  describe("extractErrorMessage", () => {
    it("should extract message from Error instance", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      const error = new Error("Something went wrong");
      expect(extractErrorMessage(error)).toBe("Something went wrong");
    });

    it("should convert string to message", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage("plain string error")).toBe("plain string error");
    });

    it("should convert number to string", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(404)).toBe("404");
    });

    it("should handle null", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(null)).toBe("null");
    });

    it("should handle undefined", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      expect(extractErrorMessage(undefined)).toBe("undefined");
    });

    it("should handle object with toString", async () => {
      const { extractErrorMessage } = await import("../../src/utils/errors");
      const obj = { toString: () => "custom object" };
      expect(extractErrorMessage(obj)).toBe("custom object");
    });
  });

  describe("formatToolError", () => {
    it("should format error without context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found")).toBe("Error: File not found");
    });

    it("should format error with context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found", "reading config.json")).toBe(
        "Error (reading config.json): File not found",
      );
    });

    it("should handle empty context", async () => {
      const { formatToolError } = await import("../../src/utils/errors");
      expect(formatToolError("File not found", "")).toBe("Error: File not found");
    });
  });
});
