import { describe, expect, it } from "bun:test";

import { renderColdInitNode } from "@/atlas/cold-init/renderer";
import type { PlannedNode } from "@/atlas/cold-init/types";
import { ATLAS_LAYERS } from "@/atlas/types";

const baseNode: PlannedNode = {
  id: "10-impl/runner",
  layer: ATLAS_LAYERS.IMPL,
  relativePath: "10-impl/runner.md",
  title: "Runner",
  summary: "Runner orchestrates lifecycle commands.",
  sources: ["code:src/lifecycle/runner.ts"],
  connections: [],
  inferred: false,
};

describe("renderColdInitNode", () => {
  it("renders frontmatter and section headings unchanged", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("id: 10-impl/runner");
    expect(out).toContain("# Runner\n");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Connections");
    expect(out).toContain("## Sources");
    expect(out).toContain("- code:src/lifecycle/runner.ts");
  });

  it("uses Chinese empty placeholder _无_ for empty connection lists", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, connections: [] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("_无_");
    expect(out).not.toContain("_none_");
  });

  it("emits a Chinese inferred-draft preamble when node.inferred is true", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, inferred: true, summary: "推断的摘要。" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("推断");
    expect(out).toContain("草稿");
    expect(out).toContain("推断的摘要。");
  });

  it("falls back to a Chinese visible seed when summary is empty", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, summary: "" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("摘要待补全");
  });

  it("preserves wikilinks and code-style identifiers in connections section", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, connections: ["20-behavior/feature-x"] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("[[20-behavior/feature-x]]");
  });

  it("renders user notes verbatim (Chinese or otherwise)", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: "请补充 src/runner.ts 的失败语义。",
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("请补充 src/runner.ts 的失败语义。");
  });

  it("renders code: source bullets as GitHub permalinks in body Sources", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    // Body Sources section uses a clickable link; frontmatter sources stay as raw strings.
    expect(out).toContain(
      "[查看源码 src/lifecycle/runner.ts](https://github.com/foo/bar/blob/main/src/lifecycle/runner.ts)",
    );
    expect(out).toContain("- code:src/lifecycle/runner.ts"); // frontmatter list still raw
  });

  it("writes display extras (title, aliases, source_path) into frontmatter", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, title: "Lifecycle 状态机" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("title: Lifecycle 状态机");
    expect(out).toContain("aliases: 10-impl/runner");
    expect(out).toContain("source_path: src/lifecycle/runner.ts");
  });

  it("preserves non-code source bullets verbatim", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, sources: ["thoughts:shared/designs/x.md", "lifecycle:42"] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      repoBase: "https://github.com/foo/bar",
    });
    expect(out).toContain("- thoughts:shared/designs/x.md");
    expect(out).toContain("- lifecycle:42");
    expect(out).not.toContain("blob/main/thoughts");
  });

  it("falls back to ATLAS_REPO_FALLBACK_BASE when no repoBase is supplied", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("https://github.com/Wuxie233/micode/blob/main/src/lifecycle/runner.ts");
  });
});
