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

describe("classifySpawnError review-vs-execution split", () => {
  it("returns REVIEW_CHANGES_REQUESTED when reviewer emits a final CHANGES REQUESTED marker", () => {
    const result = classifySpawnError({
      assistantText: "Reviewed task 2.3.\nCHANGES REQUESTED: rename foo to bar.",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED);
    expect(result.markerHit).toBe("CHANGES REQUESTED");
  });

  it("returns REVIEW_CHANGES_REQUESTED when agent name is namespaced (spawn-agent.reviewer)", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED: missing tests",
      agent: "spawn-agent.reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED);
  });

  it("still returns TASK_ERROR for implementer agents emitting CHANGES REQUESTED (legacy safety net)", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED: cannot find file",
      agent: "implementer-backend",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("still returns TASK_ERROR for reviewer emitting TEST FAILED (execution failure stays separate)", () => {
    const result = classifySpawnError({
      assistantText: "TEST FAILED",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("still returns BLOCKED for reviewer emitting a blocker", () => {
    const result = classifySpawnError({
      assistantText: "BLOCKED: missing fixture",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.BLOCKED);
  });

  it("narrative CHANGES REQUESTED still goes to NEEDS_VERIFICATION even for reviewer", () => {
    const result = classifySpawnError({
      assistantText: "All passed. The reviewer would print 'CHANGES REQUESTED' if anything broke.",
      agent: "reviewer",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.NEEDS_VERIFICATION);
    expect(result.ambiguousKind).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("falls back to legacy TASK_ERROR mapping when agent is omitted", () => {
    const result = classifySpawnError({
      assistantText: "CHANGES REQUESTED",
    });

    expect(result.class).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });
});
