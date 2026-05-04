import { describe, expect, it } from "bun:test";

import { renderColdInitNode } from "@/atlas/cold-init/renderer";
import { ATLAS_LAYERS } from "@/atlas/types";

describe("renderColdInitNode", () => {
  it("renders a non-inferred node without the draft preamble", () => {
    const out = renderColdInitNode({
      node: {
        id: "10-impl/alpha",
        layer: ATLAS_LAYERS.IMPL,
        relativePath: "10-impl/alpha.md",
        title: "alpha",
        summary: "Handles X.",
        sources: ["code:src/alpha"],
        connections: [],
        inferred: false,
      },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("# alpha");
    expect(out).toContain("Handles X.");
    expect(out).not.toContain("early draft inferred");
  });

  it("prepends a source-backed draft preamble for inferred nodes", () => {
    const out = renderColdInitNode({
      node: {
        id: "20-behavior/x",
        layer: ATLAS_LAYERS.BEHAVIOR,
        relativePath: "20-behavior/x.md",
        title: "x",
        summary: "Inferred from design.",
        sources: ["thoughts:shared/designs/x.md"],
        connections: ["10-impl/alpha"],
        inferred: true,
      },
      userNote: "User said: this is X.",
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("early draft inferred");
    expect(out).toContain("source(s) listed below");
    expect(out).toContain("[[10-impl/alpha]]");
    expect(out).toContain("User notes");
    expect(out).not.toContain("confidence");
    expect(out).not.toContain("human_authored");
  });
});
