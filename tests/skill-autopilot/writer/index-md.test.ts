import { describe, expect, it } from "bun:test";

import { renderIndexMd } from "@/skill-autopilot/writer/index-md";

describe("renderIndexMd", () => {
  it("renders header and rows in name order", () => {
    const md = renderIndexMd([
      { name: "z-skill", description: "Z", hits: 3, lastUpdated: "2026-05-04", deprecated: false },
      { name: "a-skill", description: "A", hits: 5, lastUpdated: "2026-05-03", deprecated: false },
    ]);

    expect(md).toContain("# Skills");
    expect(md.indexOf("a-skill")).toBeLessThan(md.indexOf("z-skill"));
  });

  it("marks deprecated skills inline", () => {
    const md = renderIndexMd([{ name: "old", description: "x", hits: 1, lastUpdated: "2026-01-01", deprecated: true }]);

    expect(md).toContain("(deprecated)");
  });

  it("renders an empty placeholder when no skills exist", () => {
    expect(renderIndexMd([])).toContain("(no skills yet)");
  });
});
