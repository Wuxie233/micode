import { describe, expect, it } from "bun:test";
import { tool } from "@opencode-ai/plugin/tool";

import type { ArtifactKind, LifecycleRecord } from "@/lifecycle";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle";
import { createLifecycleRecordArtifactTool, type RecordArtifactHandle } from "@/tools/lifecycle/record-artifact";

type ArgsShape = Parameters<typeof tool>[0]["args"];
type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

interface RecordedArtifact {
  readonly issueNumber: number;
  readonly kind: ArtifactKind;
  readonly pointer: string;
}

const ISSUE_NUMBER = 42;
const UNKNOWN_ISSUE = 404;
const UPDATED_AT = 1_777_222_400_000;
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/42";
const BRANCH = "issue/42-lifecycle";
const WORKTREE = "/tmp/micode-issue-42";
const PLAN_POINTER = "thoughts/shared/plans/issue-42.md";
const MISSING_MESSAGE = `Lifecycle record not found: ${UNKNOWN_ISSUE}`;
const TOOL_CONTEXT = {};

const createRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: ISSUE_NUMBER,
  issueUrl: ISSUE_URL,
  branch: BRANCH,
  worktree: WORKTREE,
  state: LIFECYCLE_STATES.IN_PLAN,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [PLAN_POINTER],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: UPDATED_AT,
  ...overrides,
});

const createHandle = (
  record: LifecycleRecord,
): { readonly handle: RecordArtifactHandle; readonly calls: RecordedArtifact[] } => {
  const calls: RecordedArtifact[] = [];

  return {
    calls,
    handle: {
      recordArtifact: async (issueNumber, kind, pointer) => {
        calls.push({ issueNumber, kind, pointer });
        return record;
      },
    },
  };
};

const createMissingHandle = (): RecordArtifactHandle => ({
  recordArtifact: async () => {
    throw new Error(MISSING_MESSAGE);
  },
});

const schemaFor = (args: unknown) => tool.schema.object(args as ArgsShape);

const callExecute = async (
  toolDef: ReturnType<typeof createLifecycleRecordArtifactTool>,
  args: unknown,
): Promise<string> => {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return exec(args, TOOL_CONTEXT);
};

describe("lifecycle_record_artifact tool", () => {
  it("records an artifact and returns the current lifecycle state", async () => {
    const record = createRecord();
    const fake = createHandle(record);
    const toolDef = createLifecycleRecordArtifactTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.PLAN,
      pointer: PLAN_POINTER,
    });

    expect(fake.calls).toEqual([{ issueNumber: ISSUE_NUMBER, kind: ARTIFACT_KINDS.PLAN, pointer: PLAN_POINTER }]);
    expect(output).toContain("## Lifecycle artifact recorded");
    expect(output).toContain("| Issue # | Kind | Pointer | State |");
    expect(output).toContain(`| ${ISSUE_NUMBER} | ${ARTIFACT_KINDS.PLAN} | ${PLAN_POINTER} | ${record.state} |`);
  });

  it("returns a failure string when the lifecycle issue is unknown", async () => {
    const toolDef = createLifecycleRecordArtifactTool(createMissingHandle());

    const output = await callExecute(toolDef, {
      issue_number: UNKNOWN_ISSUE,
      kind: ARTIFACT_KINDS.PLAN,
      pointer: PLAN_POINTER,
    });

    expect(output).toContain("## Lifecycle artifact recording failed");
    expect(output).toContain(MISSING_MESSAGE);
  });

  it("enforces artifact kind through the tool schema", () => {
    const toolDef = createLifecycleRecordArtifactTool(createMissingHandle());
    const schema = schemaFor(toolDef.args);

    expect(
      schema.safeParse({ issue_number: ISSUE_NUMBER, kind: ARTIFACT_KINDS.PLAN, pointer: PLAN_POINTER }).success,
    ).toBe(true);
    expect(schema.safeParse({ issue_number: ISSUE_NUMBER, kind: "unknown", pointer: PLAN_POINTER }).success).toBe(
      false,
    );
  });
});
