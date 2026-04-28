import { describe, expect, it } from "bun:test";

import { createResolver, type ResolverDeps } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { LifecycleStore } from "@/lifecycle/store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const CWD = "/workspace/repo";
const OK_EXIT = 0;
const FAIL_EXIT = 1;

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: OK_EXIT });
const fail = (stderr = ""): RunResult => ({ stdout: "", stderr, exitCode: FAIL_EXIT });

const baseRecord = (issueNumber: number, overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber,
  issueUrl: `https://github.com/owner/repo/issues/${issueNumber}`,
  branch: `issue/${issueNumber}-test`,
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
  ...overrides,
});

interface FakeStoreState {
  records: Map<number, LifecycleRecord>;
  open: number[];
}

const createFakeStore = (state: FakeStoreState): LifecycleStore => ({
  async save(record) {
    state.records.set(record.issueNumber, record);
  },
  async load(issueNumber) {
    return state.records.get(issueNumber) ?? null;
  },
  async delete(issueNumber) {
    state.records.delete(issueNumber);
  },
  async list() {
    return [...state.records.keys()].sort((l, r) => l - r);
  },
  async listOpen() {
    return state.open;
  },
});

interface FakeRunnerState {
  branch: string;
  worktree: string;
  ghBody?: string;
  ghFails?: boolean;
}

const createFakeRunner = (state: FakeRunnerState): LifecycleRunner => ({
  async git(args) {
    if (args.includes("--abbrev-ref")) return ok(`${state.branch}\n`);
    if (args.includes("--show-toplevel")) return ok(`${state.worktree}\n`);
    return ok();
  },
  async gh(_args) {
    if (state.ghFails) return fail();
    if (state.ghBody !== undefined) return ok(JSON.stringify({ body: state.ghBody }));
    return ok();
  },
});

const makeDeps = (storeState: FakeStoreState, runnerState: FakeRunnerState): ResolverDeps => ({
  runner: createFakeRunner(runnerState),
  store: createFakeStore(storeState),
  cwd: CWD,
});

const ISSUE_42 = 42;
const ISSUE_5 = 5;
const ISSUE_7 = 7;

describe("createResolver.current", () => {
  it("resolves from branch when store has the record", async () => {
    const storeState: FakeStoreState = { records: new Map([[ISSUE_42, baseRecord(ISSUE_42)]]), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: `issue/${ISSUE_42}-feature`, worktree: CWD }));

    const result = await resolver.current();

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.record.issueNumber).toBe(ISSUE_42);
    }
  });

  it("falls through when branch matches but store misses, and listOpen is empty", async () => {
    const storeState: FakeStoreState = { records: new Map(), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: `issue/${ISSUE_42}-feature`, worktree: CWD }));

    const result = await resolver.current();

    expect(result.kind).toBe("none");
  });

  it("resolves from listOpen when exactly one is open and branch is non-lifecycle", async () => {
    const record = baseRecord(ISSUE_5);
    const storeState: FakeStoreState = { records: new Map([[ISSUE_5, record]]), open: [ISSUE_5] };
    const resolver = createResolver(makeDeps(storeState, { branch: "main", worktree: CWD }));

    const result = await resolver.current();

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.record.issueNumber).toBe(ISSUE_5);
    }
  });

  it("returns none when listOpen is empty and branch does not match", async () => {
    const storeState: FakeStoreState = { records: new Map(), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: "main", worktree: CWD }));

    const result = await resolver.current();

    expect(result.kind).toBe("none");
  });

  it("returns ambiguous when listOpen returns multiple", async () => {
    const storeState: FakeStoreState = {
      records: new Map([
        [ISSUE_5, baseRecord(ISSUE_5)],
        [ISSUE_7, baseRecord(ISSUE_7)],
      ]),
      open: [ISSUE_5, ISSUE_7],
    };
    const resolver = createResolver(makeDeps(storeState, { branch: "main", worktree: CWD }));

    const result = await resolver.current();

    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect([...result.candidates].sort()).toEqual([ISSUE_5, ISSUE_7]);
    }
  });
});

describe("createResolver.resume", () => {
  it("returns local record without calling gh when store has it", async () => {
    const record = baseRecord(ISSUE_42);
    const storeState: FakeStoreState = { records: new Map([[ISSUE_42, record]]), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: "main", worktree: CWD, ghFails: true }));

    const resumed = await resolver.resume(ISSUE_42);

    expect(resumed.issueNumber).toBe(ISSUE_42);
  });

  it("reconstructs from issue body when store misses", async () => {
    const ghBody = [
      "<!-- micode:lifecycle:state:begin -->",
      `state: ${LIFECYCLE_STATES.IN_PROGRESS}`,
      "<!-- micode:lifecycle:state:end -->",
    ].join("\n");
    const storeState: FakeStoreState = { records: new Map(), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: `issue/${ISSUE_42}-x`, worktree: CWD, ghBody }));

    const resumed = await resolver.resume(ISSUE_42);

    expect(resumed.issueNumber).toBe(ISSUE_42);
    expect(resumed.state).toBe(LIFECYCLE_STATES.IN_PROGRESS);
    expect(storeState.records.get(ISSUE_42)).not.toBeUndefined();
  });

  it("throws when gh issue view fails", async () => {
    const storeState: FakeStoreState = { records: new Map(), open: [] };
    const resolver = createResolver(makeDeps(storeState, { branch: "main", worktree: CWD, ghFails: true }));

    await expect(resolver.resume(ISSUE_42)).rejects.toThrow(/issue_not_found/);
  });

  it("throws when issue body has no lifecycle markers", async () => {
    const storeState: FakeStoreState = { records: new Map(), open: [] };
    const resolver = createResolver(
      makeDeps(storeState, { branch: "main", worktree: CWD, ghBody: "Just a regular issue body, no markers." }),
    );

    await expect(resolver.resume(ISSUE_42)).rejects.toThrow(/not_a_lifecycle_issue/);
  });
});
