import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectThoughtsSources } from "@/atlas/sources/thoughts";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-th-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectThoughtsSources", () => {
  it("returns design and plan pointers", async () => {
    const designs = join(projectRoot, "thoughts", "shared", "designs");
    const plans = join(projectRoot, "thoughts", "shared", "plans");
    mkdirSync(designs, { recursive: true });
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(designs, "a.md"), "# a", "utf8");
    writeFileSync(join(plans, "b.md"), "# b", "utf8");
    const sources = await collectThoughtsSources(projectRoot);
    const pointers = sources.map((s) => s.pointer);
    expect(pointers).toContain("thoughts:shared/designs/a.md");
    expect(pointers).toContain("thoughts:shared/plans/b.md");
  });

  it("returns empty when thoughts missing", async () => {
    expect(await collectThoughtsSources(projectRoot)).toEqual([]);
  });
});
