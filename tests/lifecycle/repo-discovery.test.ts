import { describe, expect, it } from "bun:test";

import { resolveEffectiveProjectRoot } from "@/lifecycle/repo-discovery";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/work/micode";
const NESTED_CWD = "/work/micode/src/lifecycle";
const CHILD_REPO = "/work/micode/child";
const OTHER_CHILD_REPO = "/work/micode/other";
const WORKSPACE_CWD = "/root/CODE";
const OPENCODE_REPO = "/root/CODE/opencode";
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

type GitOutput = RunResult | Error;

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createFailure = (): RunResult => createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE);

const createRunner = (gitOutputs: readonly GitOutput[]): FakeRunner => {
  const calls: RunnerCall[] = [];
  let gitIndex = 0;

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const output = gitOutputs[gitIndex] ?? createFailure();
      gitIndex += 1;
      if (output instanceof Error) throw output;
      return output;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return createFailure();
    },
  };
};

const expectNoGitInit = (runner: FakeRunner): void => {
  for (const call of runner.calls) {
    expect(call.bin).toBe("git");
    expect(call.args).not.toContain("init");
  }
};

describe("resolveEffectiveProjectRoot", () => {
  it("returns the current repo root", async () => {
    const runner = createRunner([createRun(`${CWD}\n`)]);

    const result = await resolveEffectiveProjectRoot(runner, { cwd: CWD });

    expect(result).toEqual({ kind: "repo", root: CWD, source: "current", candidates: [CWD], note: null });
    expect(runner.calls).toEqual([{ bin: "git", args: TOPLEVEL_ARGS, cwd: CWD }]);
    expectNoGitInit(runner);
  });

  it("resolves a nested directory to the parent repo root", async () => {
    const runner = createRunner([createRun(`${CWD}\n`)]);

    const result = await resolveEffectiveProjectRoot(runner, { cwd: NESTED_CWD });

    expect(result).toEqual({ kind: "repo", root: CWD, source: "parent", candidates: [CWD], note: null });
    expect(runner.calls).toEqual([{ bin: "git", args: TOPLEVEL_ARGS, cwd: NESTED_CWD }]);
    expectNoGitInit(runner);
  });

  it("selects exactly one child repo", async () => {
    const runner = createRunner([createFailure(), createRun(`${CHILD_REPO}\n`), createFailure()]);

    const result = await resolveEffectiveProjectRoot(runner, {
      cwd: CWD,
      readDir: () => ["child", "not-a-repo"],
    });

    expect(result).toEqual({
      kind: "repo",
      root: CHILD_REPO,
      source: "unique-child",
      candidates: [CHILD_REPO],
      note: null,
    });
    expect(runner.calls).toEqual([
      { bin: "git", args: TOPLEVEL_ARGS, cwd: CWD },
      { bin: "git", args: TOPLEVEL_ARGS, cwd: CHILD_REPO },
      { bin: "git", args: TOPLEVEL_ARGS, cwd: "/work/micode/not-a-repo" },
    ]);
    expectNoGitInit(runner);
  });

  it("discovers an unambiguous opencode child repo from the workspace container", async () => {
    const runner = createRunner([createFailure(), createRun(`${OPENCODE_REPO}\n`)]);

    const result = await resolveEffectiveProjectRoot(runner, {
      cwd: WORKSPACE_CWD,
      readDir: () => ["opencode"],
    });

    expect(result).toEqual({
      kind: "repo",
      root: OPENCODE_REPO,
      source: "unique-child",
      candidates: [OPENCODE_REPO],
      note: null,
    });
    expect(runner.calls).toEqual([
      { bin: "git", args: TOPLEVEL_ARGS, cwd: WORKSPACE_CWD },
      { bin: "git", args: TOPLEVEL_ARGS, cwd: OPENCODE_REPO },
    ]);
    expectNoGitInit(runner);
  });

  it("reports multiple child repos as ambiguous", async () => {
    const runner = createRunner([
      createFailure(),
      createRun(`${OTHER_CHILD_REPO}\n`),
      createRun(`${CHILD_REPO}\n`),
      createRun(`${CHILD_REPO}\n`),
    ]);

    const result = await resolveEffectiveProjectRoot(runner, {
      cwd: CWD,
      readDir: () => ["other", "child", "duplicate"],
    });

    expect(result).toEqual({
      kind: "ambiguous",
      root: CWD,
      source: "ambiguous",
      candidates: [CHILD_REPO, OTHER_CHILD_REPO],
      note: "Multiple child git repositories were discovered; choose one explicitly.",
    });
    expectNoGitInit(runner);
  });

  it("returns uninitialized when no repo exists", async () => {
    const runner = createRunner([createFailure(), createFailure(), createFailure()]);

    const result = await resolveEffectiveProjectRoot(runner, {
      cwd: CWD,
      readDir: () => ["src", "tests"],
    });

    expect(result).toEqual({
      kind: "uninitialized",
      root: CWD,
      source: "uninitialized",
      candidates: [],
      note: "No git repository was discovered; repository initialization is required before lifecycle work.",
    });
    expectNoGitInit(runner);
  });

  it("returns blocked when readDir fails", async () => {
    const runner = createRunner([createFailure()]);

    const result = await resolveEffectiveProjectRoot(runner, {
      cwd: CWD,
      readDir: () => {
        throw new Error("permission denied: /secret/path");
      },
    });

    expect(result.kind).toBe("blocked");
    expect(result.root).toBe(CWD);
    expect(result.source).toBe("blocked");
    expect(result.candidates).toEqual([]);
    expect(result.note).toContain("Unable to scan direct child directories");
    expect(result.note).not.toContain("/secret/path");
    expectNoGitInit(runner);
  });

  it("returns blocked when the runner throws unexpectedly", async () => {
    const runner = createRunner([new Error("git executable missing at /secret/bin/git")]);

    const result = await resolveEffectiveProjectRoot(runner, { cwd: CWD });

    expect(result.kind).toBe("blocked");
    expect(result.root).toBe(CWD);
    expect(result.source).toBe("blocked");
    expect(result.candidates).toEqual([]);
    expect(result.note).toContain("Unable to probe git repository root");
    expect(result.note).not.toContain("/secret/bin/git");
    expectNoGitInit(runner);
  });
});
