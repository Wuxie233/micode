import { describe, expect, it } from "bun:test";

import { resolveDefaultBranch } from "@/lifecycle/default-branch";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/repo/micode";
const MAIN_BRANCH = "main";
const MASTER_BRANCH = "master";
const TRUNK_BRANCH = "trunk";
const REPO_VIEW_JSON = JSON.stringify({ nameWithOwner: "Wuxie233/micode" });
const ORIGIN_HEAD_ARGS = ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"] as const;
const GH_DEFAULT_BRANCH_ARGS = ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"] as const;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface WarningCall {
  readonly module: string;
  readonly message: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

interface FakeLog {
  readonly warnings: readonly WarningCall[];
  readonly warn: (module: string, message: string) => void;
}

interface RunnerOutputs {
  readonly git?: readonly RunResult[];
  readonly gh?: readonly RunResult[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createFailure = (): RunResult => createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE);

const createRunner = (outputs: RunnerOutputs): FakeRunner => {
  const calls: RunnerCall[] = [];
  let gitIndex = 0;
  let ghIndex = 0;

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      const run = outputs.git?.[gitIndex] ?? createFailure();
      gitIndex += 1;
      return run;
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const run = outputs.gh?.[ghIndex] ?? createFailure();
      ghIndex += 1;
      return run;
    },
  };
};

const createLog = (): FakeLog => {
  const warnings: WarningCall[] = [];
  return {
    warnings,
    warn: (module, message) => warnings.push({ module, message }),
  };
};

describe("resolveDefaultBranch", () => {
  it("returns a non-empty override without calling git or gh", async () => {
    const runner = createRunner({});

    const branch = await resolveDefaultBranch(runner, { cwd: CWD, override: TRUNK_BRANCH });

    expect(branch).toEqual({ branch: TRUNK_BRANCH, source: "override" });
    expect(runner.calls).toEqual([]);
  });

  it("uses main from origin HEAD", async () => {
    const runner = createRunner({ git: [createRun("origin/main\n")] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: MAIN_BRANCH, source: "origin-head" });
    expect(runner.calls).toEqual([{ bin: "git", args: ORIGIN_HEAD_ARGS, cwd: CWD }]);
  });

  it("uses master from origin HEAD", async () => {
    const runner = createRunner({ git: [createRun("origin/master\n")] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: MASTER_BRANCH, source: "origin-head" });
  });

  it("uses a custom branch from origin HEAD", async () => {
    const runner = createRunner({ git: [createRun("origin/trunk\n")] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: TRUNK_BRANCH, source: "origin-head" });
  });

  it("falls back to github when symbolic ref fails", async () => {
    const runner = createRunner({ git: [createFailure()], gh: [createRun(`${TRUNK_BRANCH}\n`)] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: TRUNK_BRANCH, source: "github" });
    expect(runner.calls).toEqual([
      { bin: "git", args: ORIGIN_HEAD_ARGS, cwd: CWD },
      { bin: "gh", args: GH_DEFAULT_BRANCH_ARGS, cwd: CWD },
    ]);
  });

  it("falls back to local main when origin HEAD and github fail", async () => {
    const runner = createRunner({ git: [createFailure(), createRun()], gh: [createFailure()] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: MAIN_BRANCH, source: "local-fallback" });
    expect(runner.calls).toEqual([
      { bin: "git", args: ORIGIN_HEAD_ARGS, cwd: CWD },
      { bin: "gh", args: GH_DEFAULT_BRANCH_ARGS, cwd: CWD },
      { bin: "git", args: ["rev-parse", "--verify", MAIN_BRANCH], cwd: CWD },
    ]);
  });

  it("ignores github JSON ownership output as an invalid branch", async () => {
    const runner = createRunner({ git: [createFailure(), createRun()], gh: [createRun(REPO_VIEW_JSON)] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: MAIN_BRANCH, source: "local-fallback" });
    expect(runner.calls).toEqual([
      { bin: "git", args: ORIGIN_HEAD_ARGS, cwd: CWD },
      { bin: "gh", args: GH_DEFAULT_BRANCH_ARGS, cwd: CWD },
      { bin: "git", args: ["rev-parse", "--verify", MAIN_BRANCH], cwd: CWD },
    ]);
  });

  it("falls back to local master when main is missing", async () => {
    const runner = createRunner({ git: [createFailure(), createFailure(), createRun()], gh: [createFailure()] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: MASTER_BRANCH, source: "local-fallback" });
    expect(runner.calls.at(-1)).toEqual({ bin: "git", args: ["rev-parse", "--verify", MASTER_BRANCH], cwd: CWD });
  });

  it("uses last-resort main with a warning", async () => {
    const runner = createRunner({ git: [createFailure(), createFailure(), createFailure()], gh: [createFailure()] });
    const log = createLog();

    const branch = await resolveDefaultBranch(runner, { cwd: CWD, log });

    expect(branch).toEqual({ branch: MAIN_BRANCH, source: "last-resort" });
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]?.message).toContain("origin-head");
    expect(log.warnings[0]?.message).toContain("github");
    expect(log.warnings[0]?.message).toContain("local-fallback");
    expect(log.warnings[0]?.message).toContain("using main");
  });

  it("falls through when override is empty", async () => {
    const runner = createRunner({ git: [createRun("origin/main\n")] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD, override: "   " });

    expect(branch).toEqual({ branch: MAIN_BRANCH, source: "origin-head" });
    expect(runner.calls).toHaveLength(1);
  });

  it("trims whitespace and origin prefix", async () => {
    const runner = createRunner({ git: [createRun("  origin/trunk  \n")] });

    const branch = await resolveDefaultBranch(runner, { cwd: CWD });

    expect(branch).toEqual({ branch: TRUNK_BRANCH, source: "origin-head" });
  });
});
