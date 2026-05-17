import { describe, expect, test } from "vitest";
import {
  WORKFLOW_CONTINUATION_RETRY_POLICY,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
} from "@/workflow-retry/policy";

describe("WORKFLOW_CONTINUATION_RETRY_POLICY", () => {
  test("default maxAttempts is 20", () => {
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(20);
  });

  test("default intervalMs is 30000", () => {
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);
    expect(DEFAULT_INTERVAL_MS).toBe(30_000);
  });

  test("policy is frozen / readonly at runtime", () => {
    expect(Object.isFrozen(WORKFLOW_CONTINUATION_RETRY_POLICY)).toBe(true);
  });

  test("attemptKey combines sessionId and errorClass deterministically", () => {
    const { attemptKey } = WORKFLOW_CONTINUATION_RETRY_POLICY;
    expect(attemptKey("ses_abc", "upstream_error")).toBe("ses_abc:upstream_error");
    expect(attemptKey("ses_abc", "upstream_error")).toBe(
      attemptKey("ses_abc", "upstream_error"),
    );
  });
});
