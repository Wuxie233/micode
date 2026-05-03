import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory";
import type { Candidate } from "@/skill-evolution/candidate-schema";
import { promoteApprovedCandidate } from "@/skill-evolution/promote-bridge";
import { createCandidateStore } from "@/skill-evolution/store";

const PROJECT_ID = "p1";
const CANDIDATE_ID = "cand_a";
const POINTER = "skill-candidate://cand_a";

describe("promoteApprovedCandidate", () => {
  let tempRoot: string;
  let dbDir: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "skill-bridge-"));
    dbDir = mkdtempSync(join(tmpdir(), "skill-bridge-db-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  const createStore = () => createCandidateStore(tempRoot);

  const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
    id: CANDIDATE_ID,
    projectId: PROJECT_ID,
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

  it("promotes an approved candidate as a tentative procedure entry and deletes the candidate", async () => {
    const candidateStore = createStore();
    await candidateStore.upsertCandidate(candidate());
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: PROJECT_ID, kind: "origin", source: "github.com/example/repo" },
      candidateId: CANDIDATE_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidateId).toBe(CANDIDATE_ID);
    expect(result.entryIds.length).toBe(1);
    const entry = await memoryStore.loadEntry(PROJECT_ID, result.entryIds[0]);
    expect(entry?.type).toBe("procedure");
    expect(entry?.status).toBe("tentative");
    const sources = await memoryStore.loadSourcesForEntry(PROJECT_ID, result.entryIds[0]);
    expect(sources.map((source) => source.pointer)).toEqual([POINTER]);
    expect(await candidateStore.loadCandidate(PROJECT_ID, CANDIDATE_ID)).toBeNull();
    await memoryStore.close();
  });

  it("returns ok=false with reason when candidate is missing", async () => {
    const candidateStore = createStore();
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: PROJECT_ID, kind: "origin", source: "x" },
      candidateId: "missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not found");
    await memoryStore.close();
  });

  it("does not delete the candidate when promotion is refused due to degraded identity", async () => {
    const candidateStore = createStore();
    await candidateStore.upsertCandidate(candidate());
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: PROJECT_ID, kind: "path", source: "/tmp/x" },
      candidateId: CANDIDATE_ID,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("degraded_identity");
    expect(await candidateStore.loadCandidate(PROJECT_ID, CANDIDATE_ID)).not.toBeNull();
    await memoryStore.close();
  });
});
