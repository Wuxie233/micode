import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Candidate } from "@/skill-evolution/candidate-schema";
import { candidateRootDir } from "@/skill-evolution/paths";
import { createCandidateStore } from "@/skill-evolution/store";
import { config } from "@/utils/config";

describe("candidate store", () => {
  let tempRoot: string;
  let projectId: string;
  let warning: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "skill-store-"));
    projectId = `proj_${tempRoot.split("-").at(-1)}`;
    warning = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warning.mockRestore();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const createStore = () => createCandidateStore(tempRoot);

  const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
    id: "cand_a",
    projectId,
    trigger: "trigger one",
    steps: ["one", "two"],
    sources: [{ kind: "ledger", pointer: "thoughts/ledgers/CONTINUITY_2026-05-01.md" }],
    sensitivity: "internal",
    status: "pending",
    createdAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    hits: 0,
    ...overrides,
  });

  it("upsertCandidate writes a JSON file under the project candidate root", async () => {
    const store = createStore();
    const candidate = baseCandidate();
    await store.upsertCandidate(candidate);
    const candidates = await store.listCandidates(candidate.projectId);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("cand_a");
  });

  it("listCandidates returns empty array when project root is missing", async () => {
    const store = createStore();
    const candidates = await store.listCandidates("nonexistent_project");
    expect(candidates).toEqual([]);
  });

  it("loadCandidate returns null for missing candidate", async () => {
    const store = createStore();
    const loaded = await store.loadCandidate("p", "missing");
    expect(loaded).toBeNull();
  });

  it("loadCandidate returns the stored candidate on hit", async () => {
    const store = createStore();
    const candidate = baseCandidate();
    await store.upsertCandidate(candidate);
    const loaded = await store.loadCandidate(candidate.projectId, candidate.id);
    expect(loaded?.trigger).toBe("trigger one");
  });

  it("upsertCandidate overwrites the existing record by id", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate({ trigger: "first" }));
    await store.upsertCandidate(baseCandidate({ trigger: "second" }));
    const loaded = await store.loadCandidate(projectId, "cand_a");
    expect(loaded?.trigger).toBe("second");
  });

  it("deleteCandidate removes the file", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    await store.deleteCandidate(projectId, "cand_a");
    expect(await store.loadCandidate(projectId, "cand_a")).toBeNull();
  });

  it("listCandidates skips corrupted JSON files", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    const root = candidateRootDir(projectId, tempRoot);
    writeFileSync(join(root, "cand_corrupt.json"), "{not json");
    const candidates = await store.listCandidates(projectId);
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe("cand_a");
    expect(warning).toHaveBeenCalled();
  });

  it("listCandidates skips files that fail schema validation", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    const root = candidateRootDir(projectId, tempRoot);
    writeFileSync(join(root, "cand_invalid.json"), JSON.stringify({ id: "x" }));
    const candidates = await store.listCandidates(projectId);
    expect(candidates.length).toBe(1);
    expect(warning).toHaveBeenCalled();
  });

  it("purgeExpired deletes candidates with expiresAt <= now and returns count", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate({ id: "cand_old", expiresAt: 100, trigger: "old trigger" }));
    await store.upsertCandidate(
      baseCandidate({ id: "cand_new", expiresAt: 1_900_000_000_000, trigger: "new trigger" }),
    );
    const purged = await store.purgeExpired(projectId, 1_000);
    expect(purged).toBe(1);
    const remaining = await store.listCandidates(projectId);
    expect(remaining.map((candidate) => candidate.id)).toEqual(["cand_new"]);
  });

  it("findByDedupeKey locates an existing candidate by trigger+steps key", async () => {
    const store = createStore();
    const candidate = baseCandidate();
    await store.upsertCandidate(candidate);
    const hit = await store.findByDedupeKey(projectId, { trigger: candidate.trigger, steps: candidate.steps });
    expect(hit?.id).toBe("cand_a");
  });

  it("findByDedupeKey returns null when nothing matches", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    const hit = await store.findByDedupeKey(projectId, { trigger: "different", steps: ["x"] });
    expect(hit).toBeNull();
  });

  it("upsertCandidate atomically writes via tmp+rename and leaves no tmp file", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    const root = candidateRootDir(projectId, tempRoot);
    const file = join(root, "cand_a.json");
    const text = readFileSync(file, "utf-8");
    expect(JSON.parse(text).id).toBe("cand_a");
    expect(() => readFileSync(`${file}.tmp`, "utf-8")).toThrow();
  });

  it("upsertCandidate evicts the oldest candidate when the project cap is exceeded", async () => {
    const store = createStore();
    for (let index = 0; index <= config.skillEvolution.maxCandidatesPerProject; index += 1) {
      await store.upsertCandidate(
        baseCandidate({
          id: `cand_${index}`,
          createdAt: index,
          trigger: `trigger ${index}`,
        }),
      );
    }
    const candidates = await store.listCandidates(projectId);
    expect(candidates.length).toBe(config.skillEvolution.maxCandidatesPerProject);
    expect(candidates.some((candidate) => candidate.id === "cand_0")).toBe(false);
  });

  it("listCandidates ignores non-json files in the project root", async () => {
    const store = createStore();
    await store.upsertCandidate(baseCandidate());
    const root = candidateRootDir(projectId, tempRoot);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "notes.txt"), "ignored");
    const candidates = await store.listCandidates(projectId);
    expect(candidates.length).toBe(1);
  });

  it("upsertCandidate rejects invalid candidates before writing", async () => {
    const store = createStore();
    await expect(store.upsertCandidate(baseCandidate({ trigger: " " }))).rejects.toThrow("candidate rejected");
    const candidates = await store.listCandidates(projectId);
    expect(candidates).toEqual([]);
  });
});
