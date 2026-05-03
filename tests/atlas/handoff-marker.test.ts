import { describe, expect, it } from "bun:test";

import { extractHandoff, renderHandoffBlock, upsertHandoffMarker } from "@/atlas/handoff-marker";
import type { AtlasHandoff } from "@/atlas/types";

const SAMPLE_HANDOFF: AtlasHandoff = {
  lifecycleIssue: 26,
  affectedModules: ["lifecycle"],
  affectedFeatures: ["atlas"],
  designPointer: "thoughts:shared/designs/x.md",
  planPointer: "thoughts:shared/plans/y.md",
  ledgerPointer: null,
  decisions: ["use mtime detection"],
  crossLayerEffects: ["expect Behavior layer update"],
  doNotTouch: ["10-impl/critical.md"],
};

describe("atlas handoff marker", () => {
  it("renders begin/end markers with embedded JSON", () => {
    const block = renderHandoffBlock(SAMPLE_HANDOFF);
    expect(block).toContain("<!-- micode:atlas:handoff:begin -->");
    expect(block).toContain("<!-- micode:atlas:handoff:end -->");
    expect(block).toContain('"lifecycleIssue": 26');
  });

  it("round trips upsert and extract", () => {
    const body = "existing issue body";
    const updated = upsertHandoffMarker(body, SAMPLE_HANDOFF);
    const extracted = extractHandoff(updated);
    expect(extracted).toEqual(SAMPLE_HANDOFF);
  });

  it("returns null when marker missing", () => {
    expect(extractHandoff("no marker here")).toBe(null);
  });
});
