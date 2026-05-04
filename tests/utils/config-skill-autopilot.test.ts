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
    expect(sa.recurrenceMinHits).toBe(2);
    expect(sa.recurrenceMinDistinctIssues).toBe(2);
    expect(sa.maxWritesPerLifecycle).toBeGreaterThanOrEqual(1);
    expect(sa.triggerOverlapThreshold).toBeGreaterThan(0);
    expect(sa.runtimeInstallPath).toBe("/root/.micode");
  });

  it("uses a public-by-default sensitivity policy", () => {
    const sensitivities = config.skillAutopilot.allowedAutoWriteSensitivities;

    expect(config.skillAutopilot.defaultSensitivity).toBe("public");
    expect(sensitivities).toEqual(["public"]);
    expect(sensitivities).not.toContain("internal");
    expect(sensitivities).not.toContain("secret");
  });
});
