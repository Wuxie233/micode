import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("config.skillAutopilot", () => {
  it("ships every tunable required by the autopilot pipeline with safe defaults", () => {
    const sa = config.skillAutopilot;
    expect(sa.skillsDir).toBe(".opencode/skills");
    expect(sa.indexFile).toBe(".opencode/skills/INDEX.md");
    expect(sa.rejectionsJournal).toBe(".opencode/skills/.rejections.jsonl");
    expect(sa.descriptionMaxBytes).toBe(1024);
    expect(sa.bodyMaxBytes).toBeGreaterThan(0);
    expect(sa.maxStepsPerSkill).toBeGreaterThan(0);
    expect(sa.maxSkillsPerProject).toBeGreaterThan(0);
    expect(sa.maxIndexBytes).toBeGreaterThan(0);
    expect(sa.injectionCharBudget).toBeGreaterThan(0);
    expect(sa.injectionSensitivityCeiling).toBe("internal");
    expect(sa.recurrenceMinHits).toBe(2);
    expect(sa.recurrenceMinDistinctIssues).toBe(2);
    expect(sa.maxWritesPerLifecycle).toBeGreaterThanOrEqual(1);
    expect(sa.triggerOverlapThreshold).toBeGreaterThan(0);
    expect(sa.runtimeInstallPath).toBe("/root/.micode");
  });

  it("supports x-micode-agent-scope defaults that exclude reviewer/planner/executor", () => {
    expect(config.skillAutopilot.defaultAgentScope).toEqual(
      expect.arrayContaining(["implementer-frontend", "implementer-backend", "implementer-general"]),
    );
    expect(config.skillAutopilot.defaultAgentScope).not.toContain("reviewer");
    expect(config.skillAutopilot.defaultAgentScope).not.toContain("planner");
    expect(config.skillAutopilot.defaultAgentScope).not.toContain("executor");
  });
});
