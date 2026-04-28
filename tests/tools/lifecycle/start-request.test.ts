import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { CommitOutcome, FinishOutcome, LifecycleHandle, LifecycleRecord, StartRequestInput } from "@/lifecycle";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle";
import { createLifecycleStartRequestTool } from "@/tools/lifecycle/start-request";

const ISSUE_NUMBER = 12;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/12";
const BRANCH = "issue/12-add-lifecycle-start";
const WORKTREE = "/tmp/micode-issue-12";
const UPDATED_AT = 1_777_222_400_000;
const SUMMARY = "Add lifecycle start";
const PREFLIGHT_NOTE = "pre_flight_failed: origin points to upstream";

interface FakeHandle {
  readonly handle: LifecycleHandle;
  readonly calls: StartRequestInput[];
}

const commitOutcome: CommitOutcome = {
  committed: false,
  sha: null,
  pushed: false,
  retried: false,
  note: null,
};

const finishOutcome: FinishOutcome = {
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  note: null,
};

const createArtifacts = (): LifecycleRecord["artifacts"] => ({
  [ARTIFACT_KINDS.DESIGN]: [],
  [ARTIFACT_KINDS.PLAN]: [],
  [ARTIFACT_KINDS.LEDGER]: [],
  [ARTIFACT_KINDS.COMMIT]: [],
  [ARTIFACT_KINDS.PR]: [],
  [ARTIFACT_KINDS.WORKTREE]: [],
});

const createRecord = (state = LIFECYCLE_STATES.BRANCH_READY, notes: readonly string[] = []): LifecycleRecord => ({
  issueNumber: ISSUE_NUMBER,
  issueUrl: ISSUE_URL,
  branch: BRANCH,
  worktree: WORKTREE,
  state,
  artifacts: createArtifacts(),
  notes,
  updatedAt: UPDATED_AT,
});

const createHandle = (record: LifecycleRecord): FakeHandle => {
  const calls: StartRequestInput[] = [];

  return {
    calls,
    handle: {
      start: async (input) => {
        calls.push(input);
        return record;
      },
      recordArtifact: async () => record,
      commit: async () => commitOutcome,
      finish: async () => finishOutcome,
      load: async () => record,
      setState: async () => record,
    },
  };
};

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

const executeStart = async (handle: LifecycleHandle): Promise<string> => {
  const lifecycleStartRequest = createLifecycleStartRequestTool(handle);
  const output = await lifecycleStartRequest.execute(
    {
      summary: SUMMARY,
      goals: ["Open an issue", "Create a worktree"],
      constraints: ["Do not touch contract"],
    },
    {} as unknown as ToolContext,
  );

  return stringify(output);
};

describe("lifecycle_start_request tool", () => {
  it("starts the lifecycle and returns the issue table", async () => {
    const fake = createHandle(createRecord());

    const output = await executeStart(fake.handle);

    expect(fake.calls).toEqual([
      {
        summary: SUMMARY,
        goals: ["Open an issue", "Create a worktree"],
        constraints: ["Do not touch contract"],
      },
    ]);
    expect(output).toContain("| Issue # | Branch | Worktree | State |");
    expect(output).toContain(`| ${ISSUE_NUMBER} | \`${BRANCH}\` | \`${WORKTREE}\` | \`branch_ready\` |`);
  });

  it("surfaces an aborted pre-flight record with the required header", async () => {
    const fake = createHandle(createRecord(LIFECYCLE_STATES.ABORTED, [PREFLIGHT_NOTE]));

    const output = await executeStart(fake.handle);

    expect(output.startsWith("## Lifecycle pre-flight failed")).toBe(true);
    expect(output).toContain(PREFLIGHT_NOTE);
    expect(output).toContain("| Issue # | Branch | Worktree | State |");
  });

  it("forwards exactly summary, goals, and constraints with no extra fields", async () => {
    const fake = createHandle(createRecord());

    await executeStart(fake.handle);

    expect(Object.keys(fake.calls[0]).sort()).toEqual(["constraints", "goals", "summary"]);
  });
});
