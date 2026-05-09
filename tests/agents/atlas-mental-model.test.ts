import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL, ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";

describe("ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  it("contains all four protocol sections", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Consult");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Detect");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Propose");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Merge");
  });

  it("declares lifecycle as source provider only, not update owner", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("source provider");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("lifecycle_finish auto-spawn");
  });

  it("requires Chinese-first project information in delta prose", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("中文优先");
    // machine syntax allowlist must be explicit
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("frontmatter");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("wikilink");
  });

  it("exports the canonical status value list", () => {
    expect(ATLAS_STATUS_VALUES).toEqual([
      "consulted",
      "no-change",
      "delta-created",
      "stale-detected",
      "blocked",
      "cannot-assess",
    ]);
  });

  it("references the delta artifact path convention", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("thoughts/shared/atlas-deltas/");
  });
});
