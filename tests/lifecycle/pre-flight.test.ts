import { describe, expect, it } from "bun:test";

import { assertRemoteMutationAllowed, classifyRepo, parseOriginTarget, REPO_KIND } from "@/lifecycle/pre-flight";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/workspace/micode";
const OWNER = "Wuxie233";
const REPO = "Wuxie233/micode";
const DOTTED_REPO = "Wuxie233/my.repo";
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

  it("parses https remote with dotted repo name and .git suffix", () => {
    expect(parseOriginTarget("https://github.com/Wuxie233/my.repo.git")).toBe(DOTTED_REPO);
  });

  it("parses ssh remote with dotted repo name and .git suffix", () => {
    expect(parseOriginTarget("git@github.com:Wuxie233/my.repo.git")).toBe(DOTTED_REPO);
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

  it("passes dotted origin target to gh repo view after stripping only trailing .git", async () => {
    const runner = createRunner(
      { gh: createRun(createRepoView({ nameWithOwner: DOTTED_REPO, isFork: false, parent: null })) },
      `https://github.com/${DOTTED_REPO}.git`,
    );

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.OWN);
    expect(preflight.nameWithOwner).toBe(DOTTED_REPO);
    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args).toEqual(["repo", "view", DOTTED_REPO, "--json", GH_FIELDS]);
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
    expect(preflight.reason).toBe("view-mismatch");
    expect(preflight.nameWithOwner).toBe(EMPTY_OUTPUT);
  });

  it("returns unknown when origin URL cannot be parsed", async () => {
    const runner = createRunner({ git: createRun("not-a-github-url\n") }, "not-a-github-url");

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.reason).toBe("unparseable-origin");
    // Should not have called gh at all since origin is unparseable
    expect(runner.calls.filter((c) => c.bin === "gh")).toHaveLength(0);
  });

  it("returns unknown with gh-failed reason when gh repo view fails", async () => {
    const runner = createRunner({ gh: createRun("fatal: not authenticated", FAILURE_EXIT_CODE) });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.reason).toBe("gh-failed");
    expect(preflight.origin).toBe(ORIGIN_SSH);
  });

  it("returns unknown with invalid-gh-output reason for invalid JSON", async () => {
    const runner = createRunner({ gh: createRun("not-json") });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.reason).toBe("invalid-gh-output");
    expect(preflight.origin).toBe(ORIGIN_SSH);
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
      reason: "no-origin",
      origin: EMPTY_OUTPUT,
      nameWithOwner: EMPTY_OUTPUT,
      viewerLogin: null,
      issuesEnabled: false,
      upstreamUrl: null,
    });
    expect(runner.calls).toEqual([{ bin: "git", args: GIT_ARGS, cwd: CWD }]);
  });

  it("passes origin-derived slug as positional argument to gh repo view", async () => {
    const runner = createRunner({
      gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
    });

    await classifyRepo(runner, CWD);

    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall).toBeDefined();
    expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
  });

  it("parses HTTPS origin URL and queries the matching slug", async () => {
    const httpsOrigin = `https://github.com/${REPO}.git\n`;
    const runner = createRunner({
      git: createRun(httpsOrigin),
      gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.FORK);
    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
  });

  it("parses HTTPS origin URL without trailing .git", async () => {
    const httpsOrigin = `https://github.com/${REPO}\n`;
    const runner = createRunner({
      git: createRun(httpsOrigin),
      gh: createRun(createRepoView({ isFork: true, parent: { name: PARENT_NAME, owner: { login: PARENT_OWNER } } })),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.FORK);
    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
  });

  it("regression: fork with upstream remote still classifies as FORK against origin slug, not upstream", async () => {
    // The bug: bare `gh repo view` resolved to upstream (vtemian/micode) when both
    // origin (Wuxie233/micode) and upstream (vtemian/micode) remotes existed.
    // The fix: we query gh with the exact origin slug, so upstream existence is irrelevant.
    const runner = createRunner({
      gh: createRun(REAL_GH_REPO_VIEW),
    });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.FORK);
    expect(preflight.nameWithOwner).toBe(REPO);
    expect(preflight.viewerLogin).toBe(OWNER);
    expect(preflight.upstreamUrl).toBe(PARENT_URL);
    // Critical assertion: gh was called with origin's slug, not bare.
    const ghCall = runner.calls.find((call) => call.bin === "gh");
    expect(ghCall?.args).toEqual(["repo", "view", REPO, "--json", GH_FIELDS]);
  });

  it("returns unknown when origin URL cannot be parsed as github.com slug", async () => {
    const nonGithubOrigin = "git@gitlab.example.com:other/repo.git\n";
    const runner = createRunner({ git: createRun(nonGithubOrigin) });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.reason).toBe("unparseable-origin");
    expect(preflight.origin).toBe(nonGithubOrigin.trim());
    // gh must NOT be invoked when origin is unparseable: fail-closed.
    expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
  });

  it("returns unknown when origin is empty after trim", async () => {
    const runner = createRunner({ git: createRun("\n") });

    const preflight = await classifyRepo(runner, CWD);

    expect(preflight.kind).toBe(REPO_KIND.UNKNOWN);
    expect(preflight.reason).toBe("no-origin");
    expect(runner.calls.some((call) => call.bin === "gh")).toBe(false);
  });
});

describe("assertRemoteMutationAllowed", () => {
  it("allows fork and own repos and returns repo target", () => {
    const fork = {
      kind: REPO_KIND.FORK,
      origin: ORIGIN_SSH,
      nameWithOwner: REPO,
      viewerLogin: OWNER,
      issuesEnabled: true,
      upstreamUrl: PARENT_URL,
    };
    const own = { ...fork, kind: REPO_KIND.OWN, upstreamUrl: null };

    expect(assertRemoteMutationAllowed(fork, "push")).toEqual({ ok: true, repoTarget: REPO });
    expect(assertRemoteMutationAllowed(own, "issue-create")).toEqual({ ok: true, repoTarget: REPO });
  });

  it("blocks unknown repos with operation-specific note and reason", () => {
    const result = assertRemoteMutationAllowed(
      {
        kind: REPO_KIND.UNKNOWN,
        reason: "gh-failed",
        origin: ORIGIN_SSH,
        nameWithOwner: EMPTY_OUTPUT,
        viewerLogin: null,
        issuesEnabled: false,
        upstreamUrl: null,
      },
      "pr-create",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe("pre_flight_failed");
      expect(result.note).toContain("pr-create");
      expect(result.note).toContain(REPO_KIND.UNKNOWN);
      expect(result.note).toContain("gh-failed");
      expect(result.note).not.toContain("fatal:");
    }
  });

  it("blocks upstream repos with operation-specific note", () => {
    const result = assertRemoteMutationAllowed(
      {
        kind: REPO_KIND.UPSTREAM,
        origin: "git@github.com:vtemian/micode.git",
        nameWithOwner: "vtemian/micode",
        viewerLogin: null,
        issuesEnabled: false,
        upstreamUrl: null,
      },
      "remote-branch-delete",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failureKind).toBe("pre_flight_failed");
      expect(result.note).toContain("remote-branch-delete");
      expect(result.note).toContain(REPO_KIND.UPSTREAM);
      expect(result.note).not.toContain("fatal:");
    }
  });
});
