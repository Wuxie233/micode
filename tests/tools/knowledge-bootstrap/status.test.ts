import { describe, expect, it } from "bun:test";

import { renderBootstrapStatus } from "@/tools/knowledge-bootstrap/status";
import type { KnowledgeState } from "@/tools/knowledge-bootstrap/types";

const FIXED_DATE = new Date("2026-05-12T10:00:00Z");

function buildState(overrides: Partial<KnowledgeState> = {}): KnowledgeState {
  return {
    init: "missing",
    mindmodel: "missing",
    atlas: "missing",
    projectMemory: { entries: 0, healthy: false },
    files: {
      architectureMd: { exists: false },
      codeStyleMd: { exists: false },
      mindmodelManifest: { exists: false },
      atlasIndex: { exists: false },
    },
    ...overrides,
  };
}

const EMPTY_ATLAS_STATUS = {
  openChallenges: 0,
  brokenWikilinks: 0,
  orphanStagingDirs: 0,
  staleNodes: 0,
  lastSuccessfulRun: null,
  spawnReceiptDiff: 0,
};

describe("renderBootstrapStatus", () => {
  it("renders an all-missing report and recommends /all-init", () => {
    const out = renderBootstrapStatus(buildState(), EMPTY_ATLAS_STATUS);
    expect(out).toContain("/init layer");
    expect(out).toContain("missing");
    expect(out).toContain(".mindmodel/");
    expect(out).toContain("atlas/");
    expect(out).toContain("/all-init");
  });

  it("renders an all-present report and recommends /all-rebuild", () => {
    const state = buildState({
      init: "present",
      mindmodel: "present",
      atlas: "present",
      files: {
        architectureMd: { exists: true, mtime: FIXED_DATE },
        codeStyleMd: { exists: true, mtime: FIXED_DATE },
        mindmodelManifest: { exists: true, mtime: FIXED_DATE },
        atlasIndex: { exists: true, mtime: FIXED_DATE },
      },
    });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("present");
    expect(out).toContain("/all-rebuild");
  });

  it("surfaces atlas open challenges count", () => {
    const out = renderBootstrapStatus(buildState({ atlas: "present" }), {
      ...EMPTY_ATLAS_STATUS,
      openChallenges: 3,
    });
    expect(out).toContain("open challenges");
    expect(out).toContain("3");
  });

  it("surfaces broken wikilinks count", () => {
    const out = renderBootstrapStatus(buildState({ atlas: "present" }), {
      ...EMPTY_ATLAS_STATUS,
      brokenWikilinks: 2,
    });
    expect(out).toContain("broken wikilinks");
    expect(out).toContain("2");
  });

  it("includes mtime for present files when available", () => {
    const state = buildState({
      init: "present",
      files: {
        architectureMd: { exists: true, mtime: FIXED_DATE },
        codeStyleMd: { exists: true, mtime: FIXED_DATE },
        mindmodelManifest: { exists: false },
        atlasIndex: { exists: false },
      },
    });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("2026-05-12");
  });

  it("includes Project Memory summary line", () => {
    const state = buildState({ projectMemory: { entries: 42, healthy: true } });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("Project Memory");
    expect(out).toContain("42");
  });
});
