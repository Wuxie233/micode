import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("config.skillEvolution tunables", () => {
  it("exposes all expected tunables with conservative defaults", () => {
    expect(config.skillEvolution.maxInjectedProcedures).toBeGreaterThan(0);
    expect(config.skillEvolution.maxInjectedProcedures).toBeLessThanOrEqual(5);
    expect(config.skillEvolution.injectionCharBudget).toBeGreaterThan(0);
    expect(config.skillEvolution.injectionCharBudget).toBeLessThanOrEqual(2000);
    expect(config.skillEvolution.candidateExpiryDays).toBeGreaterThanOrEqual(7);
    expect(config.skillEvolution.maxCandidatesPerProject).toBeGreaterThan(0);
    expect(config.skillEvolution.snippetMaxChars).toBeGreaterThan(0);
    expect(config.skillEvolution.injectionSensitivityCeiling).toBe("internal");
  });
});
