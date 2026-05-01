import { describe, expect, it } from "bun:test";
import { classifySpawnError, INTERNAL_CLASSES } from "@/tools/spawn-agent/classify";

describe("classifySpawnError", () => {
  it("returns success for plain assistant output", () => {
    expect(classifySpawnError({ assistantText: "Done." }).class).toBe(INTERNAL_CLASSES.SUCCESS);
  });

  it("returns task_error when TEST FAILED is on its own line (final marker)", () => {
    expect(classifySpawnError({ assistantText: "Logs:\nTEST FAILED\n" }).class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("returns blocked when BLOCKED: is the entire output (final marker)", () => {
    expect(classifySpawnError({ assistantText: "BLOCKED:" }).class).toBe(INTERNAL_CLASSES.BLOCKED);
  });

  it("returns needs_verification when TEST FAILED is quoted mid-sentence", () => {
    const text = "All passed. The reviewer would print 'TEST FAILED' if anything broke.";
    const result = classifySpawnError({ assistantText: text });

    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
    expect(result.ambiguousKind).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("returns needs_verification with blocked ambiguousKind for narrative blocked marker", () => {
    const text = "The handoff says to print 'BLOCKED:' only when credentials are missing.";
    const result = classifySpawnError({ assistantText: text });

    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
    expect(result.ambiguousKind).toBe(INTERNAL_CLASSES.BLOCKED);
  });

  it("returns needs_verification when CHANGES REQUESTED appears inside fenced code", () => {
    const text = "Approval flow:\n```\nCHANGES REQUESTED\n```\nReviewer approved.";
    expect(classifySpawnError({ assistantText: text }).class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
  });

  it("returns hard_failure when thrown error and no assistant text", () => {
    expect(classifySpawnError({ thrown: new Error("boom") }).class).toBe(INTERNAL_CLASSES.HARD_FAILURE);
  });

  it("returns transient on ECONNRESET", () => {
    expect(classifySpawnError({ thrown: new Error("ECONNRESET") }).class).toBe(INTERNAL_CLASSES.TRANSIENT);
  });

  it("returns transient on HTTP 503", () => {
    expect(classifySpawnError({ httpStatus: 503 }).class).toBe(INTERNAL_CLASSES.TRANSIENT);
  });

  it("returns hard_failure on empty output and no thrown error", () => {
    expect(classifySpawnError({ assistantText: "   " }).class).toBe(INTERNAL_CLASSES.HARD_FAILURE);
  });

  it("includes the marker in the reason for needs_verification", () => {
    const result = classifySpawnError({ assistantText: "all good but said 'BUILD FAILED' in passing." });
    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
    expect(result.reason).toContain("BUILD FAILED");
    expect(result.markerHit).toBe("BUILD FAILED");
  });
});
