import { describe, expect, it } from "bun:test";

import { renderEmptyNode, renderIndexPage, renderPhaseRoadmap } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

describe("page templates", () => {
  it("renders an empty impl node with required H2 sections", () => {
    const text = renderEmptyNode({
      id: "impl/sample",
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "Sample module",
      sources: ["code:src/sample.ts"],
      lastVerifiedCommit: "abc",
      lastWrittenMtime: 1,
    });
    expect(text).toContain("## Summary");
    expect(text).toContain("## Connections");
    expect(text).toContain("## Sources");
    expect(text).toContain("## Notes");
    expect(text).toContain("Sample module");
    expect(text).toContain("- code:src/sample.ts");
  });

  it("renders the index page header", () => {
    const text = renderIndexPage({ projectName: "demo" });
    expect(text).toContain("# demo");
    expect(text).toContain("agent2");
  });

  it("renders the phase roadmap with phase 2 and phase 3 sections", () => {
    const text = renderPhaseRoadmap();
    expect(text).toContain("Phase 2: Closed-loop integration");
    expect(text).toContain("Phase 3");
    expect(text).toContain("layer: decision");
  });
});
