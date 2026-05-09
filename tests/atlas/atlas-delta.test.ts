import { describe, expect, it } from "bun:test";

import { buildAtlasDeltaPath, renderAtlasDeltaTemplate } from "@/atlas/atlas-delta";

describe("buildAtlasDeltaPath", () => {
  it("composes the canonical path", () => {
    expect(buildAtlasDeltaPath("2026-05-10", "atlas-shared-mental-model")).toBe(
      "thoughts/shared/atlas-deltas/2026-05-10-atlas-shared-mental-model-delta.md",
    );
  });

  it("rejects topic with whitespace", () => {
    expect(() => buildAtlasDeltaPath("2026-05-10", "atlas shared")).toThrow(/whitespace/u);
  });

  for (const topic of ["../evil", "foo/bar", "Atlas", "foo_bar!"]) {
    it(`rejects invalid topic slug: ${topic}`, () => {
      expect(() => buildAtlasDeltaPath("2026-05-10", topic)).toThrow(/topic/u);
    });
  }

  it("rejects date that is not ISO YYYY-MM-DD", () => {
    expect(() => buildAtlasDeltaPath("2026/5/10", "x")).toThrow(/date/u);
  });
});

describe("renderAtlasDeltaTemplate", () => {
  it("renders frontmatter + Chinese sections", () => {
    const md = renderAtlasDeltaTemplate({
      date: "2026-05-10",
      topic: "atlas-shared-mental-model",
      sourceIssue: 60,
      claims: [
        {
          targetLayer: "10-impl",
          claim: "atlas 是共享心智模型层",
          sources: ["thoughts:shared/designs/2026-05-10-atlas-shared-mental-model-design.md"],
        },
      ],
      impact: "影响 brainstormer / planner / executor / reviewer 等 6 个 agent prompt 与 atlas 自动注入 hook。",
      staleOrUncertain: [],
    });
    expect(md).toContain("date: 2026-05-10");
    expect(md).toContain("source-issue: 60");
    expect(md).toContain("status: draft");
    expect(md).toContain("## Claims");
    expect(md).toContain("**Target:** 10-impl");
    expect(md).toContain("atlas 是共享心智模型层");
    expect(md).toContain("thoughts:shared/designs/2026-05-10-atlas-shared-mental-model-design.md");
    expect(md).toContain("## Impact");
  });

  it("includes the Stale-or-Uncertain section when entries exist", () => {
    const md = renderAtlasDeltaTemplate({
      date: "2026-05-10",
      topic: "x",
      sourceIssue: 60,
      claims: [{ targetLayer: "20-behavior", claim: "c", sources: ["lifecycle:60"] }],
      impact: "i",
      staleOrUncertain: [{ node: "10-impl/foo.md", note: "claim 与现状冲突", evidence: "code:src/foo.ts" }],
    });
    expect(md).toContain("## Stale or Uncertain");
    expect(md).toContain("10-impl/foo.md");
    expect(md).toContain("claim 与现状冲突");
  });
});
