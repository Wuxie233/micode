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

  it("renderEmptyNode: body Sources renders code: pointers as GitHub permalinks", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "summary",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("[查看源码 src/x.ts](https://github.com/foo/bar/blob/main/src/x.ts)");
    // Frontmatter sources stay raw.
    expect(out).toContain("  - code:src/x.ts");
  });

  it("renderEmptyNode: writes title/aliases/source_path into frontmatter extras", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      title: "X 模块",
      summary: "s",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("title: X 模块");
    expect(out).toContain("aliases: 10-impl/x");
    expect(out).toContain("source_path: src/x.ts");
  });

  it("renderEmptyNode: backward compatible — works without title or repoBase", () => {
    const out = renderEmptyNode({
      id: "10-impl/x",
      layer: "impl",
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "s",
      sources: [],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    // No title key emitted when title is absent; aliases still written from id.
    expect(out).not.toMatch(/^title:/m);
    expect(out).toContain("aliases: 10-impl/x");
  });

  it("renders the index page header", () => {
    const text = renderIndexPage({ projectName: "demo" });
    expect(text).toContain("# demo");
    expect(text).toContain("agent2");
  });

  it("renders the phase roadmap with phase 2 and phase 3 sections", () => {
    const text = renderPhaseRoadmap();
    expect(text).toContain("Phase 2: Closed-loop integration");
    expect(text).toContain("comprehensive cold-start orchestrator independent of lifecycle handoff");
    expect(text).toContain("Phase 3");
    expect(text).toContain("layer: decision");
  });
});
