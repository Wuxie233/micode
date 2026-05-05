import { describe, expect, it } from "bun:test";

import { classifyRepo, parseOriginTarget, REPO_KIND } from "@/lifecycle/pre-flight";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/workspace/micode";
const OWNER = "Wuxie233";
const REPO = "Wuxie233/micode";
const PARENT_OWNER = "vtemian";
const PARENT_NAME = "micode";
const PARENT_REPO = `${PARENT_OWNER}/${PARENT_NAME}`;
const ORIGIN_SSH = `git@github.com:${REPO}.git`;
const ORIGIN_HTTPS = `https://github.com/${REPO}.git`;
const ORIGIN_HTTPS_NO_GIT = `https://github.com/${REPO}`;
const ORIGIN_SSH_PROTOCOL = `ssh://git@github.com/${REPO}.git`;
const PARENT_URL = `https://github.com/${PARENT_REPO}`;
const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const GIT_ARGS = ["remote", "get-url", "origin"] as const;
const GH_FIELDS = "nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled";
// The new explicit-target form: repo view <owner/repo> --json <fields>
const GH_ARGS_WITH_TARGET = ["repo", "view", REPO, "--json", GH_FIELDS] as const;
const REAL_GH_REPO_VIEW = JSON.stringify({
  hasIssuesEnabled: true,
  isFork: true,
  nameWithOwner: REPO,
  owner: { id: "U_kgDOBz91cg", login: OWNER },
  parent: {
    id: "R_kgDOQsR0VA",
    name: PARENT_NAME,
    owner: { id: "MDQ6VXNlcjYzOTc3MQ==", login: PARENT_OWNER },
  },
  viewerPermission: "ADMIN",
});

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

const createRunner = (outputs: RunnerOutputs, origin = ORIGIN_SSH): FakeRunner => {
  const calls: RunnerCall[] = [];

  return {
    calls,
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return outputs.git ?? createRun(`${origin}\n`);
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      return outputs.gh ?? createRun(EMPTY_OUTPUT);
    },
  };
};

const createRepoView = (overrides: Record<string, unknown>): string =>
  JSON.stringify({
    nameWithOwner: REPO,
    isFork: false,
    parent: null,
    owner: { login: OWNER },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
    ...overrides,
  });

const expectCalls = (runner: FakeRunner): void => {
  expect(runner.calls).toEqual([
    { bin: "git", args: GIT_ARGS, cwd: CWD },
    { bin: "gh", args: GH_ARGS_WITH_TARGET, cwd: CWD },
  ]);
};

describe("parseOriginTarget", () => {
  it("parses ssh remote with .git suffix", () => {
    expect(parseOriginTarget("git@github.com:Wuxie233/micode.git")).toBe("Wuxie233/micode");
  });

  it("parses https remote with .git suffix", () => {
    expect(parseOriginTarget("https://github.com/Wuxie233/micode.git")).toBe("Wuxie233/micode");
  });

  it("parses https remote without .git suffix", () => {
    expect(parseOriginTarget("https://github.com/Wuxie233/micode")).toBe("Wuxie233/micode");
  });

  it("parses ssh:// protocol remote with .git suffix", () => {
    expect(parseOriginTarget("ssh://git@github.com/Wuxie233/micode.git")).toBe("Wuxie233/micode");
  });

  it("returns null for non-github remotes", () => {
    expect(parseOriginTarget("https://gitlab.com/owner/repo.git")).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(parseOriginTarget("not-a-url")).toBeNull();
    expect(parseOriginTarget("")).toBeNull();
  });
});

describe("classifyRepo", () => {
  it("passes explicit origin target to gh repo view for ssh remote", async () => {
    const runner = createRunner({
      gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
    });

    await classifyRepo(runner, CWD);

    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args[2]).toBe(REPO);
  });

  it("passes explicit origin target to gh repo view for https remote", async () => {
    const runner = createRunner(
      {
        gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
      },
      ORIGIN_HTTPS,
    );

    await classifyRepo(runner, CWD);

    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args[2]).toBe(REPO);
  });

  it("passes explicit origin target to gh repo view for https without .git", async () => {
    const runner = createRunner({ gh: createRun(createRepoView({ isFork: true, parent: null })) }, ORIGIN_HTTPS_NO_GIT);

    await classifyRepo(runner, CWD);

    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args[2]).toBe(REPO);
  });

  it("passes explicit origin target to gh repo view for ssh:// protocol", async () => {
    const runner = createRunner({ gh: createRun(createRepoView({ isFork: true, parent: null })) }, ORIGIN_SSH_PROTOCOL);

    await classifyRepo(runner, CWD);

    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args[2]).toBe(REPO);
  });

  it("returns unknown when gh nameWithOwner does not case-insensitively match origin", async () => {
    // gh returned metadata for vtemian/micode (upstream) instead of Wuxie233/micode (origin)
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          nameWithOwner: "vtemian/micode",
          owner: { login: "vtemian" },
          viewerPermission: "READ",
          hasIssuesEnabled: false,
          isFork: false,
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.nameWithOwner).toBe(EMPTY_OUTPUT);
  });

  it("returns unknown when origin URL cannot be parsed", async () => {
    const runner = createRunner({ git: createRun("not-a-github-url\n") }, "not-a-github-url");

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    // Should not have called gh at all since origin is unparseable
    expect(runner.calls.filter((c) => c.bin === "gh")).toHaveLength(0);
  });

  it("classifies forks when parent uses { name, owner.login } shape", async () => {
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          isFork: true,
          parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } },
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.FORK,
      origin: ORIGIN_SSH,
      nameWithOwner: REPO,
      viewerLogin: OWNER,
      issuesEnabled: true,
      upstreamUrl: PARENT_URL,
    });
    expectCalls(runner);
  });

  it("classifies forks even when parent is null", async () => {
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          isFork: true,
          parent: null,
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.FORK,
      origin: ORIGIN_SSH,
      nameWithOwner: REPO,
      viewerLogin: OWNER,
      issuesEnabled: true,
      upstreamUrl: null,
    });
    expectCalls(runner);
  });

  it("still classifies legacy nameWithOwner parent shape", async () => {
    const runner = createRunner({
      gh: createRun(
        createRepoView({
          isFork: true,
          parent: { nameWithOwner: PARENT_REPO, url: PARENT_URL },
        }),
      ),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.FORK,
      origin: ORIGIN_SSH,
      nameWithOwner: REPO,
      viewerLogin: OWNER,
      issuesEnabled: true,
      upstreamUrl: PARENT_URL,
    });
    expectCalls(runner);
  });

  it("classifies real gh fixture regression as fork with upstream URL", async () => {
    const runner = createRunner({ gh: createRun(REAL_GH_REPO_VIEW) });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.FORK);
    expect(preflight.upstreamUrl).toBe(PARENT_URL);
    expectCalls(runner);
  });

  it("classifies writable originals as own repos", async () => {
    const runner = createRunner(
      { gh: createRun(createRepoView({ nameWithOwner: "Wuxie233/tool" })) },
      "git@github.com:Wuxie233/tool.git",
    );

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.OWN);
    expect(preflight.nameWithOwner).toBe("Wuxie233/tool");
    expect(preflight.viewerLogin).toBe(OWNER);
    expect(preflight.upstreamUrl).toBeNull();
    // gh should have been called with the tool repo target
    const ghCall = runner.calls.find((c) => c.bin === "gh");
    expect(ghCall?.args[2]).toBe("Wuxie233/tool");
  });

  it("classifies read-only originals as upstream repos when viewed for that same repo", async () => {
    // This scenario: origin IS vtemian/micode (user cloned upstream directly).
    // gh view returns upstream data that matches origin, so it should classify as UPSTREAM.
    const runner = createRunner(
      {
        gh: createRun(
          createRepoView({
            nameWithOwner: "vtemian/micode",
            owner: { login: "vtemian" },
            viewerPermission: "READ",
            hasIssuesEnabled: false,
          }),
        ),
      },
      "git@github.com:vtemian/micode.git",
    );

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight).toEqual({
      kind: REPO_KIND.UPSTREAM,
      origin: "git@github.com:vtemian/micode.git",
      nameWithOwner: "vtemian/micode",
      viewerLogin: null,
      issuesEnabled: false,
      upstreamUrl: null,
    });
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
