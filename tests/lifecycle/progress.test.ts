import { describe, expect, it } from "bun:test";

import { createProgressLogger, PROGRESS_KINDS } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const CWD = "/workspace/repo";
const ISSUE_42 = 42;
const FIXED_ISO = "2026-04-28T20:00:00.000Z";
const fixedNow = (): Date => new Date(FIXED_ISO);

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

const baseRecord = (issueNumber: number): LifecycleRecord => ({
  issueNumber,
  issueUrl: "",
  branch: `issue/${issueNumber}-x`,
  worktree: "/tmp/wt",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: 0,
});

const resolverResolved = (issueNumber: number): Resolver => ({
  current: async () => ({ kind: "resolved", record: baseRecord(issueNumber) }),
  resume: async () => baseRecord(issueNumber),
});

const resolverNone = (): Resolver => ({
  current: async () => ({ kind: "none" }),
  resume: async () => {
    throw new Error("not_found");
  },
});

interface RecordedCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRecordingRunner = (
  ghImpl: (args: readonly string[]) => RunResult,
  recorded: RecordedCall[],
): LifecycleRunner => ({
  async git() {
    return ok();
  },
  async gh(args, options) {
    recorded.push({ args, cwd: options?.cwd });
    return ghImpl(args);
  },
});

describe("createProgressLogger.log", () => {
  it("posts a comment with hidden marker, kind, and timestamp", async () => {
    const calls: RecordedCall[] = [];
    const runner = createRecordingRunner(() => ok("https://github.com/x/y/issues/42#issuecomment-1"), calls);
    const progress = createProgressLogger({
      runner,
      resolver: resolverResolved(ISSUE_42),
      cwd: CWD,
      now: fixedNow,
    });

    const outcome = await progress.log({
      kind: PROGRESS_KINDS.STATUS,
      summary: "did the thing",
    });

    expect(outcome.issueNumber).toBe(ISSUE_42);
    expect(outcome.kind).toBe(PROGRESS_KINDS.STATUS);
    expect(outcome.commentUrl).toBe("https://github.com/x/y/issues/42#issuecomment-1");
    expect(calls).toHaveLength(1);
    const body = calls[0]?.args[4] ?? "";
    expect(body).toContain("micode:lifecycle:progress");
    expect(body).toContain("kind=status");
    expect(body).toContain(FIXED_ISO);
  });

  it("uses explicit issue_number when provided, even with a none resolver", async () => {
    const calls: RecordedCall[] = [];
    const runner = createRecordingRunner(() => ok("https://x/y/123"), calls);
    const progress = createProgressLogger({
      runner,
      resolver: resolverNone(),
      cwd: CWD,
      now: fixedNow,
    });

    const outcome = await progress.log({
      kind: PROGRESS_KINDS.HANDOFF,
      summary: "moving on",
      issueNumber: 123,
    });

    expect(outcome.issueNumber).toBe(123);
  });

  it("throws when no active lifecycle and no explicit issue_number", async () => {
    const runner = createRecordingRunner(() => ok(), []);
    const progress = createProgressLogger({ runner, resolver: resolverNone(), cwd: CWD });

    await expect(progress.log({ kind: PROGRESS_KINDS.STATUS, summary: "x" })).rejects.toThrow(/no_active_lifecycle/);
  });
});

describe("createProgressLogger.context", () => {
  it("returns body and recent progress filtered by marker", async () => {
    const view = JSON.stringify({
      body: "issue body",
      comments: [
        { body: "<!-- micode:lifecycle:progress kind=status -->\nfirst", createdAt: "2026-01-01" },
        { body: "ordinary comment", createdAt: "2026-01-02" },
        { body: "<!-- micode:lifecycle:progress kind=blocker -->\nsecond", createdAt: "2026-01-03" },
      ],
    });
    const runner = createRecordingRunner(() => ok(view), []);
    const progress = createProgressLogger({
      runner,
      resolver: resolverResolved(ISSUE_42),
      cwd: CWD,
    });

    const snap = await progress.context();

    expect(snap.issueNumber).toBe(ISSUE_42);
    expect(snap.body).toBe("issue body");
    expect(snap.recentProgress).toHaveLength(2);
    expect(snap.recentProgress[0]?.kind).toBe("status");
    expect(snap.recentProgress[1]?.kind).toBe("blocker");
  });

  it("returns empty recentProgress when no comments match", async () => {
    const view = JSON.stringify({ body: "b", comments: [] });
    const runner = createRecordingRunner(() => ok(view), []);
    const progress = createProgressLogger({
      runner,
      resolver: resolverResolved(ISSUE_42),
      cwd: CWD,
    });

    const snap = await progress.context();
    expect(snap.recentProgress).toEqual([]);
  });
});
