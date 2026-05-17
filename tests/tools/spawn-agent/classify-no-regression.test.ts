// tests/tools/spawn-agent/classify-no-regression.test.ts
//
// Drift guard: this issue must NOT change spawn_agent retry behavior.
// If a future change wants to migrate spawn_agent to 20x30s, it must update
// this test deliberately (and update AGENTS.md, design.md, atlas accordingly).

import { describe, expect, test } from "bun:test";

import { classifySpawnError, INTERNAL_CLASSES } from "@/tools/spawn-agent/classify";
import { config } from "@/utils/config";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "@/workflow-retry/policy";

describe("spawn-agent retry behavior unchanged by issue #94", () => {
  test("classify still maps upstream_error: Upstream request failed to TRANSIENT", () => {
    const result = classifySpawnError({ thrown: new Error("upstream_error: Upstream request failed") });
    expect(result.class).toBe(INTERNAL_CLASSES.TRANSIENT);
  });

  test("transientRetries default stays at 2 (not 20)", () => {
    expect(config.subagent.transientRetries).toBe(2);
  });

  test("transientRetryBudgetMs default stays at 45_000 (not 600_000)", () => {
    expect(config.subagent.transientRetryBudgetMs).toBe(45_000);
  });

  test("workflow continuation policy is intentionally different (20 / 30_000)", () => {
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).not.toBe(config.subagent.transientRetries);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).not.toBe(config.subagent.transientRetryBudgetMs);
  });
});
