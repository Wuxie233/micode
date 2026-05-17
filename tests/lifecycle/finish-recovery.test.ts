import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createLifecycleStore, type FinishInput, type FinishOutcome, type LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import type { ResolverResult } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";

const TOOL_CONTEXT = {} as unknown as ToolContext;
const PREFIX = "micode-finish-recovery-";
const OWNER = "Wuxie233";
const REPO = "micode";
const ORIGIN = `git@github.com:${OWNER}/${REPO}.git`;
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const ISSUE_NUMBER = 98;
const ISSUE_URL = `https://github.com/${OWNER}/${REPO}/issues/${ISSUE_NUMBER}`;
const SUMMARY = "Harden lifecycle finish identity";

interface RunnerCall {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner extends LifecycleRunner {
  readonly calls: readonly RunnerCall[];
  readonly edits: readonly string[];
}

const createRun = (stdout = EMPTY_OUTPUT, exitCode = OK_EXIT_CODE, stderr = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr,
  exitCode,
});

const createRepoView = (): string =>
  JSON.stringify({
    nameWithOwner: `${OWNER}/${REPO}`,
    isFork: true,
    parent: { nameWithOwner: "vtemian/micode", url: "https://github.com/vtemian/micode" },
    owner: { login: OWNER },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
  });

const isArgs = (args: readonly string[], expected: readonly string[]): boolean => {
  return expected.every((value, index) => args[index] === value);
};

const createRunner = (registeredWorktrees: readonly string[] = []): FakeRunner => {
  const calls: RunnerCall[] = [];
  const edits: string[] = [];

  return {
    calls,
    edits,
    git: async (args, runOptions) => {
      calls.push({ bin: "git", args, cwd: runOptions?.cwd });
      if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);
      if (isArgs(args, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])) return createRun("origin/main\n");
      if (isArgs(args, ["rev-parse", "HEAD"])) return createRun("abc123def456\n");
      if (isArgs(args, ["rev-parse", "--abbrev-ref", "HEAD"])) {
        const issueMatch = /issue-(\d+)-(.+)$/.exec(runOptions?.cwd ?? EMPTY_OUTPUT);
        if (issueMatch) return createRun(`issue/${issueMatch[1]}-${issueMatch[2]}\n`);
        return createRun("main\n");
      }
      if (isArgs(args, ["rev-parse", "--show-toplevel"])) return createRun(`${runOptions?.cwd ?? EMPTY_OUTPUT}\n`);
      if (isArgs(args, ["worktree", "list", "--porcelain"])) {
        return createRun(registeredWorktrees.map((worktree) => `worktree ${worktree}`).join("\n"));
      }
      return createRun();
    },
    gh: async (args, runOptions) => {
      calls.push({ bin: "gh", args, cwd: runOptions?.cwd });
      if (isArgs(args, ["repo", "view"])) return createRun(createRepoView());
      if (isArgs(args, ["issue", "view"])) {
        const issueNumber = args[2];
        const matchingEdit = calls.findLast(
          (call) => call.bin === "gh" && isArgs(call.args, ["issue", "edit", issueNumber ?? EMPTY_OUTPUT]),
        );
        return createRun(JSON.stringify({ body: matchingEdit?.args.at(-1) ?? "## Context\n\nExisting body" }));
      }
      if (isArgs(args, ["issue", "edit"])) edits.push(args.at(-1) ?? EMPTY_OUTPUT);
      return createRun();
    },
  };
};

const fakeHandle = (outcome: FinishOutcome | Error): Pick<LifecycleHandle, "finish"> => ({
  finish: async () => {
    if (outcome instanceof Error) throw outcome;
    return outcome;
  },
});

const recordingHandle = (
  outcome: FinishOutcome,
): {
  readonly handle: Pick<LifecycleHandle, "finish">;
  readonly calls: { issueNumber: number; input: FinishInput }[];
} => {
  const calls: { issueNumber: number; input: FinishInput }[] = [];
  return {
    calls,
    handle: {
      finish: async (issueNumber, input) => {
        calls.push({ issueNumber, input });
        return outcome;
      },
    },
  };
};

const fakeInference = (result: ResolverResult): { readonly current: () => Promise<ResolverResult> } => ({
  current: async () => result,
});

const resolvedResult = (issueNumber: number): ResolverResult => ({
  kind: "resolved",
  record: {
    issueNumber,
    issueUrl: `https://github.com/Wuxie233/micode/issues/${issueNumber}`,
    branch: `issue/${issueNumber}-test`,
    worktree: `/tmp/issue-${issueNumber}`,
    state: "in_progress",
    artifacts: { design: [], plan: [], ledger: [], commit: [], pr: [], worktree: [] },
    notes: [],
    updatedAt: Date.now(),
  },
});

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const executeFinish = async (handle: Pick<LifecycleHandle, "finish">): Promise<string> => {
  const tool = createLifecycleFinishTool(handle);
  const exec = tool.execute.bind(tool) as unknown as ExecuteSignature;
  return stringify(await exec({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT));
};

const successOutcome = (): FinishOutcome => ({
  merged: true,
  prUrl: null,
  closedAt: Date.now(),
  worktreeRemoved: true,
  cleanupOutcome: { kind: "removed", reason: "x", retried: false },
  note: null,
});

describe("lifecycle_finish integration identity recovery", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), `${PREFIX}worktrees-`));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("finish(98) from main uses one valid worktree artifact and avoids invalid_issue_branch", async () => {
    const issueWorktree = join(worktreesRoot, "issue-98-harden-lifecycle-finish-identity");
    mkdirSync(issueWorktree, { recursive: true });
    const runner = createRunner([worktreesRoot, issueWorktree]);
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const issueRecord = {
      issueNumber: ISSUE_NUMBER,
      issueUrl: ISSUE_URL,
      branch: "main",
      worktree: worktreesRoot,
      state: "in_progress",
      artifacts: { design: [], plan: [], ledger: [], commit: [], pr: [], worktree: [issueWorktree] },
      notes: [],
      updatedAt: Date.now(),
    };
    await Bun.write(join(baseDir, `${ISSUE_NUMBER}.json`), JSON.stringify(issueRecord, null, 2));

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(true);
    expect(outcome.note ?? EMPTY_OUTPUT).not.toContain("invalid_issue_branch");
    expect(
      runner.calls.some(
        (call) =>
          call.bin === "git" && isArgs(call.args, ["merge", "--no-ff", "issue/98-harden-lifecycle-finish-identity"]),
      ),
    ).toBe(true);
    expect(runner.calls.some((call) => call.bin === "git" && isArgs(call.args, ["merge", "--no-ff", "main"]))).toBe(
      false,
    );
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, ["issue", "close", "98"]))).toBe(true);
  });

  it("finish(98) from main with zero worktree artifacts returns ambiguous_lifecycle ask_user blocker", async () => {
    const runner = createRunner([worktreesRoot]);
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const issueRecord = {
      issueNumber: ISSUE_NUMBER,
      issueUrl: ISSUE_URL,
      branch: "main",
      worktree: worktreesRoot,
      state: "in_progress",
      artifacts: { design: [], plan: [], ledger: [], commit: [], pr: [], worktree: [] },
      notes: [],
      updatedAt: Date.now(),
    };
    await Bun.write(join(baseDir, `${ISSUE_NUMBER}.json`), JSON.stringify(issueRecord, null, 2));

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(false);
    expect(outcome.note).toContain("ambiguous_lifecycle");
    expect(outcome.note).toContain("branch=main and no validated issue worktree artifact");
    expect(outcome.recoveryHint?.failureKind).toBe("ambiguous_lifecycle");
    expect(outcome.recoveryHint?.recommendedNextAction).toBe("ask_user");
    expect(outcome.recoveryHint?.issueNumber).toBe(ISSUE_NUMBER);
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
    expect(runner.calls.some((call) => call.bin === "git" && isArgs(call.args, ["merge", "--no-ff"]))).toBe(false);
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, ["pr", "create"]))).toBe(false);
  });

  it("explicit issue_number overrides inferred identity and corrupted stored record identity", async () => {
    const explicitWorktree = join(worktreesRoot, "issue-98-harden-lifecycle-finish-identity");
    mkdirSync(explicitWorktree, { recursive: true });
    const runner = createRunner([worktreesRoot, explicitWorktree]);
    const handle = createLifecycleStore({ runner, worktreesRoot, cwd: worktreesRoot, baseDir });
    const corruptedRecord = {
      issueNumber: 1,
      issueUrl: `https://github.com/${OWNER}/${REPO}/issues/1`,
      branch: "main",
      worktree: worktreesRoot,
      state: "in_progress",
      artifacts: { design: [], plan: [], ledger: [], commit: [], pr: [], worktree: [explicitWorktree] },
      notes: [],
      updatedAt: Date.now(),
    };
    await Bun.write(join(baseDir, `${ISSUE_NUMBER}.json`), JSON.stringify(corruptedRecord, null, 2));

    const outcome = await handle.finish(ISSUE_NUMBER, { mergeStrategy: "local-merge", waitForChecks: false });
    const persisted = await handle.load(ISSUE_NUMBER);
    const issueEditCalls = runner.calls.filter((call) => call.bin === "gh" && isArgs(call.args, ["issue", "edit"]));

    expect(outcome.merged).toBe(true);
    expect(persisted?.issueNumber).toBe(ISSUE_NUMBER);
    expect(persisted?.issueUrl).toBe(ISSUE_URL);
    expect(issueEditCalls.some((call) => isArgs(call.args, ["issue", "edit", "1"]))).toBe(false);
    expect(issueEditCalls.some((call) => isArgs(call.args, ["issue", "edit", "98"]))).toBe(true);
    expect(
      runner.calls.some(
        (call) =>
          call.bin === "git" && isArgs(call.args, ["merge", "--no-ff", "issue/98-harden-lifecycle-finish-identity"]),
      ),
    ).toBe(true);
    expect(runner.calls.some((call) => call.bin === "gh" && isArgs(call.args, ["issue", "close", "98"]))).toBe(true);
  });
});

describe("lifecycle_finish tool recovery hint", () => {
  it("success outcome contains no `### Recovery hint` section", async () => {
    const md = await executeFinish(
      fakeHandle({
        merged: true,
        prUrl: null,
        closedAt: Date.now(),
        worktreeRemoved: true,
        cleanupOutcome: { kind: "removed", reason: "x", retried: false },
        note: null,
      }),
    );
    expect(md).not.toContain("### Recovery hint");
  });

  it("merge_conflict outcome contains recovery hint with conflict_files and worktree", async () => {
    const hint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "2 conflicts",
      issueNumber: 67,
      worktree: "/tmp/m",
      conflictFiles: ["a.ts", "b.ts"],
    });
    const md = await executeFinish(
      fakeHandle({
        merged: false,
        prUrl: null,
        closedAt: null,
        worktreeRemoved: false,
        cleanupOutcome: { kind: "failed", reason: "n/a", retried: false },
        note: "merge_conflict",
        recoveryHint: hint,
      }),
    );
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `merge_conflict`");
    expect(md).toContain("**worktree:** `/tmp/m`");
    expect(md).toContain("- `a.ts`");
    expect(md).toContain("- `b.ts`");
  });

  it("exception path emits unknown hint with summary=error message", async () => {
    const md = await executeFinish(fakeHandle(new Error("boom")));
    expect(md).toContain("## Lifecycle finish failed");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `unknown`");
    expect(md).toContain("**recommended_next_action:** `ask_user`");
    expect(md).toContain("**issue_number:** `67`");
    expect(md).toContain("boom");
  });

  it("uses explicit issue_number before inference", async () => {
    const fake = recordingHandle(successOutcome());
    let inferenceCalls = 0;
    const tool = createLifecycleFinishTool(fake.handle, {
      current: async () => {
        inferenceCalls += 1;
        return resolvedResult(99);
      },
    });
    const exec = tool.execute.bind(tool) as unknown as ExecuteSignature;

    const md = stringify(
      await exec({ issue_number: 67, merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT),
    );

    expect(md).toContain("## Lifecycle finished");
    expect(inferenceCalls).toBe(0);
    expect(fake.calls.map((call) => call.issueNumber)).toEqual([67]);
  });

  it("infers issue_number from current lifecycle when omitted", async () => {
    const fake = recordingHandle(successOutcome());
    const tool = createLifecycleFinishTool(fake.handle, fakeInference(resolvedResult(88)));
    const exec = tool.execute.bind(tool) as unknown as ExecuteSignature;

    const md = stringify(await exec({ merge_strategy: "pr", wait_for_checks: true }, TOOL_CONTEXT));

    expect(md).toContain("## Lifecycle finished");
    expect(fake.calls.map((call) => call.issueNumber)).toEqual([88]);
    expect(fake.calls[0]?.input).toMatchObject({ mergeStrategy: "pr", waitForChecks: true });
  });

  it("returns invalid_issue_number hint and skips finish when inference is ambiguous", async () => {
    const fake = recordingHandle(successOutcome());
    const tool = createLifecycleFinishTool(
      fake.handle,
      fakeInference({
        kind: "ambiguous",
        candidates: [
          {
            issueNumber: 10,
            branch: "issue/10-a",
            worktree: "/tmp/a",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
          {
            issueNumber: 11,
            branch: "issue/11-b",
            worktree: "/tmp/b",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    );
    const exec = tool.execute.bind(tool) as unknown as ExecuteSignature;

    const md = stringify(await exec({ merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT));

    expect(fake.calls).toEqual([]);
    expect(md).toContain("## Lifecycle blocked");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `invalid_issue_number`");
    expect(md).toContain("**recommended_next_action:** `ask_user`");
    expect(md).toContain("| 10 | `issue/10-a` | `/tmp/a` | `in_progress` | `false` | - |");
    expect(md).toContain("| 11 | `issue/11-b` | `/tmp/b` | `in_progress` | `false` | - |");
  });
});
