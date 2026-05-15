import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createProjectRegistry } from "@/project-memory/registry";

const UPDATED_AT = 1_234;
const EXPECTED_TWO = 2;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-registry-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function registryPath(): string {
  return join(dir, "registry.json");
}

describe("ProjectRegistry", () => {
  it("returns an empty list when the registry file is missing", async () => {
    const registry = createProjectRegistry({ filePath: registryPath() });

    expect(await registry.load()).toEqual([]);
  });

  it("upserts records and finds them by exact normalized alias", async () => {
    const registry = createProjectRegistry({ filePath: registryPath() });

    await registry.upsert({
      projectId: "project-one",
      aliases: ["  MiCode  ", "Plugin"],
      worktrees: [],
      updatedAt: UPDATED_AT,
    });

    expect((await registry.findByAlias("micode")).map((record) => record.projectId)).toEqual(["project-one"]);
    expect(await registry.findByAlias("mico")).toEqual([]);
    expect((await registry.load())[0]?.aliases).toEqual(["micode", "plugin"]);
  });

  it("treats SSH and HTTPS origins for the same repository as identical", async () => {
    const registry = createProjectRegistry({ filePath: registryPath() });

    await registry.upsert({
      projectId: "project-one",
      origin: "git@github.com:Wuxie233/micode.git",
      aliases: [],
      worktrees: [],
      updatedAt: UPDATED_AT,
    });

    expect(
      (await registry.findByOrigin("https://github.com/wuxie233/micode.git")).map((record) => record.projectId),
    ).toEqual(["project-one"]);
    expect((await registry.load())[0]?.origin).toBe("github.com/wuxie233/micode");
  });

  it("normalizes worktree paths to absolute paths before matching", async () => {
    const registry = createProjectRegistry({ filePath: registryPath() });
    const worktree = join(dir, "../project-worktree");

    await registry.upsert({
      projectId: "project-one",
      aliases: [],
      worktrees: [worktree],
      updatedAt: UPDATED_AT,
    });

    expect((await registry.findByWorktree(worktree)).map((record) => record.projectId)).toEqual(["project-one"]);
    expect((await registry.load())[0]?.worktrees).toEqual([resolve(worktree)]);
  });

  it("returns all records that share the same exact alias", async () => {
    const registry = createProjectRegistry({ filePath: registryPath() });

    await registry.upsert({ projectId: "project-one", aliases: ["micode"], worktrees: [], updatedAt: UPDATED_AT });
    await registry.upsert({ projectId: "project-two", aliases: ["micode"], worktrees: [], updatedAt: UPDATED_AT });

    const matches = await registry.findByAlias("micode");

    expect(matches).toHaveLength(EXPECTED_TWO);
    expect(matches.map((record) => record.projectId)).toEqual(["project-one", "project-two"]);
  });
});
