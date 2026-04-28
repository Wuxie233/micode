import { describe, expect, it } from "bun:test";

import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";
import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";

const mkRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: 6,
  issueUrl: "https://github.com/owner/repo/issues/6",
  branch: "issue/6-redesign",
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
  ...overrides,
});

const exec = async (resolver: { current: () => Promise<unknown> }): Promise<string> => {
  const tool = createLifecycleCurrentTool(resolver as Parameters<typeof createLifecycleCurrentTool>[0]);
  const out = await (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute({}, {});
  return out;
};

describe("lifecycle_current tool", () => {
  it("renders resolved markdown with the issue row", async () => {
    const out = await exec({
      current: async () => ({ kind: "resolved", record: mkRecord() }),
    });
    expect(out).toContain("## Active lifecycle");
    expect(out).toContain("| 6 |");
  });

  it("renders none when nothing is active", async () => {
    const out = await exec({ current: async () => ({ kind: "none" }) });
    expect(out).toContain("## No active lifecycle");
  });

  it("renders ambiguous with candidates", async () => {
    const out = await exec({
      current: async () => ({ kind: "ambiguous", candidates: [3, 9] }),
    });
    expect(out).toContain("## Ambiguous");
    expect(out).toContain("- #3");
    expect(out).toContain("- #9");
  });

  it("renders failure header when resolver throws", async () => {
    const out = await exec({
      current: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toContain("## lifecycle_current failed");
    expect(out).toContain("boom");
  });
});
