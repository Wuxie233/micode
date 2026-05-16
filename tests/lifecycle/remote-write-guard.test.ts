import { describe, expect, it } from "bun:test";
import { type PreFlightResult, REPO_KIND } from "@/lifecycle/pre-flight";
import {
  evaluateRemoteWriteGuard,
  REMOTE_WRITE_BLOCKED_NOTE,
  type RemoteWriteOperation,
} from "@/lifecycle/remote-write-guard";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/workspace/micode";
const ISSUE_NUMBER = 90;
const BRANCH = "issue/90-remote-write-guard";
const WORKTREE = "/workspace/micode-issue-90";
const OPERATION: RemoteWriteOperation = "lifecycle_finish";
const OK_EXIT_CODE = 0;
const EMPTY_OUTPUT = "";
const GH_FIELDS = "nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

const createRun = (stdout: string): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode: OK_EXIT_CODE,
});

const createRepoView = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    nameWithOwner: "Wuxie233/micode",
    isFork: false,
    parent: null,
    owner: { login: "Wuxie233" },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
    ...overrides,
  });

const createRunner = (origin: string, repoView: string): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return createRun(`${origin}\n`);
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return createRun(repoView);
    },
  };
};

const evaluate = (runner: LifecycleRunner) =>
  evaluateRemoteWriteGuard({
    runner,
    cwd: CWD,
    operation: OPERATION,
    issueNumber: ISSUE_NUMBER,
    branch: BRANCH,
    worktree: WORKTREE,
  });

describe("evaluateRemoteWriteGuard", () => {
  it("allows fork origins", async () => {
    const runner = createRunner(
      "git@github.com:Wuxie233/micode.git",
      createRepoView({ isFork: true, parent: { name: "micode", owner: { login: "vtemian" } } }),
    );

    const outcome = await evaluate(runner);

    expect(outcome).toEqual({
      allowed: true,
      preflight: {
        kind: REPO_KIND.FORK,
        origin: "git@github.com:Wuxie233/micode.git",
        nameWithOwner: "Wuxie233/micode",
        viewerLogin: "Wuxie233",
        issuesEnabled: true,
        upstreamUrl: "https://github.com/vtemian/micode",
      },
    });
    expect(runner.calls).toEqual([
      { bin: "git", args: ["remote", "get-url", "origin"], cwd: CWD },
      { bin: "gh", args: ["repo", "view", "Wuxie233/micode", "--json", GH_FIELDS], cwd: CWD },
    ]);
  });

  it("allows owned original repositories", async () => {
    const runner = createRunner("git@github.com:Wuxie233/micode.git", createRepoView({ isFork: false }));

    const outcome = await evaluate(runner);

    expect(outcome.allowed).toBe(true);
    expect(outcome.preflight.kind).toBe(REPO_KIND.OWN);
    expect(outcome.recoveryHint).toBeUndefined();
  });

  it("blocks unknown origins and does not call gh", async () => {
    const runner = createRunner("not-a-github-url", createRepoView({}));

    const outcome = await evaluate(runner);

    expect(outcome.allowed).toBe(false);
    expect(outcome.note).toBe(REMOTE_WRITE_BLOCKED_NOTE);
    expect(outcome.preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(outcome.recoveryHint).toMatchObject({
      failureKind: "unknown",
      recommendedNextAction: "ask_user",
      safeToRetry: false,
      issueNumber: ISSUE_NUMBER,
      branch: BRANCH,
      worktree: WORKTREE,
    });
    expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
  });

  it("blocks upstream/read-only origins", async () => {
    const runner = createRunner(
      "git@github.com:vtemian/micode.git",
      createRepoView({
        nameWithOwner: "vtemian/micode",
        owner: { login: "vtemian" },
        viewerPermission: "READ",
        hasIssuesEnabled: false,
      }),
    );

    const outcome = await evaluate(runner);

    expect(outcome.allowed).toBe(false);
    expect(outcome.note).toBe(REMOTE_WRITE_BLOCKED_NOTE);
    expect(outcome.preflight.kind).toBe(REPO_KIND.UPSTREAM);
    expect(outcome.recoveryHint?.summary).toBe(
      "blocked lifecycle_finish remote write for upstream/read-only repository vtemian/micode",
    );
  });

  it("accepts an already computed preflight result without invoking runner commands", async () => {
    const preflight: PreFlightResult = {
      kind: REPO_KIND.FORK,
      origin: "git@github.com:Wuxie233/micode.git",
      nameWithOwner: "Wuxie233/micode",
      viewerLogin: "Wuxie233",
      issuesEnabled: true,
      upstreamUrl: "https://github.com/vtemian/micode",
    };
    const runner = createRunner("not-a-github-url", createRepoView({}));

    const outcome = await evaluateRemoteWriteGuard({ runner, cwd: CWD, operation: OPERATION, preflight });

    expect(outcome).toEqual({ allowed: true, preflight });
    expect(runner.calls).toHaveLength(0);
  });
});
