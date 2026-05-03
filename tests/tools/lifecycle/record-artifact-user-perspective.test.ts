import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ArtifactKind, LifecycleRecord } from "@/lifecycle";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle";
import {
  createLifecycleRecordArtifactTool,
  type RecordArtifactHandle,
  rejectIfMissingUserPerspective,
} from "@/tools/lifecycle/record-artifact";

type ExecuteTool = (raw: unknown, ctx: unknown) => Promise<string>;

interface RecordedArtifact {
  readonly issueNumber: number;
  readonly kind: ArtifactKind;
  readonly pointer: string;
}

const ISSUE_NUMBER = 26;
const UPDATED_AT = 1_777_222_400_000;
const TOOL_CONTEXT = {};

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-rec-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const writeFile = (rel: string, content: string): string => {
  const full = join(projectRoot, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
};

const createRecord = (): LifecycleRecord => ({
  issueNumber: ISSUE_NUMBER,
  issueUrl: "https://github.com/Wuxie233/micode/issues/26",
  branch: "issue/26-lifecycle",
  worktree: projectRoot,
  state: LIFECYCLE_STATES.IN_PLAN,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: UPDATED_AT,
});

const createHandle = (): { readonly handle: RecordArtifactHandle; readonly calls: RecordedArtifact[] } => {
  const calls: RecordedArtifact[] = [];

  return {
    calls,
    handle: {
      recordArtifact: async (issueNumber, kind, pointer) => {
        calls.push({ issueNumber, kind, pointer });
        return createRecord();
      },
    },
  };
};

const callExecute = async (
  toolDef: ReturnType<typeof createLifecycleRecordArtifactTool>,
  args: unknown,
): Promise<string> => {
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteTool;
  return exec(args, TOOL_CONTEXT);
};

describe("rejectIfMissingUserPerspective", () => {
  it("rejects design files without the section", () => {
    const file = writeFile("thoughts/shared/designs/x.md", "# x\n\n## Approach\n");
    const guard = rejectIfMissingUserPerspective("design", file);
    expect(guard.ok).toBe(false);
  });

  it("accepts design files with the section", () => {
    const file = writeFile("thoughts/shared/designs/y.md", "## User Perspective\n\nUser wants Z.\n");
    const guard = rejectIfMissingUserPerspective("design", file);
    expect(guard.ok).toBe(true);
  });

  it("accepts ledger files with the section", () => {
    const file = writeFile("thoughts/ledgers/26.md", "## User Perspective\n\nUser cares about A.\n");
    const guard = rejectIfMissingUserPerspective("ledger", file);
    expect(guard.ok).toBe(true);
  });

  it("accepts missing design pointers for historical records", () => {
    expect(rejectIfMissingUserPerspective("design", join(projectRoot, "missing.md")).ok).toBe(true);
  });

  it("ignores non-design/ledger artifact kinds", () => {
    const file = writeFile("plans/p.md", "# no section needed");
    expect(rejectIfMissingUserPerspective("plan", file).ok).toBe(true);
    expect(rejectIfMissingUserPerspective("commit", "abc123").ok).toBe(true);
  });

  it("blocks recording a new design file without User Perspective", async () => {
    const file = writeFile("thoughts/shared/designs/z.md", "# z\n");
    const fake = createHandle();
    const toolDef = createLifecycleRecordArtifactTool(fake.handle);

    const output = await callExecute(toolDef, {
      issue_number: ISSUE_NUMBER,
      kind: ARTIFACT_KINDS.DESIGN,
      pointer: file,
    });

    expect(fake.calls).toEqual([]);
    expect(output).toContain("## Lifecycle artifact recording failed");
    expect(output).toContain("User Perspective");
  });
});
