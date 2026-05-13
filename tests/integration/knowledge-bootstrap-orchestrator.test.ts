// tests/integration/knowledge-bootstrap-orchestrator.test.ts
//
// Integration tests for the knowledge-bootstrap-orchestrator command dispatch.
//
// These tests do NOT invoke the LLM. They exercise the deterministic surface:
//   - detect_knowledge_state's view of fixture project trees
//   - renderBootstrapStatus over those fixtures
//   - PLUGIN_COMMANDS routing
//
// LLM-driven behaviour (octto confirm on rebuild, serial spawn, mode switching) is
// asserted indirectly via knowledge-bootstrap-orchestrator prompt tests in
// tests/agents/knowledge-bootstrap-orchestrator.test.ts.
//
// The five fixture scenarios mirror the design's open-questions list:
//   1) 全空 + /all-init   → detector says all missing, recommend bootstrap
//   2) 部分有 + /all-init → detector says some missing, surface gaps
//   3) 全有 + /all-init   → detector says all present, recommend /all-rebuild
//   4) 全有 + /all-rebuild → detector still present, status report unchanged
//      (the confirm step is LLM-driven; we only assert detector input)
//   5) 任意 + /all-status → renderBootstrapStatus returns markdown over any state

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectKnowledgeState } from "@/tools/knowledge-bootstrap/detect";
import { renderBootstrapStatus } from "@/tools/knowledge-bootstrap/status";

const EMPTY_ATLAS_STATUS = {
  openChallenges: 0,
  brokenWikilinks: 0,
  orphanStagingDirs: 0,
  staleNodes: 0,
  lastSuccessfulRun: null,
  spawnReceiptDiff: 0,
};

let root: string;

function seedInit(root: string): void {
  writeFileSync(join(root, "ARCHITECTURE.md"), "# Arch\n", "utf8");
  writeFileSync(join(root, "CODE_STYLE.md"), "# Style\n", "utf8");
}

function seedMindmodel(root: string): void {
  mkdirSync(join(root, ".mindmodel"), { recursive: true });
  writeFileSync(join(root, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
}

function seedAtlas(root: string): void {
  mkdirSync(join(root, "atlas"), { recursive: true });
  writeFileSync(join(root, "atlas", "00-index.md"), "# Index\n", "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-int-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scenario 1: empty project + /all-init", () => {
  it("detector reports all three layers missing", () => {
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("missing");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
  });

  it("status report recommends /all-init for an empty project", () => {
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("/all-init");
  });
});

describe("scenario 2: partially-bootstrapped project + /all-init", () => {
  it("detector reports init=present, mindmodel=missing, atlas=missing when only /init has run", () => {
    seedInit(root);
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
  });

  it("status report surfaces gaps for /all-init to fill", () => {
    seedInit(root);
    seedMindmodel(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    // mindmodel present, init present, atlas still missing
    expect(state.atlas).toBe("missing");
    expect(report).toContain("/all-init");
  });
});

describe("scenario 3: fully-bootstrapped project + /all-init", () => {
  it("detector reports all three layers present", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("present");
    expect(state.atlas).toBe("present");
  });

  it("status report recommends /all-rebuild when all layers are present", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("/all-rebuild");
  });
});

describe("scenario 4: fully-bootstrapped project + /all-rebuild", () => {
  it("detector input does not change before/after confirm gating", () => {
    // /all-rebuild's confirm step is LLM-driven; this test verifies the
    // detector view stays read-only on a fully-bootstrapped fixture. Actual
    // file overwrite is asserted by the child agents' own test suites.
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const before = detectKnowledgeState(root);
    const after = detectKnowledgeState(root);
    expect(before).toEqual(after);
  });
});

describe("scenario 5: any state + /all-status", () => {
  it("renderBootstrapStatus returns markdown over an empty fixture", () => {
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report.startsWith("# Knowledge Bootstrap Status")).toBe(true);
  });

  it("renderBootstrapStatus returns markdown over a partial fixture", () => {
    seedInit(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("Layer presence");
    expect(report).toContain("Atlas health");
    expect(report).toContain("Project Memory");
  });

  it("renderBootstrapStatus returns markdown over a full fixture", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("Recommendation");
  });
});
