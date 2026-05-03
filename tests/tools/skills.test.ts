import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore, type ProjectMemoryStore } from "@/project-memory";
import type { Candidate } from "@/skill-evolution/candidate-schema";
import { createCandidateStore } from "@/skill-evolution/store";
import { resetProjectMemoryRuntimeForTest, setProjectMemoryStoreForTest } from "@/tools/project-memory/runtime";
import { createSkillsTools } from "@/tools/skills";

const ctx = { directory: process.cwd() } as never;

const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "cand_a",
  projectId: "p1",
  trigger: "trigger one",
  steps: ["s1", "s2"],
  sources: [{ kind: "ledger", pointer: "x" }],
  sensitivity: "internal",
  status: "pending",
  createdAt: 100,
  expiresAt: 1_900_000_000_000,
  hits: 0,
  ...overrides,
});

describe("skills tools", () => {
  let homeRoot: string;
  let dbDir: string;
  let originalHome: string | undefined;
  let memoryStore: ProjectMemoryStore;

  beforeEach(async () => {
    homeRoot = mkdtempSync(join(tmpdir(), "skills-tool-home-"));
    dbDir = mkdtempSync(join(tmpdir(), "skills-tool-db-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;

    memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();
    setProjectMemoryStoreForTest(memoryStore);
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await resetProjectMemoryRuntimeForTest();
    rmSync(homeRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("skills_list returns markdown listing pending candidates and purges expired", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate({ id: "c_pending" }));
    await candidateStore.upsertCandidate(baseCandidate({ id: "c_expired", expiresAt: 1 }));

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const result = (await tools.skills_list.execute({}, {} as never)) as string;
    expect(result).toContain("c_pending");
    expect(result).not.toContain("c_expired");
  });

  it("skills_approve promotes the candidate and removes it from pending", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate());

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const out = (await tools.skills_approve.execute({ id: "cand_a" }, {} as never)) as string;
    expect(out).toContain("approved");
    expect(await candidateStore.loadCandidate("p1", "cand_a")).toBeNull();
    const hits = await memoryStore.searchEntries("p1", "trigger one", { type: "procedure", status: "tentative" });
    expect(hits).toHaveLength(1);
  });

  it("skills_reject deletes the candidate", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate());

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const out = (await tools.skills_reject.execute({ id: "cand_a", reason: "low value" }, {} as never)) as string;
    expect(out).toContain("rejected");
    expect(await candidateStore.loadCandidate("p1", "cand_a")).toBeNull();
  });

  it("skills_approve returns an error message when candidate is missing", async () => {
    const candidateStore = createCandidateStore();

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "x" },
      now: () => 100,
    });

    const out = (await tools.skills_approve.execute({ id: "missing" }, {} as never)) as string;
    expect(out).toContain("not found");
  });
});
