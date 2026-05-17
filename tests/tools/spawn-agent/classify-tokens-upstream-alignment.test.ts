import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "@/workflow-retry/policy";
import {
  isRecoverableUpstreamError,
  matchesAnyPattern,
  TRANSIENT_NETWORK_PATTERNS,
} from "../../../src/tools/spawn-agent/classify-tokens";

const UPSTREAM_ERROR_MESSAGE = "upstream_error: Upstream request failed";
const STREAM_INTERNAL_ERROR_MESSAGE = "stream error: stream ID 1261; INTERNAL_ERROR; received from peer";
const ECONNRESET_MESSAGE = "Provider request failed with ECONNRESET while streaming.";

describe("spawn-agent classify token upstream retry alignment", () => {
  it("accepts upstream_error and stream INTERNAL_ERROR through the shared workflow predicate", () => {
    expect(isRecoverableUpstreamError(UPSTREAM_ERROR_MESSAGE)).toBe(true);
    expect(isRecoverableUpstreamError(STREAM_INTERNAL_ERROR_MESSAGE)).toBe(true);
  });

  it("keeps ECONNRESET as spawn-agent-only transient vocabulary", () => {
    expect(matchesAnyPattern(ECONNRESET_MESSAGE, TRANSIENT_NETWORK_PATTERNS)).toBe(true);
    expect(isRecoverableUpstreamError(ECONNRESET_MESSAGE)).toBe(false);
  });

  it("keeps spawn_agent inner retry defaults separate from workflow continuation policy", () => {
    expect(config.subagent.transientRetries).toBe(2);
    expect(config.subagent.transientRetryBudgetMs).toBe(45_000);

    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts * WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(600_000);

    expect(config.subagent.transientRetries).not.toBe(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts);
    expect(config.subagent.transientRetryBudgetMs).not.toBe(
      WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts * WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs,
    );
  });
});
