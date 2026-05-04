import { describe, expect, it } from "bun:test";

import { detectTriggerOverlap } from "@/skill-autopilot/writer/overlap";

describe("detectTriggerOverlap", () => {
  it("returns null when overlap below threshold", () => {
    const r = detectTriggerOverlap({
      candidateTrigger: "before commit run lint",
      existing: [{ name: "build-test", trigger: "after merge run build and test" }],
      threshold: 0.6,
      supersedes: null,
    });
    expect(r).toBeNull();
  });

  it("returns the conflicting skill name when overlap exceeds threshold", () => {
    const r = detectTriggerOverlap({
      candidateTrigger: "before commit run lint and tests",
      existing: [{ name: "lint-tests", trigger: "before commit run lint and tests" }],
      threshold: 0.6,
      supersedes: null,
    });
    expect(r).toBe("lint-tests");
  });

  it("returns null when supersedes targets the conflicting skill", () => {
    const r = detectTriggerOverlap({
      candidateTrigger: "before commit run lint and tests",
      existing: [{ name: "lint-tests", trigger: "before commit run lint and tests" }],
      threshold: 0.6,
      supersedes: "lint-tests",
    });
    expect(r).toBeNull();
  });
});
