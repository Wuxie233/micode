import { describe, expect, test } from "vitest";
import { isRecoverableUpstreamError } from "@/workflow-retry/upstream-predicate";

describe("isRecoverableUpstreamError", () => {
  test("returns true for upstream_error: Upstream request failed", () => {
    expect(isRecoverableUpstreamError("upstream_error: Upstream request failed")).toBe(true);
  });

  test("returns true for stream INTERNAL_ERROR reset", () => {
    expect(isRecoverableUpstreamError("stream error: stream ID 1261; INTERNAL_ERROR; received from peer")).toBe(true);
  });

  test("returns true for upstream_error with provider blew up", () => {
    expect(isRecoverableUpstreamError("upstream_error: provider blew up")).toBe(true);
  });

  test("returns false for empty/null error", () => {
    expect(isRecoverableUpstreamError("")).toBe(false);
    expect(isRecoverableUpstreamError(null)).toBe(false);
    expect(isRecoverableUpstreamError(undefined)).toBe(false);
  });

  test("returns false for auth errors", () => {
    expect(isRecoverableUpstreamError("invalid api key")).toBe(false);
    expect(isRecoverableUpstreamError("401 unauthorized")).toBe(false);
  });

  test("returns false for quota errors", () => {
    expect(isRecoverableUpstreamError("quota exceeded")).toBe(false);
    expect(isRecoverableUpstreamError("rate limit exceeded for this account")).toBe(false);
  });

  test("returns false for config errors", () => {
    expect(isRecoverableUpstreamError("invalid model id")).toBe(false);
    expect(isRecoverableUpstreamError("provider not configured")).toBe(false);
  });

  test("returns false for user cancel", () => {
    expect(isRecoverableUpstreamError("aborted by user")).toBe(false);
    expect(isRecoverableUpstreamError("user canceled")).toBe(false);
  });

  test("returns false for semantic blocker / tool_result errors handled by existing recovery", () => {
    // These are handled by RECOVERABLE_ERRORS in session-recovery.ts, NOT by upstream predicate.
    expect(isRecoverableUpstreamError("tool_result block(s) missing")).toBe(false);
    expect(isRecoverableUpstreamError("thinking blocks must be at the start")).toBe(false);
  });

  test("accepts Error objects and unwraps message", () => {
    expect(isRecoverableUpstreamError(new Error("upstream_error: Upstream request failed"))).toBe(true);
    expect(isRecoverableUpstreamError(new Error("401 unauthorized"))).toBe(false);
  });

  test("accepts plain message objects and unwraps message", () => {
    expect(isRecoverableUpstreamError({ message: "upstream_error: Upstream request failed" })).toBe(true);
    expect(isRecoverableUpstreamError({ message: "401 unauthorized" })).toBe(false);
  });
});
