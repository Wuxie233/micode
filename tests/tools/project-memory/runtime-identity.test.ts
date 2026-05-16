import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectRegistry } from "@/project-memory/registry";
import {
  getIdentity,
  getReadIdentity,
  getWriteIdentity,
  resetProjectMemoryRuntimeForTest,
} from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { normalizeProjectOrigin, projectIdForSource } from "@/utils/project-id";

const ORIGIN = "https://github.com/Wuxie233/micode.git";
const OTHER_ORIGIN = "git@github.com:Wuxie233/other.git";
const ALIAS = "micode";
const UPDATED_AT = 1_234;

let root: string;
let originalRegistryFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pm-runtime-identity-"));
  originalRegistryFile = config.projectMemory.registryFile;
  (config.projectMemory as { registryFile: string }).registryFile = join(root, "registry.json");
});

afterEach(async () => {
  await resetProjectMemoryRuntimeForTest();
  (config.projectMemory as { registryFile: string }).registryFile = originalRegistryFile;
  rmSync(root, { recursive: true, force: true });
});

describe("project memory runtime identity", () => {
  it("keeps getIdentity as a read identity alias for old callers", async () => {
    const directory = mkdtempSync(join(root, "plain-"));

    await expect(getIdentity(directory)).resolves.toEqual(await getReadIdentity(directory));
  });

  it("rejects writes when only a path-degraded identity is available", async () => {
    const directory = mkdtempSync(join(root, "plain-write-"));

    await expect(getWriteIdentity(directory)).rejects.toThrow("degraded identity");
  });

  it("resolves an explicit origin from a non-project directory", async () => {
    const directory = mkdtempSync(join(root, "plain-origin-"));
    const source = normalizeProjectOrigin(ORIGIN);

    await expect(getWriteIdentity(directory, { project_origin: ORIGIN })).resolves.toEqual({
      projectId: projectIdForSource(source),
      kind: "origin",
      source,
    });
  });

  it("rejects ambiguous registry targets for writes", async () => {
    const directory = mkdtempSync(join(root, "plain-registry-"));
    const registry = createProjectRegistry({ filePath: config.projectMemory.registryFile });

    await registry.upsert({
      projectId: "project-one",
      origin: ORIGIN,
      aliases: [ALIAS],
      worktrees: [],
      updatedAt: UPDATED_AT,
    });
    await registry.upsert({
      projectId: "project-two",
      origin: OTHER_ORIGIN,
      aliases: [ALIAS],
      worktrees: [],
      updatedAt: UPDATED_AT,
    });

    await expect(getWriteIdentity(directory, { project_alias: ALIAS })).rejects.toThrow("ambiguous project target");
  });

  it("rejects conflicting explicit and lifecycle origins", async () => {
    const directory = mkdtempSync(join(root, "plain-conflict-"));

    await expect(
      getWriteIdentity(directory, {
        project_origin: ORIGIN,
        lifecycle_project_origin: OTHER_ORIGIN,
      }),
    ).rejects.toThrow("ambiguous project target");
  });

  it("rejects unknown explicit aliases instead of falling back to current directory", async () => {
    const directory = mkdtempSync(join(root, "plain-unknown-alias-"));

    await expect(getWriteIdentity(directory, { project_alias: "missing-alias" })).rejects.toThrow(
      "unknown project target",
    );
  });

  it("rejects unknown explicit worktrees instead of falling back to current directory", async () => {
    const directory = mkdtempSync(join(root, "plain-unknown-worktree-"));

    await expect(getWriteIdentity(directory, { project_worktree: join(root, "missing-worktree") })).rejects.toThrow(
      "unknown project target",
    );
  });
});
