import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Candidate } from "@/skill-evolution/candidate-schema";
import { approveCandidate, listPending, purgeExpiredCandidates, rejectCandidate } from "@/skill-evolution/review";
import { createCandidateStore } from "@/skill-evolution/store";

describe("review state machine", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "skill-review-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  const createStore = () => createCandidateStore(tempRoot);

  const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
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

  it("listPending returns pending candidates ordered by createdAt asc", async () => {
    const store = createStore();
    await store.upsertCandidate(candidate({ id: "c1", createdAt: 200 }));
    await store.upsertCandidate(candidate({ id: "c2", createdAt: 100 }));
    const pending = await listPending(store, "p1");
    expect(pending.map((stored) => stored.id)).toEqual(["c2", "c1"]);
  });

  it("listPending excludes non-pending candidates", async () => {
    const store = createStore();
    await store.upsertCandidate(candidate({ id: "c1", status: "pending" }));
    await store.upsertCandidate(candidate({ id: "c2", status: "rejected" }));
    const pending = await listPending(store, "p1");
    expect(pending.map((stored) => stored.id)).toEqual(["c1"]);
  });

  it("approveCandidate returns a markdown body and promotion pointer without deleting the candidate", async () => {
    const store = createStore();
    await store.upsertCandidate(candidate());
    const result = await approveCandidate({ store, projectId: "p1", candidateId: "cand_a" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("## Procedure");
    expect(result.markdown).toContain(candidate().trigger);
    expect(result.entityName).toBe("skill-cand_a");
    expect(result.pointer).toBe("skill-candidate://cand_a");
    expect(result.candidate).toEqual(candidate());
    expect(await store.loadCandidate("p1", "cand_a")).not.toBeNull();
  });

  it("approveCandidate returns ok=false when candidate is missing", async () => {
    const store = createStore();
    const result = await approveCandidate({ store, projectId: "p1", candidateId: "missing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not found");
  });

  it("rejectCandidate deletes the candidate file and returns ok=true", async () => {
    const store = createStore();
    await store.upsertCandidate(candidate());
    const result = await rejectCandidate({ store, projectId: "p1", candidateId: "cand_a", reason: "low value" });
    expect(result.ok).toBe(true);
    expect(await store.loadCandidate("p1", "cand_a")).toBeNull();
  });

  it("rejectCandidate returns ok=false when candidate is missing", async () => {
    const store = createStore();
    const result = await rejectCandidate({ store, projectId: "p1", candidateId: "missing", reason: "x" });
    expect(result.ok).toBe(false);
  });

  it("purgeExpiredCandidates returns the count of expired entries removed", async () => {
    const store = createStore();
    await store.upsertCandidate(candidate({ id: "old", expiresAt: 100 }));
    await store.upsertCandidate(candidate({ id: "new", expiresAt: 1_900_000_000_000 }));
    const count = await purgeExpiredCandidates({ store, projectId: "p1", now: 1_000 });
    expect(count).toBe(1);
  });
});
