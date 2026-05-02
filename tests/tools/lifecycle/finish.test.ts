import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { FinishOutcome } from "@/lifecycle";
import {
  createLifecycleFinishTool,
  type LifecycleFinishHandle,
  type LifecycleToolMergeStrategy,
} from "@/tools/lifecycle/finish";

const ISSUE_NUMBER = 42;
const PR_URL = "https://github.com/Wuxie233/micode/pull/42";
const CLOSED_AT = 1_777_222_400_000;
const CHECKS_NOTE = "pr_checks_failed: lint=FAILURE";
const BLOCKED_TASK_IDS = "1.1,1.2";
const EXECUTOR_BLOCKED_NOTE = `executor_blocked: ${BLOCKED_TASK_IDS}`;
const PR_BODY_UPDATE_NOTE = "pr_body_update_failed: permission";
const TOOL_CONTEXT = {} as unknown as ToolContext;

interface FinishCall {
  readonly issueNumber: number;
  readonly mergeStrategy: LifecycleToolMergeStrategy;
  readonly waitForChecks: boolean;
}

const successOutcome: FinishOutcome = {
  merged: true,
  prUrl: PR_URL,
  closedAt: CLOSED_AT,
  worktreeRemoved: true,
  note: null,
};

const checksFailedOutcome: FinishOutcome = {
  merged: false,
  prUrl: PR_URL,
  closedAt: null,
  worktreeRemoved: false,
  note: CHECKS_NOTE,
};

const executorBlockedOutcome: FinishOutcome = {
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  note: EXECUTOR_BLOCKED_NOTE,
};

const prBodyUpdateFailedOutcome: FinishOutcome = {
  merged: false,
  prUrl: PR_URL,
  closedAt: null,
  worktreeRemoved: false,
  note: PR_BODY_UPDATE_NOTE,
};

const createHandle = (
  outcome: FinishOutcome,
): { readonly handle: LifecycleFinishHandle; readonly calls: readonly FinishCall[] } => {
  const calls: FinishCall[] = [];

  return {
    calls,
    handle: {
      finish: async (issueNumber, input) => {
        calls.push({ issueNumber, mergeStrategy: input.mergeStrategy, waitForChecks: input.waitForChecks });
        return outcome;
      },
    },
  };
};

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const callExecute = async (toolDef: ReturnType<typeof createLifecycleFinishTool>, args: unknown): Promise<string> => {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
};

describe("lifecycle_finish tool", () => {
  it("finishes a lifecycle issue and returns the PR close table", async () => {
    const fake = createHandle(successOutcome);
    const toolDef = createLifecycleFinishTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "pr",
      wait_for_checks: true,
    });

    expect(fake.calls).toEqual([{ issueNumber: ISSUE_NUMBER, mergeStrategy: "pr", waitForChecks: true }]);
    expect(output).toContain("## Lifecycle finished");
    expect(output).toContain("| Issue # | PR URL | Closed At |");
    expect(output).toContain(`| ${ISSUE_NUMBER} | ${PR_URL} | ${new Date(CLOSED_AT).toISOString()} |`);
  });

  it("surfaces PR check failures with the contract header", async () => {
    const fake = createHandle(checksFailedOutcome);
    const toolDef = createLifecycleFinishTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "auto",
      wait_for_checks: false,
    });

    expect(fake.calls).toEqual([{ issueNumber: ISSUE_NUMBER, mergeStrategy: "auto", waitForChecks: false }]);
    expect(output.startsWith("## PR checks failed")).toBe(true);
    expect(output).toContain(CHECKS_NOTE);
    expect(output).toContain(PR_URL);
  });

  it("surfaces executor blocked notes with the blocked header", async () => {
    const fake = createHandle(executorBlockedOutcome);
    const toolDef = createLifecycleFinishTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "pr",
      wait_for_checks: true,
    });

    expect(output.startsWith("## Lifecycle blocked")).toBe(true);
    expect(output).toContain(EXECUTOR_BLOCKED_NOTE);
    expect(output).toContain(BLOCKED_TASK_IDS);
  });

  it("surfaces PR body update failures with the generic finish failure header", async () => {
    const fake = createHandle(prBodyUpdateFailedOutcome);
    const toolDef = createLifecycleFinishTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      merge_strategy: "pr",
      wait_for_checks: true,
    });

    expect(output.startsWith("## Lifecycle finish failed")).toBe(true);
    expect(output).toContain(PR_BODY_UPDATE_NOTE);
    expect(output).toContain(PR_URL);
  });
});
