import { describe, expect, it } from "bun:test";

import { auditLifecycleBranches } from "@/lifecycle/branch-cleanup-policy";
import { type PreFlightResult, REPO_KIND } from "@/lifecycle/pre-flight";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_MODES, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const CWD = "/workspace/micode";
const BASE_BRANCH = "main";
const OK = 0;
const FAIL = 1;
const EMPTY = "";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

const run = (stdout = EMPTY, exitCode = OK): RunResult => ({ stdout, stderr: EMPTY, exitCode });

const record = (branch: string, issueNumber = 81): LifecycleRecord => ({
  issueNumber,
  issueUrl: `https://github.com/Wuxie233/micode/issues/${issueNumber}`,
  mode: LIFECYCLE_MODES.REMOTE,
  localId: null,
  repoRoot: CWD,
  remoteCapable: true,
  branch,
  worktree: `/tmp/${branch.replaceAll("/", "-")}`,
  state: LIFECYCLE_STATES.CLEANED,
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

const preflight = (kind: PreFlightResult["kind"]): PreFlightResult => {
  if (kind === REPO_KIND.UNKNOWN) {
    return {
      kind,
      reason: "gh-failed",
      origin: "git@github.com:Wuxie233/micode.git",
      nameWithOwner: EMPTY,
      viewerLogin: null,
      issuesEnabled: false,
      upstreamUrl: null,
    };
  }

  return {
    kind,
    origin: "git@github.com:Wuxie233/micode.git",
    nameWithOwner: kind === REPO_KIND.UPSTREAM ? "vtemian/micode" : "Wuxie233/micode",
    viewerLogin: kind === REPO_KIND.UPSTREAM ? null : "Wuxie233",
    issuesEnabled: kind !== REPO_KIND.UPSTREAM,
    upstreamUrl: kind === REPO_KIND.FORK ? "https://github.com/vtemian/micode" : null,
  };
};

const createRunner = (handler: (args: readonly string[]) => RunResult): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return handler(args);
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return run();
    },
  };
};

const createBranchRunner = (input: {
  readonly local?: string;
  readonly remote?: string;
  readonly mergeExit?: number;
  readonly diffExit?: number;
}): FakeRunner =>
  createRunner((args) => {
    if (args[0] === "branch" && args[1] === "--list") return run(input.local ?? EMPTY);
    if (args[0] === "branch" && args[1] === "-r") return run(input.remote ?? EMPTY);
    if (args[0] === "worktree" && args[1] === "list") return run();
    if (args[0] === "merge-base") return run(EMPTY, input.mergeExit ?? OK);
    if (args[0] === "diff") return run(EMPTY, input.diffExit ?? FAIL);
    return run();
  });

const hasCall = (runner: FakeRunner, args: readonly string[]): boolean =>
  runner.calls.some((call) => call.bin === "git" && JSON.stringify(call.args) === JSON.stringify(args));

describe("auditLifecycleBranches", () => {
  it("prunes safe local lifecycle branches only with git branch -d", async () => {
    const runner = createBranchRunner({ local: "  issue/81-hardening\n" });

    const report = await auditLifecycleBranches(runner, {
      cwd: CWD,
      baseBranch: BASE_BRANCH,
      records: [record("issue/81-hardening")],
      dryRun: false,
    });

    expect(report).toHaveLength(1);
    expect(report[0]?.decision.kind).toBe("prune-local");
    expect(report[0]?.pruned).toBe(true);
    expect(hasCall(runner, ["branch", "-d", "issue/81-hardening"])).toBe(true);
    expect(runner.calls.some((call) => call.args.includes("-D"))).toBe(false);
  });

  it("defaults to dry-run and reports safe local branches without deleting", async () => {
    const runner = createBranchRunner({ local: "  issue/81-hardening\n" });

    const report = await auditLifecycleBranches(runner, {
      cwd: CWD,
      baseBranch: BASE_BRANCH,
      records: [record("issue/81-hardening")],
    });

    expect(report[0]?.decision.kind).toBe("prune-local");
    expect(report[0]?.pruned).toBe(false);
    expect(report[0]?.mutationSkippedReason).toBe("dry-run");
    expect(hasCall(runner, ["branch", "-d", "issue/81-hardening"])).toBe(false);
  });

  it("reports ambiguous issue-like branches without pruning", async () => {
    const runner = createBranchRunner({ local: "  issue/99-user-work\n" });

    const report = await auditLifecycleBranches(runner, {
      cwd: CWD,
      baseBranch: BASE_BRANCH,
      records: [],
      dryRun: false,
    });

    expect(report[0]?.decision.kind).toBe("blocked-ambiguous");
    expect(report[0]?.pruned).toBe(false);
    expect(hasCall(runner, ["branch", "-d", "issue/99-user-work"])).toBe(false);
  });

  it("keeps rescue/all-local branches blocked unless recovery evidence is present", async () => {
    const runner = createBranchRunner({ local: "  rescue/all-local/2026-05-16\n", diffExit: OK });

    const report = await auditLifecycleBranches(runner, {
      cwd: CWD,
      baseBranch: BASE_BRANCH,
      records: [],
      dryRun: false,
    });

    expect(report[0]?.decision.kind).toBe("blocked-ambiguous");
    expect(report[0]?.decision.reason).toContain("recovery marker");
    expect(hasCall(runner, ["branch", "-d", "rescue/all-local/2026-05-16"])).toBe(false);
  });

  it("deletes safe origin remote branches after ownership gate passes", async () => {
    const runner = createBranchRunner({ remote: "  origin/issue/81-hardening\n" });

    const report = await auditLifecycleBranches(runner, {
      cwd: CWD,
      baseBranch: BASE_BRANCH,
      records: [record("issue/81-hardening")],
      preflight: preflight(REPO_KIND.FORK),
      dryRun: false,
    });

    expect(report[0]?.decision.kind).toBe("prune-remote");
    expect(report[0]?.pruned).toBe(true);
    expect(hasCall(runner, ["push", "origin", "--delete", "issue/81-hardening"])).toBe(true);
    expect(runner.calls.some((call) => call.args.includes("upstream"))).toBe(false);
  });

  it("reports remote candidates as blocked and never deletes when preflight is upstream or unknown", async () => {
    for (const kind of [REPO_KIND.UPSTREAM, REPO_KIND.UNKNOWN] as const) {
      const runner = createBranchRunner({ remote: "  origin/issue/81-hardening\n" });

      const report = await auditLifecycleBranches(runner, {
        cwd: CWD,
        baseBranch: BASE_BRANCH,
        records: [record("issue/81-hardening")],
        preflight: preflight(kind),
        dryRun: false,
      });

      expect(report[0]?.decision.kind).toBe("blocked-upstream");
      expect(report[0]?.pruned).toBe(false);
      expect(hasCall(runner, ["push", "origin", "--delete", "issue/81-hardening"])).toBe(false);
      expect(runner.calls.some((call) => call.args.includes("upstream"))).toBe(false);
    }
  });
});
