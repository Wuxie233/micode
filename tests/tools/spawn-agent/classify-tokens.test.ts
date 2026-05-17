import { describe, expect, it } from "bun:test";

import {
  BLOCKED_MARKERS,
  containsAnyMarker,
  matchesAnyPattern,
  REVIEW_DECISION_MARKERS,
  TASK_ERROR_MARKERS,
  TRANSIENT_HTTP_STATUSES,
  TRANSIENT_NETWORK_PATTERNS,
} from "../../../src/tools/spawn-agent/classify-tokens";

const REVIEW_DECISION_MARKER = "CHANGES REQUESTED";
const ECONNRESET_MESSAGE = "Provider request failed with ECONNRESET while streaming.";
const STREAM_RESET_MESSAGE = "Provider stream reset before completion.";
const H2_UPSTREAM_INTERNAL_ERROR_MESSAGE = "stream error: stream ID 1261; INTERNAL_ERROR; received from peer";
const H2_UPSTREAM_INTERNAL_ERROR_JSON_MESSAGE =
  '{"type":"error","sequence_number":0,"error":{"type":"upstream_error","code":"internal_server_error","message":"stream error: stream ID 1261; INTERNAL_ERROR; received from peer"}}';
const H2_UPSTREAM_INTERNAL_ERROR_STREAM_ID_7_MESSAGE = "stream error: stream ID 7; INTERNAL_ERROR; received from peer";
const H2_UPSTREAM_INTERNAL_ERROR_STREAM_ID_99999_MESSAGE =
  "stream error: stream ID 99999; INTERNAL_ERROR; received from peer";
const NON_TRANSIENT_MESSAGE = "Validation failed before contacting the provider.";
const UPSTREAM_INTERNAL_SERVER_ERROR_MESSAGE = "upstream returned internal_server_error";
const UPSTREAM_ERROR_PROVIDER_MESSAGE = "upstream_error: provider blew up";
const HTTP_500_INTERNAL_SERVER_ERROR_MESSAGE = "HTTP 500 Internal Server Error";
const STREAM_ERROR_ONLY_MESSAGE = "stream error happened";
const INTERNAL_ERROR_ONLY_MESSAGE = "INTERNAL_ERROR";
const TEST_FAILURE_OUTPUT = "Task completed with TEST FAILED after running bun test.";
const BUILD_FAILURE_OUTPUT = "BUILD FAILED because typecheck rejected the branch.";
const REVIEW_DECISION_OUTPUT = `Reviewer emitted ${REVIEW_DECISION_MARKER} after review.`;
const BLOCKED_OUTPUT = "BLOCKED: missing GitHub token for the requested operation.";
const ESCALATED_OUTPUT = "ESCALATE: upstream contract changed under this task.";
const SUCCESS_OUTPUT = "All checks passed and the task is done.";

describe("spawn-agent classifier tokens", () => {
  it("matches representative transient network failures", () => {
    expect(matchesAnyPattern(ECONNRESET_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(matchesAnyPattern(STREAM_RESET_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
  });

  it("does not match non-transient provider text", () => {
    expect(matchesAnyPattern(NON_TRANSIENT_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(false);
  });

  it("matches upstream h2 stream INTERNAL_ERROR messages", () => {
    expect(matchesAnyPattern(H2_UPSTREAM_INTERNAL_ERROR_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(matchesAnyPattern(H2_UPSTREAM_INTERNAL_ERROR_JSON_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(matchesAnyPattern(H2_UPSTREAM_INTERNAL_ERROR_STREAM_ID_7_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(matchesAnyPattern(H2_UPSTREAM_INTERNAL_ERROR_STREAM_ID_99999_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(
      true,
    );
  });

  it("matches upstream_error vocabulary while preserving generic 500/internal_error non-transient coverage", () => {
    expect(matchesAnyPattern(UPSTREAM_INTERNAL_SERVER_ERROR_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(false);
    expect(matchesAnyPattern(UPSTREAM_ERROR_PROVIDER_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(matchesAnyPattern(HTTP_500_INTERNAL_SERVER_ERROR_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(false);
    expect(matchesAnyPattern(STREAM_ERROR_ONLY_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(false);
    expect(matchesAnyPattern(INTERNAL_ERROR_ONLY_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(false);
  });

  it("defines concrete transient HTTP statuses", () => {
    expect(TRANSIENT_HTTP_STATUSES).toEqual([429, 502, 503, 504]);
  });

  it("finds task-error markers in subagent output", () => {
    expect(containsAnyMarker(TEST_FAILURE_OUTPUT, TASK_ERROR_MARKERS)).toBe(true);
    expect(containsAnyMarker(BUILD_FAILURE_OUTPUT, TASK_ERROR_MARKERS)).toBe(true);
  });

  it("keeps review decisions separate from task-error markers", () => {
    expect(REVIEW_DECISION_MARKERS).toContain(REVIEW_DECISION_MARKER);
    expect(TASK_ERROR_MARKERS).not.toContain(REVIEW_DECISION_MARKER);
    expect(TASK_ERROR_MARKERS).toContain("TEST FAILED");
    expect(TASK_ERROR_MARKERS).toContain("BUILD FAILED");
  });

  it("finds review-decision markers in subagent output", () => {
    expect(containsAnyMarker(REVIEW_DECISION_OUTPUT, REVIEW_DECISION_MARKERS)).toBe(true);
  });

  it("finds blocked markers in subagent output", () => {
    expect(containsAnyMarker(BLOCKED_OUTPUT, BLOCKED_MARKERS)).toBe(true);
    expect(containsAnyMarker(ESCALATED_OUTPUT, BLOCKED_MARKERS)).toBe(true);
  });

  it("does not find markers in successful output", () => {
    expect(containsAnyMarker(SUCCESS_OUTPUT, TASK_ERROR_MARKERS)).toBe(false);
    expect(containsAnyMarker(SUCCESS_OUTPUT, BLOCKED_MARKERS)).toBe(false);
  });
});
