import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  assertMaintenanceProjectIdentity,
  assertWritableProjectIdentity,
  resolveProjectMemoryIdentity,
} from "@/project-memory/identity";
import type { ProjectRegistry, ProjectRegistryRecord } from "@/project-memory/registry";
import { normalizeRegistryRecord } from "@/project-memory/registry";
import { normalizeProjectOrigin, projectIdForSource } from "@/utils/project-id";

const UPDATED_AT = 1_234;
const EXPECTED_TWO = 2;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pm-identity-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function testRecord(record: Omit<ProjectRegistryRecord, "updatedAt">): ProjectRegistryRecord {
  return normalizeRegistryRecord({ ...record, updatedAt: UPDATED_AT });
}

function registry(records: readonly ProjectRegistryRecord[]): ProjectRegistry {
  const normalized = records.map((record) => normalizeRegistryRecord(record));
  return {
    load: async () => normalized,
    upsert: async () => undefined,
    findByAlias: async (alias) => {
      const normalizedAlias = alias.trim().toLowerCase();
      return normalized.filter((record) => record.aliases.includes(normalizedAlias));
    },
    findByOrigin: async (origin) => {
      const normalizedOrigin = normalizeProjectOrigin(origin);
      return normalized.filter((record) => record.origin === normalizedOrigin);
    },
    findByWorktree: async (worktree) => {
      const normalizedWorktree = resolve(worktree);
      return normalized.filter((record) => record.worktrees.includes(normalizedWorktree));
    },
  };
}

describe("resolveProjectMemoryIdentity", () => {
  it("prioritizes an explicit exact projectId over session and lifecycle targets", async () => {
    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      explicitTarget: { projectId: "project-explicit" },
      sessionTarget: { projectId: "project-session" },
      lifecycleTarget: { projectId: "project-lifecycle" },
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.source).toBe("explicit");
    expect(resolution.identity?.projectId).toBe("project-explicit");
  });

  it("normalizes origins and hashes the exact normalized origin without fuzzy matching", async () => {
    const normalized = "github.com/wuxie233/micode";

    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      explicitTarget: { origin: "git@github.com:Wuxie233/micode.git" },
      registry: registry([
        testRecord({
          projectId: "project-other",
          origin: "github.com/wuxie233/micode-extra",
          aliases: [],
          worktrees: [],
        }),
      ]),
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.identity).toEqual({
      projectId: projectIdForSource(normalized),
      kind: "origin",
      source: normalized,
    });
  });

  it("blocks an explicit alias that has zero exact registry matches", async () => {
    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      explicitTarget: { alias: "mico" },
      sessionTarget: { projectId: "project-session" },
      registry: registry([testRecord({ projectId: "project-one", aliases: ["micode"], worktrees: [] })]),
    });

    expect(resolution.status).toBe("blocked");
    expect(resolution.identity).toBeUndefined();
    expect(() => assertWritableProjectIdentity(resolution)).toThrow(/blocked/i);
  });

  it("falls through when a non-explicit alias has zero registry matches", async () => {
    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      sessionTarget: { alias: "missing" },
      lifecycleTarget: { projectId: "project-lifecycle" },
      registry: registry([]),
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.source).toBe("lifecycle");
    expect(resolution.identity?.projectId).toBe("project-lifecycle");
  });

  it("returns ambiguous candidates and blocks writes when registry lookup has multiple matches", async () => {
    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      explicitTarget: { alias: "micode" },
      registry: registry([
        testRecord({ projectId: "project-one", aliases: ["micode"], worktrees: [] }),
        testRecord({ projectId: "project-two", aliases: ["micode"], worktrees: [] }),
      ]),
    });

    expect(resolution.status).toBe("ambiguous");
    expect(resolution.candidates?.map((candidate) => candidate.projectId)).toEqual(["project-one", "project-two"]);
    expect(resolution.candidates).toHaveLength(EXPECTED_TWO);
    expect(() => assertWritableProjectIdentity(resolution)).toThrow(/ambiguous/i);
  });

  it("uses registry worktree matches before path-only directory fallback", async () => {
    const resolution = await resolveProjectMemoryIdentity({
      directory: dir,
      registry: registry([testRecord({ projectId: "project-worktree", aliases: [], worktrees: [dir] })]),
    });

    expect(resolution.status).toBe("resolved");
    expect(resolution.source).toBe("registry");
    expect(resolution.identity?.projectId).toBe("project-worktree");
  });

  it("marks path-only directory fallback as degraded and blocks writes and maintenance by default", async () => {
    const resolution = await resolveProjectMemoryIdentity({ directory: dir, registry: registry([]) });

    expect(resolution.status).toBe("degraded");
    expect(resolution.identity?.kind).toBe("path");
    expect(() => assertWritableProjectIdentity(resolution)).toThrow(/degraded|origin/i);
    expect(() => assertMaintenanceProjectIdentity(resolution)).toThrow(/degraded|origin/i);
  });
});
