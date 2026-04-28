import { describe, expect, it } from "bun:test";

import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";
import { createLifecycleResumeTool } from "@/tools/lifecycle/resume";

const mkRecord = (issueNumber: number): LifecycleRecord => ({
  issueNumber,
  issueUrl: `https://github.com/owner/repo/issues/${issueNumber}`,
  branch: `issue/${issueNumber}-x`,
  worktree: "/tmp/wt",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: 0,
});

const exec = async (
  resolver: { resume: (n: number) => Promise<LifecycleRecord> },
  args: { issue_number: number },
): Promise<string> => {
  const tool = createLifecycleResumeTool(resolver as Parameters<typeof createLifecycleResumeTool>[0]);
  const out = await (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute(args, {});
  return out;
};

describe("lifecycle_resume tool", () => {
  it("renders the resumed record as a markdown table", async () => {
    const out = await exec({ resume: async (n) => mkRecord(n) }, { issue_number: 6 });
    expect(out).toContain("## Lifecycle resumed");
    expect(out).toContain("| 6 |");
  });

  it("renders the failure header when resume throws", async () => {
    const out = await exec(
      {
        resume: async () => {
          throw new Error("issue_not_found: #99");
        },
      },
      { issue_number: 99 },
    );
    expect(out).toContain("## lifecycle_resume failed");
    expect(out).toContain("issue_not_found");
  });
});
