import { describe, expect, it } from "bun:test";

import { deriveDisplayExtras } from "@/atlas/display-extras";

describe("deriveDisplayExtras", () => {
  it("returns title, aliases, and source_path when title and a code source are provided", () => {
    const out = deriveDisplayExtras({
      title: "Lifecycle 状态机",
      id: "10-impl/lifecycle-state-machine",
      sources: ["code:src/lifecycle/runner.ts", "thoughts:shared/designs/x.md"],
    });
    expect(out).toEqual({
      title: "Lifecycle 状态机",
      aliases: "10-impl/lifecycle-state-machine",
      source_path: "src/lifecycle/runner.ts",
    });
  });

  it("omits source_path when no code: pointer is present", () => {
    const out = deriveDisplayExtras({
      title: "决策记录",
      id: "40-decisions/foo",
      sources: ["thoughts:shared/designs/x.md"],
    });
    expect(out.source_path).toBeUndefined();
    expect(out.title).toBe("决策记录");
    expect(out.aliases).toBe("40-decisions/foo");
  });

  it("uses the FIRST code: pointer when multiple are present", () => {
    const out = deriveDisplayExtras({
      title: "T",
      id: "id",
      sources: ["code:src/a.ts", "code:src/b.ts"],
    });
    expect(out.source_path).toBe("src/a.ts");
  });

  it("strips a #L line anchor from source_path", () => {
    const out = deriveDisplayExtras({
      title: "T",
      id: "id",
      sources: ["code:src/a.ts#L10-L20"],
    });
    expect(out.source_path).toBe("src/a.ts");
  });

  it("omits title when empty or whitespace only", () => {
    const out = deriveDisplayExtras({ title: "   ", id: "id", sources: [] });
    expect(out.title).toBeUndefined();
    expect(out.aliases).toBe("id");
  });

  it("omits aliases when id equals title (no extra information)", () => {
    const out = deriveDisplayExtras({ title: "Same", id: "Same", sources: [] });
    expect(out.aliases).toBeUndefined();
    expect(out.title).toBe("Same");
  });
});
