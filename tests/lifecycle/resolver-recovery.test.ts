import { describe, expect, it } from "bun:test";

import { createResolver, StaleRecordError } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { LifecycleStore } from "@/lifecycle/store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const ok = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const fail = (e = ""): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

const mkRecord = (n: number, branch = `issue/${n}-x`, state = LIFECYCLE_STATES.IN_PROGRESS): LifecycleRecord => ({
  issueNumber: n,
  issueUrl: `https://github.com/o/r/issues/${n}`,
  branch,
  worktree: `/wt/${n}`,
  state,
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

const fakeStore = (records: readonly LifecycleRecord[], open: readonly number[]): LifecycleStore => {
  const map = new Map(records.map((r) => [r.issueNumber, r]));
  return {
    async save(r) {
      map.set(r.issueNumber, r);
    },
    async load(n) {
      return map.get(n) ?? null;
    },
    async delete(n) {
      map.delete(n);
    },
    async list() {
      return [...map.keys()].sort((a, b) => a - b);
    },
    async listOpen() {
      return [...open];
    },
  };
};

describe("resolver.current with stale classification", () => {
  it("filters out stale records (branch merged, worktree missing) and resolves the single remaining", async () => {
    // 3 records open: #7 stale (branch merged), #9 stale (worktree missing), #67 fresh
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/67-x");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        if (k.startsWith("show-ref --verify --quiet refs/heads/issue/7-")) return ok();
        if (k.startsWith("merge-base --is-ancestor")) return ok(); // branch merged
        if (k.startsWith("show-ref --verify --quiet refs/heads/issue/9-")) return fail();
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(7), mkRecord(9), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [7, 9, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.record.issueNumber).toBe(67);
  });

  it("filters stale records when only the remote tracking branch exists and is merged", async () => {
    const mergeBaseRefs: string[] = [];
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        if (k === "worktree list --porcelain") return ok("worktree /wt/67\n");
        if (k === "show-ref --verify --quiet refs/heads/issue/7-x") return fail();
        if (k === "show-ref --verify --quiet refs/remotes/origin/issue/7-x") return ok();
        if (k === "show-ref --verify --quiet refs/heads/issue/67-x") return ok();
        if (k.startsWith("merge-base --is-ancestor")) {
          mergeBaseRefs.push(args[2] ?? "");
          return args[2] === "refs/remotes/origin/issue/7-x" ? ok() : fail();
        }
        return fail();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(7), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [7, 67]), cwd: "/r" });

    const result = await resolver.current();

    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.record.issueNumber).toBe(67);
    expect(mergeBaseRefs).toContain("refs/remotes/origin/issue/7-x");
  });

  it("returns ambiguous with rich candidate metadata when 2+ fresh records remain and branch matches none", async () => {
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        if (k.startsWith("show-ref")) return ok();
        if (k.startsWith("merge-base --is-ancestor")) return fail(); // not merged
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(66), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [66, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].issueNumber).toBe(66);
      expect(result.candidates[0].stale).toBe(false);
    }
  });

  it("when current branch matches one record, resolves to it even if other records exist", async () => {
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/67-x");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        return ok();
      },
      gh: async () => ok(),
    };
    const records = [mkRecord(7), mkRecord(67)];
    const resolver = createResolver({ runner, store: fakeStore(records, [7, 67]), cwd: "/r" });
    const result = await resolver.current();
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") expect(result.record.issueNumber).toBe(67);
  });
});

describe("resolver explicit recovery methods", () => {
  it("resolveExplicit throws StaleRecordError when local record is stale", async () => {
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
        if (k.startsWith("show-ref")) return fail("missing");
        return ok();
      },
      gh: async () => ok(),
    };
    const resolver = createResolver({ runner, store: fakeStore([mkRecord(7)], [7]), cwd: "/r" });

    await expect(resolver.resolveExplicit(7)).rejects.toThrow(StaleRecordError);
  });

  it("forceRefresh reconstructs from issue body and overwrites local cache", async () => {
    const body = [
      "<!-- micode:lifecycle:state:begin -->",
      `state: ${LIFECYCLE_STATES.IN_PROGRESS}`,
      "<!-- micode:lifecycle:state:end -->",
    ].join("\n");
    const runner: LifecycleRunner = {
      git: async (args) => {
        const k = args.join(" ");
        if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/67-refreshed");
        if (k === "rev-parse --show-toplevel") return ok("/r");
        return ok();
      },
      gh: async () => ok(JSON.stringify({ body })),
    };
    const store = fakeStore([mkRecord(67, "issue/67-stale", LIFECYCLE_STATES.BRANCH_READY)], [67]);
    const resolver = createResolver({ runner, store, cwd: "/r" });

    const refreshed = await resolver.forceRefresh(67);

    expect(refreshed.branch).toBe("issue/67-refreshed");
    expect((await store.load(67))?.branch).toBe("issue/67-refreshed");
  });
});
