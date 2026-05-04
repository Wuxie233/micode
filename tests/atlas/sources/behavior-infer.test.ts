import { describe, expect, it } from "bun:test";

import { inferBehaviorDrafts } from "@/atlas/sources/behavior-infer";

describe("inferBehaviorDrafts", () => {
  it("creates a draft per terminal lifecycle issue with a User Perspective section", () => {
    const drafts = inferBehaviorDrafts({
      lifecycle: [
        {
          pointer: "lifecycle:26",
          issueNumber: 26,
          state: "terminal",
          designPointers: ["thoughts/shared/designs/x.md"],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
      designContents: { "thoughts/shared/designs/x.md": "## User Perspective\n\nThe user wants Y.\n" },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("behavior/lifecycle-26");
    expect(drafts[0].userPerspective).toContain("The user wants Y.");
    expect(drafts[0].sources).toContain("lifecycle:26");
  });

  it("skips lifecycles with no User Perspective section", () => {
    const drafts = inferBehaviorDrafts({
      lifecycle: [
        {
          pointer: "lifecycle:1",
          issueNumber: 1,
          state: "terminal",
          designPointers: ["thoughts/shared/designs/y.md"],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
      designContents: { "thoughts/shared/designs/y.md": "no user section" },
    });
    expect(drafts).toEqual([]);
  });
});
