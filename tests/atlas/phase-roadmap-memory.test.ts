import { describe, expect, it } from "bun:test";

import { ATLAS_PHASE_3_OPEN_QUESTIONS, buildAtlasPhaseMemoryEntries } from "@/atlas/phase-roadmap-memory";

describe("atlas phase roadmap memory entries", () => {
  it("declares one open_question per Phase 3 item", () => {
    expect(ATLAS_PHASE_3_OPEN_QUESTIONS.length).toBeGreaterThanOrEqual(7);
    for (const item of ATLAS_PHASE_3_OPEN_QUESTIONS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.trigger.length).toBeGreaterThan(0);
    }
  });

  it("builds memory-shaped entries with type=open_question and tentative status", () => {
    const entries = buildAtlasPhaseMemoryEntries();
    for (const entry of entries) {
      expect(entry.type).toBe("open_question");
      expect(entry.status).toBe("tentative");
      expect(entry.title).toMatch(/atlas phase 3/i);
    }
  });
});
