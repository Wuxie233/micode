import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectMindmodelSources } from "@/atlas/sources/mindmodel";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-mm-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectMindmodelSources", () => {
  it("returns mindmodel pointers under .mindmodel", async () => {
    const dir = join(projectRoot, ".mindmodel", "patterns");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "factory.md"), "# factory", "utf8");

    const sources = await collectMindmodelSources(projectRoot);

    expect(sources).toContainEqual({
      pointer: "mindmodel:patterns/factory",
      relativePath: ".mindmodel/patterns/factory.md",
    });
  });

  it("returns empty when mindmodel missing", async () => {
    expect(await collectMindmodelSources(projectRoot)).toEqual([]);
  });
});
