import { describe, expect, it } from "bun:test";

import { selfReferenceGate } from "@/skill-autopilot/security/self-reference-gate";

const PLACEHOLDER_MARKERS = /\b(?:todo|placeholder|lorem ipsum)\b/i;

const LIFECYCLE_TOOLING_SAMPLES = [
  "lifecycle workflow should be handled by native tooling",
  "executor dispatch belongs to OpenCode native agents",
  "open issue for this implementation before planning",
  "spawn-agent fanout must stay outside captured skills",
  "batch_completed should be lifecycle state only",
  "worktree create is native lifecycle setup",
];

function inp(text: string) {
  return { name: "n", description: text, trigger: "t", steps: [text], body: text, frontmatter: { name: "n" } };
}

describe("selfReferenceGate", () => {
  it.each([
    "skillEvolution should be disabled",
    "skillAutopilot must skip this step",
    "set features.skillAutopilot to false",
    "disable skill capture",
    "skip skill capture for this lifecycle",
  ])("rejects %s", (t) => {
    expect(selfReferenceGate(inp(t)).ok).toBe(false);
  });

  it("passes neutral content", () => {
    expect(selfReferenceGate(inp("run bun run check")).ok).toBe(true);
  });

  it.each(LIFECYCLE_TOOLING_SAMPLES)("rejects native lifecycle tooling reference: %s", (text) => {
    expect(text).not.toMatch(PLACEHOLDER_MARKERS);

    const result = selfReferenceGate(inp(text));

    expect(result.ok).toBe(false);
  });
});
