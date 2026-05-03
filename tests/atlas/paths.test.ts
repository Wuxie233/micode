import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAtlasPaths } from "@/atlas/paths";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-paths-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createAtlasPaths", () => {
  it("computes vault root and well-known subdirs", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.root).toBe(join(projectRoot, "atlas"));
    expect(paths.impl).toBe(join(projectRoot, "atlas", "10-impl"));
    expect(paths.behavior).toBe(join(projectRoot, "atlas", "20-behavior"));
    expect(paths.decisions).toBe(join(projectRoot, "atlas", "40-decisions"));
    expect(paths.risks).toBe(join(projectRoot, "atlas", "50-risks"));
    expect(paths.timeline).toBe(join(projectRoot, "atlas", "60-timeline"));
    expect(paths.archive).toBe(join(projectRoot, "atlas", "_archive"));
    expect(paths.meta).toBe(join(projectRoot, "atlas", "_meta"));
    expect(paths.challenges).toBe(join(projectRoot, "atlas", "_meta", "challenges"));
    expect(paths.log).toBe(join(projectRoot, "atlas", "_meta", "log"));
    expect(paths.staging).toBe(join(projectRoot, "atlas", "_meta", "staging"));
  });

  it("computes well-known files", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.indexFile).toBe(join(projectRoot, "atlas", "00-index.md"));
    expect(paths.schemaVersionFile).toBe(join(projectRoot, "atlas", "_meta", "schema-version"));
    expect(paths.lockFile).toBe(join(projectRoot, "atlas", "_meta", ".write.lock"));
    expect(paths.dismissedChallengesFile).toBe(join(projectRoot, "atlas", "_meta", "challenges", "_dismissed.json"));
  });

  it("scopes a run staging directory under the meta staging dir", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.runStaging("agent2-26-100")).toBe(join(projectRoot, "atlas", "_meta", "staging", "agent2-26-100"));
  });
});
