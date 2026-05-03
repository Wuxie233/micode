import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMiner } from "@/skill-evolution/miner-runner";
import { createCandidateStore } from "@/skill-evolution/store";

describe("runMiner", () => {
  let cwdRoot: string;
  let homeRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    cwdRoot = mkdtempSync(join(tmpdir(), "skill-runner-cwd-"));
    homeRoot = mkdtempSync(join(tmpdir(), "skill-runner-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(cwdRoot, { recursive: true, force: true });
    rmSync(homeRoot, { recursive: true, force: true });
  });

  function seedJournal(issue: number, events: ReadonlyArray<Record<string, unknown>>): void {
    const dir = join(cwdRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${issue}.journal.jsonl`), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  }

  function seedRecord(issue: number, body: string): void {
    const dir = join(cwdRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${issue}.md`), body);
  }

  function createStore(): ReturnType<typeof createCandidateStore> {
    return createCandidateStore(join(homeRoot, "candidates"));
  }

  it("writes a new candidate when sources contain a fresh approved workflow", async () => {
    seedRecord(24, "## Request\nImprove project memory promotion.\n");
    seedJournal(24, [
      {
        kind: "batch_completed",
        issueNumber: 24,
        seq: 1,
        at: 1,
        batchId: "b1",
        taskId: null,
        attempt: 1,
        summary: "wire types",
        commitMarker: null,
        reviewOutcome: null,
      },
      {
        kind: "review_completed",
        issueNumber: 24,
        seq: 2,
        at: 2,
        batchId: "b1",
        taskId: null,
        attempt: 1,
        summary: "approved",
        commitMarker: null,
        reviewOutcome: "approved",
      },
    ]);

    const store = createStore();
    const result = await runMiner({
      cwd: cwdRoot,
      projectId: "p1",
      issueNumber: 24,
      now: 1_700_000_000_000,
      candidateStore: store,
    });

    expect(result.candidatesAdded).toBe(1);
    const candidates = await store.listCandidates("p1");
    expect(candidates.length).toBe(1);
  });

  it("does not duplicate when re-run with the same sources", async () => {
    seedRecord(24, "## Request\nSame topic.\n");
    seedJournal(24, [
      {
        kind: "batch_completed",
        issueNumber: 24,
        seq: 1,
        at: 1,
        batchId: "b1",
        taskId: null,
        attempt: 1,
        summary: "step",
        commitMarker: null,
        reviewOutcome: null,
      },
      {
        kind: "review_completed",
        issueNumber: 24,
        seq: 2,
        at: 2,
        batchId: "b1",
        taskId: null,
        attempt: 1,
        summary: "ok",
        commitMarker: null,
        reviewOutcome: "approved",
      },
    ]);

    const store = createStore();
    const first = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 1, candidateStore: store });
    const second = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 2, candidateStore: store });

    expect(first.candidatesAdded).toBe(1);
    expect(second.candidatesAdded).toBe(0);
    expect((await store.listCandidates("p1")).length).toBe(1);
  });

  it("returns zero candidates when the journal has no approved review event", async () => {
    seedRecord(24, "## Request\nx\n");
    seedJournal(24, [
      {
        kind: "batch_completed",
        issueNumber: 24,
        seq: 1,
        at: 1,
        batchId: "b1",
        taskId: null,
        attempt: 1,
        summary: "step",
        commitMarker: null,
        reviewOutcome: null,
      },
    ]);

    const store = createStore();
    const result = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 1, candidateStore: store });
    expect(result.candidatesAdded).toBe(0);
  });

  it("does not throw when lifecycle files are missing", async () => {
    const store = createStore();
    const result = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 999, now: 1, candidateStore: store });
    expect(result.candidatesAdded).toBe(0);
  });
});
