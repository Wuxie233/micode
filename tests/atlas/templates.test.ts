import { describe, expect, it } from "bun:test";

import { renderEmptyNode, renderIndexPage, renderPhaseRoadmap } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

describe("page templates", () => {
  it("renders an empty impl node with required Chinese H2 sections", () => {
    const text = renderEmptyNode({
      id: "impl/sample",
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "Sample module",
      sources: ["code:src/sample.ts"],
      lastVerifiedCommit: "abc",
      lastWrittenMtime: 1,
    });
    expect(text).toContain("## 摘要");
    expect(text).toContain("## 关联");
    expect(text).toContain("## 来源");
    expect(text).toContain("## 备注");
    expect(text).toContain("Sample module");
    expect(text).toContain("- code:src/sample.ts");
  });

  it("renders the index page header", () => {
    const text = renderIndexPage({ projectName: "demo" });
    expect(text).toContain("# demo");
    expect(text).toContain("agent2");
  });

  it("renders the phase roadmap with phase 2 and phase 3 sections (Chinese prose)", () => {
    const text = renderPhaseRoadmap();
    expect(text).toContain("Phase 2:");
    expect(text).toContain("Phase 3:");
    expect(text).toContain("layer: decision");
    // Prose is in Chinese
    expect(text).toContain("闭环集成");
  });
});
