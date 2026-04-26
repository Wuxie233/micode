import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { CommitInput, CommitOutcome } from "@/lifecycle";
import { type CommitHandle, createLifecycleCommitTool } from "@/tools/lifecycle/commit";
import { config } from "@/utils/config";

interface CommitCall {
  readonly issueNumber: number;
  readonly input: CommitInput;
}

const ISSUE_NUMBER = 42;
const SHA = "abc123def456";
const SCOPE = "lifecycle";
const SUMMARY = "add commit tool";
const PUSH_FAILED_HEADER = "## Push failed (commit retained locally)";
const PUSH_FAILED_NOTE = "Push failed after retry: remote rejected push";
const NON_RETRY_NOTE = "Commit retained without retrying push";

const successOutcome: CommitOutcome = {
  committed: true,
  sha: SHA,
  pushed: true,
  retried: false,
  note: null,
};

const retainedOutcome: CommitOutcome = {
  committed: true,
  sha: SHA,
  pushed: false,
  retried: true,
  note: PUSH_FAILED_NOTE,
};

const nonRetriedOutcome: CommitOutcome = {
  committed: true,
  sha: SHA,
  pushed: false,
  retried: false,
  note: NON_RETRY_NOTE,
};

const createHandle = (
  outcome: CommitOutcome,
): { readonly handle: CommitHandle; readonly calls: readonly CommitCall[] } => {
  const calls: CommitCall[] = [];

  return {
    calls,
    handle: {
      commit: async (issueNumber, input) => {
        calls.push({ issueNumber, input });
        return outcome;
      },
    },
  };
};

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

const executeCommit = async (handle: CommitHandle, args: Record<string, unknown>): Promise<string> => {
  const lifecycleCommit = createLifecycleCommitTool(handle);
  const output = await lifecycleCommit.execute(args, {} as unknown as ToolContext);
  return stringify(output);
};

describe("lifecycle_commit tool", () => {
  it("commits lifecycle work and returns the sha table", async () => {
    const fake = createHandle(successOutcome);

    const output = await executeCommit(fake.handle, {
      issue_number: ISSUE_NUMBER,
      scope: SCOPE,
      summary: SUMMARY,
    });

    expect(fake.calls).toEqual([
      {
        issueNumber: ISSUE_NUMBER,
        input: { scope: SCOPE, summary: SUMMARY, push: config.lifecycle.autoPush },
      },
    ]);
    expect(output).toContain("## Lifecycle commit recorded");
    expect(output).toContain("| Issue # | SHA | Pushed |");
    expect(output).toContain(`| ${ISSUE_NUMBER} | \`${SHA}\` | \`true\` |`);
  });

  it("uses an explicit push override when provided", async () => {
    const fake = createHandle({ ...successOutcome, pushed: false });

    const output = await executeCommit(fake.handle, {
      issue_number: ISSUE_NUMBER,
      scope: SCOPE,
      summary: SUMMARY,
      push: false,
    });

    expect(fake.calls[0]?.input.push).toBe(false);
    expect(output).toContain(`| ${ISSUE_NUMBER} | \`${SHA}\` | \`false\` |`);
  });

  it("reports retained local commits with the contract push failure header", async () => {
    const fake = createHandle(retainedOutcome);

    const output = await executeCommit(fake.handle, {
      issue_number: ISSUE_NUMBER,
      scope: SCOPE,
      summary: SUMMARY,
    });

    expect(output.startsWith(PUSH_FAILED_HEADER)).toBe(true);
    expect(output).toContain(PUSH_FAILED_NOTE);
    expect(output).toContain(`| ${ISSUE_NUMBER} | \`${SHA}\` | \`false\` |`);
  });

  it("does not report non-retried retained commits as retry-exhausted push failures", async () => {
    const fake = createHandle(nonRetriedOutcome);

    const output = await executeCommit(fake.handle, {
      issue_number: ISSUE_NUMBER,
      scope: SCOPE,
      summary: SUMMARY,
    });

    expect(output.startsWith(PUSH_FAILED_HEADER)).toBe(false);
    expect(output).toContain("## Lifecycle commit recorded");
    expect(output).toContain(NON_RETRY_NOTE);
  });
});
