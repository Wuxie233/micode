import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createStagingManager } from "@/atlas/staging";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-staging-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("staging manager", () => {
  it("creates and cleans up a per-run staging directory", () => {
    const sm = createStagingManager(projectRoot, "run-1");
    sm.create();
    expect(existsSync(sm.dir)).toBe(true);
    sm.cleanup();
    expect(existsSync(sm.dir)).toBe(false);
  });

  it("rollback removes the staging directory", () => {
    const sm = createStagingManager(projectRoot, "run-2");
    sm.create();
    sm.rollback();
    expect(existsSync(sm.dir)).toBe(false);
  });

  it("dir resolves under atlas/_meta/staging", () => {
    const sm = createStagingManager(projectRoot, "run-3");
    expect(sm.dir).toBe(join(projectRoot, "atlas", "_meta", "staging", "run-3"));
  });
});
