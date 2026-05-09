import { describe, expect, it } from "bun:test";

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { reviewerAgent } from "@/agents/reviewer";

describe("reviewer prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(reviewerAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("appends a reviewer-specific detect-only block", () => {
    const p = reviewerAgent.prompt ?? "";
    expect(p).toContain("<atlas-detect-role");
    expect(p).toContain("do NOT write atlas deltas");
  });
});
