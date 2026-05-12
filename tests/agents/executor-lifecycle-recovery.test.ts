import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

describe("executor lifecycle commit recovery guidance", () => {
  it("tells executor to retry lifecycle_commit recovery hints only for safe push failures", () => {
    expect(executorAgent.prompt).toContain("### Recovery hint");
    expect(executorAgent.prompt).toContain("failure_kind=push_failed");
    expect(executorAgent.prompt).toContain("safe_to_retry=true");
    expect(executorAgent.prompt).toMatch(/retry once only/i);
  });

  it("preserves non-retryable recovery metadata verbatim in the final report", () => {
    expect(executorAgent.prompt).toContain("failure_kind");
    expect(executorAgent.prompt).toContain("recommended_next_action");
    expect(executorAgent.prompt).toContain("summary");
    expect(executorAgent.prompt).toMatch(/verbatim/i);
    expect(executorAgent.prompt).toContain("brainstormer can recover");
  });

  it("keeps lifecycle_finish owned by brainstormer and forbids unsafe git recovery shortcuts", () => {
    expect(executorAgent.prompt).toContain("Never call lifecycle_finish");
    expect(executorAgent.prompt).toContain("push --force");
    expect(executorAgent.prompt).toContain("--force-with-lease");
    expect(executorAgent.prompt).toContain("--no-verify");
    expect(executorAgent.prompt).toContain("reset --hard");
  });
});
