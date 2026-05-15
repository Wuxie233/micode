import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { CommitOutcome, FinishOutcome, LifecycleHandle, LifecycleRecord, StartRequestInput } from "@/lifecycle";
import { ARTIFACT_KINDS, LIFECYCLE_MODES, LIFECYCLE_STATES } from "@/lifecycle/types";
import { createLifecycleStartRequestTool } from "@/tools/lifecycle/start-request";

const ISSUE_NUMBER = 12;
const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/12";
const BRANCH = "issue/12-add-lifecycle-start";
const ABORTED_BRANCH = `issue/${ABORTED_ISSUE_NUMBER}-aborted`;
const WORKTREE = "/tmp/micode-issue-12";
const REPO_ROOT = "/root/CODE/micode";
const ABORTED_WORKTREE = `/tmp/micode-issue-${ABORTED_ISSUE_NUMBER}-aborted`;
const LOCAL_ISSUE_NUMBER = -1;
const LOCAL_ID = "local-20260516-0001";
const LOCAL_WORKTREE = "/root/CODE/micode";
const LOCAL_NOTE = "local-only: GitHub unavailable; continue in the current worktree";
const UPDATED_AT = 1_777_222_400_000;
const SUMMARY = "Add lifecycle start";
const PREFLIGHT_NOTE = "pre_flight_failed: origin points to upstream";
const INVALID_REQUEST_HEADER = "## Invalid lifecycle start request";
const ITEMS_MAP_ERROR = "items.map is not a function";

const START_ARGS = {
  summary: SUMMARY,
  goals: ["Open an issue", "Create a worktree"],
  constraints: ["Do not touch contract"],
};

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

const createRecord = (
  state = LIFECYCLE_STATES.BRANCH_READY,
  notes: readonly string[] = [],
  overrides: Partial<
    Pick<
      LifecycleRecord,
      "branch" | "issueNumber" | "issueUrl" | "localId" | "mode" | "remoteCapable" | "repoRoot" | "worktree"
    >
  > = {},
): LifecycleRecord => ({
  issueNumber: overrides.issueNumber ?? ISSUE_NUMBER,
  issueUrl: overrides.issueUrl ?? ISSUE_URL,
  mode: overrides.mode ?? LIFECYCLE_MODES.REMOTE,
  localId: overrides.localId ?? null,
  repoRoot: overrides.repoRoot ?? REPO_ROOT,
  remoteCapable: overrides.remoteCapable ?? true,
  branch: overrides.branch ?? BRANCH,
  worktree: overrides.worktree ?? WORKTREE,
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

const executeStart = async (handle: LifecycleHandle, args: Record<string, unknown> = START_ARGS): Promise<string> => {
  const lifecycleStartRequest = createLifecycleStartRequestTool(handle);
  const output = await lifecycleStartRequest.execute(args, {} as unknown as ToolContext);

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
    expect(output).toContain(`| #${ISSUE_NUMBER} | \`${BRANCH}\` | \`${WORKTREE}\` | \`branch_ready\` |`);
    expect(output).toContain("Mode: `remote`");
    expect(output).toContain(`Repo root: \`${REPO_ROOT}\``);
    expect(output).toContain("Remote capable: `true`");
  });

  it("renders local-only lifecycle output as guidance without GitHub issue wording", async () => {
    const fake = createHandle(
      createRecord(LIFECYCLE_STATES.BRANCH_READY, [LOCAL_NOTE], {
        issueNumber: LOCAL_ISSUE_NUMBER,
        issueUrl: "",
        mode: LIFECYCLE_MODES.LOCAL_ONLY,
        localId: LOCAL_ID,
        repoRoot: REPO_ROOT,
        remoteCapable: false,
        worktree: LOCAL_WORKTREE,
      }),
    );

    const output = await executeStart(fake.handle);

    expect(output.startsWith("## Local-only lifecycle started")).toBe(true);
    expect(output).toContain("| Local ID | Branch | Worktree | State |");
    expect(output).toContain(`| ${LOCAL_ID} | \`${BRANCH}\` | \`${LOCAL_WORKTREE}\` | \`branch_ready\` |`);
    expect(output).toContain("Mode: `local-only`");
    expect(output).toContain(`Repo root: \`${REPO_ROOT}\``);
    expect(output).toContain("Remote capable: `false`");
    expect(output).toContain("### Guidance");
    expect(output).toContain(LOCAL_NOTE);
    expect(output).not.toContain("GitHub issue");
    expect(output).not.toContain(ISSUE_URL);
    expect(output).not.toContain(String(LOCAL_ISSUE_NUMBER));
  });

  it("surfaces an aborted pre-flight record with the required header", async () => {
    const fake = createHandle(createRecord(LIFECYCLE_STATES.ABORTED, [PREFLIGHT_NOTE]));

    const output = await executeStart(fake.handle);

    expect(output.startsWith("## Lifecycle pre-flight failed")).toBe(true);
    expect(output).toContain(PREFLIGHT_NOTE);
    expect(output).toContain("| Issue # | Branch | Worktree | State |");
  });

  it("does not expose the aborted sentinel issue number in pre-flight output", async () => {
    const fake = createHandle(
      createRecord(LIFECYCLE_STATES.ABORTED, [PREFLIGHT_NOTE], {
        issueNumber: ABORTED_ISSUE_NUMBER,
        issueUrl: `https://github.com/Wuxie233/micode/issues/${ABORTED_ISSUE_NUMBER}`,
        branch: ABORTED_BRANCH,
        worktree: ABORTED_WORKTREE,
      }),
    );

    const output = await executeStart(fake.handle);

    expect(output).toContain("| (aborted) |");
    expect(output).not.toContain(String(ABORTED_ISSUE_NUMBER));
    expect(output).not.toContain(`#${ABORTED_ISSUE_NUMBER}`);
  });

  it("normalizes string and indexed request fields before starting", async () => {
    const fake = createHandle(createRecord());

    await executeStart(fake.handle, {
      summary: SUMMARY,
      goals: "Open an issue",
      constraints: { "1": "Keep scope minimal", "0": "Do not touch contract" },
    });

    expect(fake.calls).toEqual([
      {
        summary: SUMMARY,
        goals: ["Open an issue"],
        constraints: ["Do not touch contract", "Keep scope minimal"],
      },
    ]);
  });

  it("normalizes stringified JSON arrays and indexed records before starting", async () => {
    const fake = createHandle(createRecord());

    await executeStart(fake.handle, {
      summary: SUMMARY,
      goals: JSON.stringify(["Open an issue", "Create a worktree"]),
      constraints: JSON.stringify({ "0": "Do not touch contract" }),
    });

    expect(fake.calls).toEqual([
      {
        summary: SUMMARY,
        goals: ["Open an issue", "Create a worktree"],
        constraints: ["Do not touch contract"],
      },
    ]);
  });

  it("returns a clear validation message without starting on invalid request fields", async () => {
    const fake = createHandle(createRecord());
    const invalidRequests: readonly Record<string, unknown>[] = [
      { summary: SUMMARY, goals: { foo: "bar" }, constraints: [] },
      { summary: SUMMARY, goals: '["Open an issue"', constraints: [] },
      { summary: SUMMARY, goals: ["Open an issue", 42], constraints: [] },
      { summary: SUMMARY, goals: [], constraints: { "0": 42 } },
    ];

    for (const request of invalidRequests) {
      const output = await executeStart(fake.handle, request);

      expect(output).toContain(INVALID_REQUEST_HEADER);
      expect(output).not.toContain(ITEMS_MAP_ERROR);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("forwards exactly summary, goals, and constraints with no extra fields", async () => {
    const fake = createHandle(createRecord());

    await executeStart(fake.handle);

    expect(Object.keys(fake.calls[0]).sort()).toEqual(["constraints", "goals", "summary"]);
  });
});
