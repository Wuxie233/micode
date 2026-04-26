import { describe, expect, it } from "bun:test";

import { classifyRepo, REPO_KIND } from "@/lifecycle/pre-flight";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/workspace/micode";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const PARENT_URL = "https://github.com/vtemian/micode";
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const GIT_ARGS = ["remote", "get-url", "origin"] as const;
const GH_FIELDS = "nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled";
const GH_ARGS = ["repo", "view", "--json", GH_FIELDS] as const;

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
}

interface RunnerOutputs {
  readonly git?: RunResult;
  readonly gh?: RunResult;
}

const createRun = (stdout: string, exitCode = OK_EXIT_CODE): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode,
});

const createRunner = (outputs: RunnerOutputs): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return outputs.git ?? createRun(`${ORIGIN}\n`);
    },
    gh: async (args) => {
      calls.push({ bin: "gh", args });
      return outputs.gh ?? createRun(EMPTY_OUTPUT);
    },
  };
};

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

const expectCalls = (runner: FakeRunner): void => {
  expect(runner.calls).toEqual([
    { bin: "git", args: GIT_ARGS, cwd: CWD },
    { bin: "gh", args: GH_ARGS },
  ]);
};

describe("classifyRepo", () => {
  it("classifies forks and exposes upstream metadata", async () => {
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          isFork: true,
          parent: { nameWithOwner: "vtemian/micode", url: PARENT_URL },
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.FORK,
      origin: ORIGIN,
      nameWithOwner: "Wuxie233/micode",
      viewerLogin: "Wuxie233",
      issuesEnabled: true,
      upstreamUrl: PARENT_URL,
    });
    expectCalls(runner);
  });

  it("classifies writable originals as own repos", async () => {
    const runner = createRunner({ gh: createRun(createRepoView({ nameWithOwner: "Wuxie233/tool" })) });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.OWN);
    expect(preflight.nameWithOwner).toBe("Wuxie233/tool");
    expect(preflight.viewerLogin).toBe("Wuxie233");
    expect(preflight.upstreamUrl).toBeNull();
    expectCalls(runner);
  });

  it("classifies read-only originals as upstream repos", async () => {
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          nameWithOwner: "vtemian/micode",
          owner: { login: "vtemian" },
          viewerPermission: "READ",
          hasIssuesEnabled: false,
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.UPSTREAM,
      origin: ORIGIN,
      nameWithOwner: "vtemian/micode",
      viewerLogin: null,
      issuesEnabled: false,
      upstreamUrl: null,
    });
    expectCalls(runner);
  });

  it("returns unknown when ownership commands fail", async () => {
    const runner = createRunner({ git: createRun(EMPTY_OUTPUT, FAILURE_EXIT_CODE) });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.UNKNOWN,
      origin: EMPTY_OUTPUT,
      nameWithOwner: EMPTY_OUTPUT,
      viewerLogin: null,
      issuesEnabled: false,
      upstreamUrl: null,
    });
    expect(runner.calls).toEqual([{ bin: "git", args: GIT_ARGS, cwd: CWD }]);
  });
});
