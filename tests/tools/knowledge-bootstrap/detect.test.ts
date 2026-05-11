import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectKnowledgeState } from "@/tools/knowledge-bootstrap/detect";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-detect-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("detectKnowledgeState", () => {
  it("reports all three layers missing for an empty project", () => {
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("missing");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
    expect(state.files.architectureMd.exists).toBe(false);
    expect(state.files.codeStyleMd.exists).toBe(false);
    expect(state.files.mindmodelManifest.exists).toBe(false);
    expect(state.files.atlasIndex.exists).toBe(false);
    expect(state.projectMemory.entries).toBe(0);
    expect(state.projectMemory.healthy).toBe(false);
  });

  it("reports init=present when both ARCHITECTURE.md and CODE_STYLE.md exist", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("present");
    expect(state.files.architectureMd.exists).toBe(true);
    expect(state.files.codeStyleMd.exists).toBe(true);
    expect(state.files.architectureMd.mtime).toBeInstanceOf(Date);
  });

  it("reports init=missing when only one of ARCHITECTURE.md / CODE_STYLE.md exists", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("missing");
    expect(state.files.architectureMd.exists).toBe(true);
    expect(state.files.codeStyleMd.exists).toBe(false);
  });

  it("reports mindmodel=present when .mindmodel/manifest.yaml exists", () => {
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.mindmodel).toBe("present");
    expect(state.files.mindmodelManifest.exists).toBe(true);
  });

  it("reports atlas=present when atlas/00-index.md exists", () => {
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.atlas).toBe("present");
    expect(state.files.atlasIndex.exists).toBe(true);
  });

  it("reports atlas=missing when atlas/ exists but 00-index.md is absent", () => {
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    const state = detectKnowledgeState(projectRoot);
    expect(state.atlas).toBe("missing");
    expect(state.files.atlasIndex.exists).toBe(false);
  });

  it("reports all three layers present in a fully-bootstrapped project", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("present");
    expect(state.atlas).toBe("present");
  });

  it("includes Project Memory placeholder summary (zero entries by default)", () => {
    const state = detectKnowledgeState(projectRoot);
    expect(state.projectMemory).toEqual({ entries: 0, healthy: false });
  });
});
