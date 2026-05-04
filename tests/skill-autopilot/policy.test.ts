import { describe, expect, it } from "bun:test";

import { decidePolicy } from "@/skill-autopilot/policy";

const baseCandidate = {
  id: "cand_x",
  dedupeKey: "k1",
  projectId: "p",
  trigger: "before commit run lint",
  steps: ["a"],
  sources: [],
  lifecycleIssueNumber: 27,
} as const;

describe("decidePolicy", () => {
  it("skips when hits below recurrenceMinHits", () => {
    const r = decidePolicy({
      candidate: baseCandidate,
      hitsByKey: { k1: 1 },
      distinctIssuesByKey: { k1: new Set([27]) },
      existingSkills: [],
      writesThisLifecycle: 0,
    });
    expect(r.action).toBe("skip");
  });

  it("skips when only one distinct lifecycle has the candidate", () => {
    const r = decidePolicy({
      candidate: baseCandidate,
      hitsByKey: { k1: 5 },
      distinctIssuesByKey: { k1: new Set([27]) },
      existingSkills: [],
      writesThisLifecycle: 0,
    });
    expect(r.action).toBe("skip");
  });

  it("creates a new skill when hits>=2 across 2+ issues and no existing skill matches", () => {
    const r = decidePolicy({
      candidate: baseCandidate,
      hitsByKey: { k1: 2 },
      distinctIssuesByKey: { k1: new Set([27, 26]) },
      existingSkills: [],
      writesThisLifecycle: 0,
    });
    expect(r.action).toBe("create");
  });

  it("skips when per-lifecycle write ceiling is hit", () => {
    const r = decidePolicy({
      candidate: baseCandidate,
      hitsByKey: { k1: 5 },
      distinctIssuesByKey: { k1: new Set([27, 26]) },
      existingSkills: [],
      writesThisLifecycle: 99,
    });
    expect(r.action).toBe("skip");
  });

  it("patches an existing skill instead of creating a duplicate", () => {
    const r = decidePolicy({
      candidate: baseCandidate,
      hitsByKey: { k1: 5 },
      distinctIssuesByKey: { k1: new Set([27, 26]) },
      existingSkills: [{ name: "before-commit", trigger: "before commit run lint", dedupeKey: "k1" }],
      writesThisLifecycle: 0,
    });
    expect(r.action).toBe("patch");
  });
});
