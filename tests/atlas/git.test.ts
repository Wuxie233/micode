import { describe, expect, it } from "bun:test";

import { ATLAS_COMMIT_PREFIX } from "@/atlas/config";
import {
  buildAtlasCommitMessage,
  buildAtlasInitCommitSummary,
  buildAtlasTranslateCommitSummary,
  validateStagedPaths,
} from "@/atlas/git";

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

  it("buildAtlasInitCommitSummary describes the cold-init run", () => {
    const summary = buildAtlasInitCommitSummary({ runId: "20260505T120000-abc" });
    expect(summary).toContain("init");
    expect(summary).toContain("20260505T120000-abc");
  });

  it("buildAtlasTranslateCommitSummary describes the translate run with target", () => {
    const allSummary = buildAtlasTranslateCommitSummary({ runId: "20260505T120100-xyz", targetPath: "all" });
    expect(allSummary).toContain("translate");
    expect(allSummary).toContain("20260505T120100-xyz");
    expect(allSummary).toContain("all");

    const scopedSummary = buildAtlasTranslateCommitSummary({
      runId: "20260505T120200-def",
      targetPath: "20-behavior",
    });
    expect(scopedSummary).toContain("20-behavior");
  });

  it("commit helpers feed cleanly into buildAtlasCommitMessage", () => {
    const summary = buildAtlasInitCommitSummary({ runId: "run-1" });
    expect(buildAtlasCommitMessage(summary).startsWith(ATLAS_COMMIT_PREFIX)).toBe(true);
  });
});
