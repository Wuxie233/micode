import { describe, expect, it } from "bun:test";

import { ATLAS_COMMIT_PREFIX } from "@/atlas/config";
import { buildAtlasCommitMessage, validateStagedPaths } from "@/atlas/git";

describe("atlas git utility", () => {
  it("prefixes commit messages with atlas:", () => {
    expect(buildAtlasCommitMessage("touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("does not double-prefix", () => {
    expect(buildAtlasCommitMessage("atlas: touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("validates that staged paths live entirely under atlas/", () => {
    expect(validateStagedPaths(["atlas/10-impl/x.md", "atlas/_meta/log/run.md"])).toEqual({ ok: true });
    expect(validateStagedPaths(["atlas/x.md", "src/y.ts"])).toEqual({
      ok: false,
      reason: "non-atlas paths staged: src/y.ts",
    });
    expect(validateStagedPaths([])).toEqual({ ok: false, reason: "no atlas paths staged" });
  });
});
