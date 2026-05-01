import { describe, expect, it } from "bun:test";
import { buildDiagnosticLine, formatDiagnostics, MAX_REASON_CHARS } from "@/tools/spawn-agent/diagnostics";

describe("buildDiagnosticLine", () => {
  it("includes only fields that are present", () => {
    expect(buildDiagnosticLine({ classifier: "marker BLOCKED:" })).toBe("classifier=marker BLOCKED:");
  });

  it("joins multiple fields with semicolons", () => {
    const line = buildDiagnosticLine({
      classifier: "marker hit",
      verifier: "narrative",
      cleanup: "deleted 3",
      fence: "duplicate skipped",
    });
    expect(line).toBe("classifier=marker hit; verifier=narrative; cleanup=deleted 3; fence=duplicate skipped");
  });

  it("truncates each field at MAX_REASON_CHARS with ellipsis", () => {
    const long = "x".repeat(MAX_REASON_CHARS + 50);
    const line = buildDiagnosticLine({ classifier: long });
    expect(line.length).toBeLessThanOrEqual("classifier=".length + MAX_REASON_CHARS + 3);
    expect(line.endsWith("...")).toBe(true);
  });

  it("redacts fields containing known secret patterns", () => {
    const line = buildDiagnosticLine({
      classifier: "safe classifier reason",
      verifier: "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });

    expect(line).toBe("classifier=safe classifier reason; verifier=[redacted]");
  });

  it("returns empty string when no fields are present", () => {
    expect(buildDiagnosticLine({})).toBe("");
  });

  it("formatDiagnostics returns a markdown line for non-empty diagnostics", () => {
    const md = formatDiagnostics({ classifier: "ok" });
    expect(md).toBe("**Diagnostics**: classifier=ok");
  });

  it("formatDiagnostics returns empty string when no fields", () => {
    expect(formatDiagnostics({})).toBe("");
  });
});
