import { describe, expect, it } from "bun:test";
import { ATLAS_MENTAL_MODEL_PROTOCOL, ATLAS_STATUS_VALUES } from "@/agents/atlas-mental-model";

describe("ATLAS_MENTAL_MODEL_PROTOCOL", () => {
  it("contains all four protocol verbs (Read / Maintain / Verify / Report)", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Read">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Maintain">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Verify">');
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain('<step name="Report">');
  });

  it("declares lifecycle as source provider only, not update owner", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("source provider");
    // Hard-fail on any auto-spawn / auto-promote phrasing
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("lifecycle_finish auto-spawn");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).not.toContain("auto promote");
  });

  it("declares leaf-agent boundary explicitly", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("role-of-leaf-agents");
    // Leaf agents do not call atlas_lookup directly
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toMatch(/不调用 atlas_lookup|do not call atlas_lookup/);
    // Leaf agents escalate via reviewer report, not via writing
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("Atlas observation: stale-detected");
  });

  it("requires Chinese-first project information in prose", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("中文优先");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("frontmatter");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("wikilink");
  });

  it("exports the canonical status value list (extended for live-knowledge)", () => {
    expect(ATLAS_STATUS_VALUES).toEqual([
      "consulted",
      "read-only",
      "maintained",
      "verified",
      "no-change",
      "delta-created",
      "stale-detected",
      "conflict",
      "blocked",
      "cannot-assess",
    ]);
  });

  it("references all status values in the protocol body", () => {
    for (const status of ATLAS_STATUS_VALUES) {
      expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain(status);
    }
  });

  it("references the delta artifact path convention (fallback path, not main route)", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("thoughts/shared/atlas-deltas/");
  });

  it("describes Maintain checkpoint granularity", () => {
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toContain("checkpoint");
    expect(ATLAS_MENTAL_MODEL_PROTOCOL).toMatch(/batch 完成|每个稳定 checkpoint/);
  });
});
